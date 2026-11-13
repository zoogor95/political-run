/**
 * Normal and Hard computer opponents.
 *
 * Both value a step by the share of a region's seats it adds per pound, plus a bonus for taking the lead (leads win
 * region groups), and value national groups by their income, counting each step for its share of the way to control.
 * They pick members whose bonuses suit the places they campaign, put members in their biggest regions, and spend
 * everything on the final turn.
 *
 * Rivals: a region nobody else has entered yet will not stay empty. Both expect rivals to arrive (Hard more than
 * Normal), so they value the early, cheap steps that keep a region once others come in.
 *
 * Conflicts: a target someone else is likely to aim for is risky, so both step around likely targets about half the
 * time, to a randomly chosen safe step so two players thinking alike don't dodge into each other.
 *
 * Hard spends everything every turn and is more focused (less random) than Normal. Its settings come from the balance
 * simulator (packages/balance), which plays settings against each other in mirrored matches. The older options that
 * the simulator found to lose games (planning income over the turns left, timing the end of the campaign, defending
 * leads at the overtaking step) are kept as tuning switches, off by default, for testing on other maps.
 */
import { groupModifier, moveCost, playerById } from "./costs.js";
import { controllers, isRegion, nationalGroup, pay, totalMoney, trackIds } from "./economy.js";
import { nextRandom } from "./rng.js";
import { meterOf, projectedSeats, regionLeader, regionRanking, seatWeight } from "./standing.js";
import { assignsMembers, canPick, pickPool, validatePlan } from "./turn.js";
import type { GameState, MapPack, Plan } from "./types.js";
import type { AiResult } from "./ai.js";

export type SmartLevel = "normal" | "hard";

export interface Tuning {
  /** Share of money spent on an ordinary turn (randomised a little). */
  spend: number;
  /** Random spread on every score: lower is more focused. */
  noise: number;
  /** Chance of stepping around a target a rival is likely to aim for. */
  dodge: number;
  /** Defends leads by aiming at the step a rival would need to overtake, so an attack there collides and cancels. */
  defend: boolean;
  /** Values group control by the income it brings over the turns likely left, not a flat bonus. */
  plan_income: boolean;
  /** Times the end of the campaign: closes out the last regions when ahead, holds back when behind. */
  timing: boolean;
  /** Rival steps to expect in each open region, per rival, even before they arrive: values early, cheap steps. 0 plans only for rivals already there. */
  anticipate: number;
  /** Strategy: above 0 favours regions with many seats, below 0 small ones. 0 is neutral. */
  seatBias: number;
  /** Strategy: how much group income matters, as a multiple of the usual value. 1 is neutral. */
  groupBias: number;
  /** Strategy: extra value, in seats per seat of the region, for bringing a region into contention (ending the campaign sooner). */
  rush: number;
  /** Personality: how much this player cares about each track (1 is neutral), so bots don't all chase the same places. */
  affinity?: Record<string, number>;
}

const NEUTRAL = { seatBias: 0, groupBias: 1, rush: 0 };

// Hard's settings won the simulator's mirrored matches against their neighbours, and hold up in mixed line-ups.
// Noise: clashes cost 30-55% of all spending, and the player whose choices differ from the others' avoids most of them,
// so a fair amount of randomness is worth more than precision. Both levels use 0.6 (a track's value can swing 60% either
// way each turn): Hard then beats two Normals 68% of the time on the UK and 40% on Pakistan (33% is even).
const TUNING: Record<SmartLevel, Tuning> = {
  normal: { spend: 0.88, noise: 0.6, dodge: 0.5, defend: false, plan_income: false, timing: false, anticipate: 0.75, ...NEUTRAL },
  // Income planning stays off: it overvalued national groups and lost to Normal almost every game.
  hard: { spend: 1, noise: 0.6, dodge: 0.55, defend: false, plan_income: false, timing: false, anticipate: 1.75, ...NEUTRAL },
};

export type StrategyId = "balanced" | "big-regions" | "small-regions" | "groups" | "rush" | "hoard";

/**
 * Ways to play, as changes to the Hard AI. The balance simulator plays them against each other: a fair map has no
 * single way to play that wins far more than its share.
 */
export const STRATEGIES: Record<StrategyId, { name: string; about: string; tuning: Partial<Tuning> }> = {
  balanced: { name: "Balanced", about: "The Hard AI as it is: best seats for the money, groups when worth it.", tuning: {} },
  "big-regions": { name: "Big regions", about: "Concentrates on the regions with the most seats.", tuning: { seatBias: 1 } },
  "small-regions": { name: "Small regions", about: "Picks up the cheap regions with few seats that others leave alone.", tuning: { seatBias: -1 } },
  groups: { name: "Groups and income", about: "Chases region and national groups for income first, seats later.", tuning: { groupBias: 2.5 } },
  rush: { name: "Rush", about: "Brings regions into contention early to end the campaign while ahead.", tuning: { rush: 0.4 } },
  hoard: { name: "Hoard", about: "Keeps a quarter of its money back each turn and pours the savings in on the final turn.", tuning: { spend: 0.75 } },
};

/** Steps a player is likely to aim for next on a track: first entry 1-2, otherwise one or two more, or one past the leader. */
export function likelyTargets(pack: MapPack, state: GameState, playerId: string, trackId: string): Set<number> {
  if (state.locked[trackId] !== undefined) return new Set();
  const m = meterOf(state, trackId, playerId);
  const out = new Set<number>();
  if (!m.entered) {
    for (let s = 1; s <= pack.rules.firstEntryMax; s++) out.add(s);
    return out;
  }
  const top = regionRanking(state, trackId).map((id) => meterOf(state, trackId, id).steps)[0] ?? 0;
  for (const s of [m.steps + 1, m.steps + 2, top + 1]) if (s > m.steps && s <= pack.rules.steps) out.add(s);
  return out;
}

export function planSmart(pack: MapPack, state: GameState, playerId: string, level: SmartLevel, rng: number, tuning?: Partial<Tuning>): AiResult {
  const t = { ...TUNING[level], ...pack.aiTuning?.[level], ...tuning };
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const player = playerById(state, playerId);
  if (player.eliminated !== undefined) return { plan: {}, rng };
  const presidential = pack.gameType === "presidential";
  const others = state.players.filter((p) => p.id !== playerId && p.eliminated === undefined).map((p) => p.id);
  const plan: Plan = { steps: {} };
  const final = state.phase === "final";

  // How much a group is worth to hold, in seats-equivalent. Normal: a flat share of its income. Hard: the income over
  // the turns likely left, converted at what money buys right now.
  const ctrl = controllers(pack, state);
  const uncontested = pack.regions.filter((r) => !state.players.some((p) => meterOf(state, r.id, p.id).steps >= pack.rules.contentionAt)).length;
  const turnsLeft = final ? 0 : Math.min(8, 1 + Math.ceil(uncontested / 2));
  let seatsPerPound = 0;
  if (t.plan_income) {
    for (const r of pack.regions) {
      const m = meterOf(state, r.id, playerId);
      if (state.locked[r.id] !== undefined || m.steps >= pack.rules.steps) continue;
      const theirs = state.players.filter((p) => p.id !== playerId).reduce((a, p) => a + meterOf(state, r.id, p.id).steps, 0);
      const gain = r.seats * ((m.steps + 1) / (m.steps + 1 + theirs) - (m.steps + theirs === 0 ? 0 : m.steps / (m.steps + theirs)));
      seatsPerPound = Math.max(seatsPerPound, gain / moveCost(pack, player, r.id, m.steps, m.steps + 1));
    }
  }
  const incomeWorth = (income: number) => t.groupBias * (t.plan_income ? income * turnsLeft * seatsPerPound * 0.6 : income / 15_000);
  const meanSeats = pack.regions.reduce((a, r) => a + r.seats, 0) / pack.regions.length;
  const weight = new Map(pack.regions.map((r) => [r.id, seatWeight(pack, r.id)]));

  // Members: the candidate whose bonuses add most where this player is campaigning (seats in entered regions).
  if (canPick(pack, state, playerId)) {
    const active = (gid: string) => {
      const g = pack.groups.find((x) => x.id === gid)!;
      if (g.kind === "national") return meterOf(state, gid, playerId).steps > 0 ? 20 : 8;
      return pack.regions.filter((r) => g.regions.includes(r.id) && meterOf(state, r.id, playerId).entered).reduce((a, r) => a + r.seats, 0) + 5;
    };
    const pool = pickPool(pack, state, playerId);
    let best: { id: string; score: number } | null = null;
    for (const id of pool) {
      const c = pack.candidates.find((x) => x.id === id)!;
      const score = Object.entries(c.modifiers).reduce((a, [g, pct]) => a + pct * active(g), 0) * (1 + t.noise * (rand() - 0.5));
      if (!best || score > best.score) best = { id, score };
    }
    if (best) plan.pick = best.id;
  }

  // Waiting members go to the biggest entered regions that have room on the meter.
  const withMember = new Set(player.members.map((m) => m.regionId));
  const waiting = [...player.members.filter((m) => m.regionId === null).map((m) => m.candidateId), ...(plan.pick ? [plan.pick] : [])];
  const open = pack.regions
    .filter((r) => {
      const m = meterOf(state, r.id, playerId);
      return m.entered && m.steps < pack.rules.steps && !withMember.has(r.id) && state.locked[r.id] === undefined;
    })
    .sort((a, b) => b.seats - a.seats);
  if (assignsMembers(pack)) {
    waiting.forEach((candidateId, i) => {
      const r = open[i];
      if (r) (plan.assign ??= {})[candidateId] = r.id;
    });
  }
  const payer = structuredClone(player);
  if (plan.pick) payer.members.push({ candidateId: plan.pick, regionId: null, assignedTurn: null });

  function contested(track: string) {
    return state.players.some((p) => meterOf(state, track, p.id).steps >= pack.rules.contentionAt);
  }
  const seatsNow = projectedSeats(pack, state);
  const ahead = others.every((o) => (seatsNow[playerId] ?? 0) > (seatsNow[o] ?? 0));

  // Value of reaching a step on a track, holding everyone else still, scaled by how much this player cares about it.
  const steps = (track: string, id: string) => meterOf(state, track, id).steps;
  const value = (track: string, to: number): number => baseValue(track, to) * (t.affinity?.[track] ?? 1);
  const baseValue = (track: string, to: number): number => {
    if (isRegion(pack, track)) {
      const region = pack.regions.find((r) => r.id === track)!;
      const theirs = Math.max(others.reduce((a, id) => a + steps(track, id), 0), final ? 0 : others.length * t.anticipate);
      const share = (pips: number) => (pips + theirs === 0 ? 0 : pips / (pips + theirs));
      const from = steps(track, playerId);
      // Presidential: the leader takes every electoral vote, so a step is worth the chance of holding the lead it adds.
      // On the final turn only a strict lead holds (an equal rival got there first); before that, rivals are expected
      // to climb a little, and a full meter locks the region for good.
      const rivalTop = Math.max(0, ...others.map((id) => steps(track, id)));
      const hold = (pips: number) => {
        if (pips <= 0) return 0;
        if (pips >= pack.rules.steps) return 1;
        if (final) return pips > rivalTop ? 1 : 0;
        return Math.min(1, Math.max(0, 0.5 + 0.3 * (pips - rivalTop - t.anticipate / 2)));
      };
      const gain = presidential ? hold(to) - hold(from) : share(to) - share(from);
      // A general seat also brings its share of any reserved seats decided by seats won here.
      let v = region.seats * weight.get(track)! * gain * (region.seats / meanSeats) ** t.seatBias;
      // Taking the lead: worth part of every region group this region belongs to.
      const leader = regionLeader(state, track);
      const top = leader ? steps(track, leader) : 0;
      if (leader !== playerId && to > top) {
        for (const g of pack.groups) if (g.kind === "state" && g.regions.includes(track)) v += incomeWorth(g.income) * (1 + groupModifier(pack, payer, g.id) / 100) * 0.5;
      }
      // The last regions to reach contention start the final turn: worth it when ahead, a mistake when behind.
      if (t.rush > 0 && !final && from < pack.rules.contentionAt && to >= pack.rules.contentionAt && !contested(track)) v += region.seats * t.rush;
      if (t.timing && from < pack.rules.contentionAt && to >= pack.rules.contentionAt && uncontested <= 2 && !contested(track)) {
        v += ahead ? region.seats * 0.3 : -region.seats;
      }
      return v;
    }
    // National group: worth its income once this player leads it with enough steps for control. Steps on the way there
    // count for their share of the way, so a meter that takes several turns to climb is still worth starting.
    const g = nationalGroup(pack, track)!;
    const top = Math.max(0, ...others.map((id) => steps(track, id)));
    const need = Math.max(pack.rules.contentionAt, top + 1);
    if (final) return 0;
    return incomeWorth(g.income) * (1 + groupModifier(pack, payer, g.id) / 100) * Math.min(1, to / need);
  };

  const tracks = trackIds(pack).filter((id) => state.locked[id] === undefined);
  const jitter = new Map(tracks.map((id) => [id, 1 + t.noise * (rand() - 0.5) * 2] as const));
  const budget = totalMoney(player) * (final ? 1 : t.spend * (0.95 + 0.1 * rand()));
  const targets: Record<string, number> = {};
  let spent = 0;

  // Greedy: keep adding the step (or two) with the best value per pound until the budget is used. A track's options only
  // change when a step is added there, so they are worked out once and again only for that track.
  type Option = { to: number; cost: number; score: number };
  const options = new Map<string, Option[]>();
  const optionsFor = (id: string): Option[] => {
    const known = options.get(id);
    if (known) return known;
    const m = meterOf(state, id, playerId);
    const from = targets[id] ?? m.steps;
    const out: Option[] = [];
    for (const add of [1, 2]) {
      const to = from + add;
      if (to > pack.rules.steps || (!m.entered && to > pack.rules.firstEntryMax)) continue;
      const gain = value(id, to) - value(id, from);
      if (gain <= 0) continue;
      const cost = moveCost(pack, payer, id, from, to);
      out.push({ to, cost, score: (gain / cost) * jitter.get(id)! });
    }
    options.set(id, out);
    return out;
  };
  // Steps are paid for from a scratch copy of the wallets as they are added; the whole plan is checked once at the end,
  // because the real payment goes track by track in board order and group wallets only pay in their own places.
  const wallet = structuredClone(payer);
  const accepted: { id: string; before: number | undefined }[] = [];
  for (let guard = 0; guard < 400; guard++) {
    let best: ({ id: string } & Option) | null = null;
    for (const id of tracks) {
      for (const o of optionsFor(id)) {
        if (spent + o.cost <= budget && (!best || o.score > best.score)) best = { id, ...o };
      }
    }
    if (!best) break;
    if (pay(pack, wallet, best.id, best.cost) === null) {
      tracks.splice(tracks.indexOf(best.id), 1); // the money that can be spent here has run out
      continue;
    }
    accepted.push({ id: best.id, before: targets[best.id] });
    targets[best.id] = best.to;
    spent += best.cost;
    options.delete(best.id);
  }
  plan.steps = { ...targets };
  // Rarely, paying in board order runs a group wallet dry where paying in the order above did not: drop the last steps.
  while (accepted.length > 0 && validatePlan(pack, state, playerId, plan).length > 0) {
    const { id, before } = accepted.pop()!;
    if (before === undefined) delete targets[id];
    else targets[id] = before;
    plan.steps = { ...targets };
  }

  // Conflicts: step around targets rivals are likely to aim for; Hard also defends leads against an overtake. Moving a
  // target pays the difference from the scratch wallets (a lower target always fits); the plan is checked once after.
  const moved: { id: string; before: number }[] = [];
  for (const [id, to] of Object.entries({ ...plan.steps })) {
    const m = meterOf(state, id, playerId);
    const risky = new Set<number>();
    for (const o of others) for (const s of likelyTargets(pack, state, o, id)) risky.add(s);
    const leader = regionLeader(state, id);
    const leading = leader === playerId || (!isRegion(pack, id) && ctrl[id] === playerId);
    if (t.defend && leading) {
      // A rival must reach one past this player's steps to overtake; aiming exactly there cancels that attack.
      const overtake = m.steps + 1;
      const threat = others.some((o) => likelyTargets(pack, state, o, id).has(overtake));
      if (threat && to !== overtake && tryTarget(id, overtake)) continue;
      if (threat) continue;
    }
    if (!risky.has(to) || rand() >= t.dodge) continue;
    // Step to a safe target nearby, chosen at random so two players thinking alike don't dodge into each other.
    const maxTo = m.entered ? pack.rules.steps : pack.rules.firstEntryMax;
    const options = [to + 1, to + 2, to - 1].filter((s) => s > m.steps && s <= maxTo && !risky.has(s));
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
    for (const s of options) if (tryTarget(id, s)) break;
  }

  function tryTarget(id: string, to: number): boolean {
    const before = plan.steps![id]!;
    if (to > before && pay(pack, wallet, id, moveCost(pack, payer, id, before, to)) === null) return false;
    moved.push({ id, before });
    plan.steps = { ...plan.steps, [id]: to };
    return true;
  }
  while (moved.length > 0 && validatePlan(pack, state, playerId, plan).length > 0) {
    const { id, before } = moved.pop()!;
    plan.steps = { ...plan.steps, [id]: before };
  }

  return { plan, rng };
}
