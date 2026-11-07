/**
 * Normal and Hard computer opponents.
 *
 * Both value a step by the share of a region's seats it adds per pound, plus a bonus for taking the lead (leads win
 * region groups), and value national groups by their income once they reach control. They pick members whose bonuses
 * suit the places they campaign, put members in their biggest regions, and spend everything on the final turn.
 *
 * Hard also values group control by the income it brings over the turns likely left, and times the end of the
 * campaign: it closes out the last regions when it is ahead and holds back when it is behind.
 *
 * Conflicts: a target someone else is likely to aim for is risky. Normal steps around likely targets half the time,
 * Hard less often (to a randomly chosen safe step). When defending a lead, Hard aims at the step a rival would need to
 * overtake, so an attack there collides and cancels.
 */
import { groupModifier, moveCost, playerById } from "./costs.js";
import { controllers, isRegion, nationalGroup, totalMoney, trackIds } from "./economy.js";
import { nextRandom } from "./rng.js";
import { meterOf, projectedSeats, regionLeader, regionRanking } from "./standing.js";
import { canPick, pickPool, validatePlan } from "./turn.js";
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
  /** Hard defends leads by aiming at the rival's overtaking step. */
  defend: boolean;
  /** Values group control by the income it brings over the turns likely left, not a flat bonus. */
  plan_income: boolean;
  /** Times the end of the campaign: closes out the last regions when ahead, holds back when behind. */
  timing: boolean;
}

const TUNING: Record<SmartLevel, Tuning> = {
  normal: { spend: 0.88, noise: 0.35, dodge: 0.5, defend: false, plan_income: false, timing: false },
  // Hard dodges less often than Normal: two Hards that always dodge pick the same safe step and collide with each other.
  hard: { spend: 0.95, noise: 0.12, dodge: 0.3, defend: true, plan_income: true, timing: true },
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
  const t = { ...TUNING[level], ...tuning };
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const player = playerById(state, playerId);
  const others = state.players.filter((p) => p.id !== playerId).map((p) => p.id);
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
  const incomeWorth = (income: number) => (t.plan_income ? income * turnsLeft * seatsPerPound * 0.6 : income / 15_000);

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
  waiting.forEach((candidateId, i) => {
    const r = open[i];
    if (r) (plan.assign ??= {})[candidateId] = r.id;
  });
  const payer = structuredClone(player);
  if (plan.pick) payer.members.push({ candidateId: plan.pick, regionId: null, assignedTurn: null });

  function contested(track: string) {
    return state.players.some((p) => meterOf(state, track, p.id).steps >= pack.rules.contentionAt);
  }
  const seatsNow = projectedSeats(pack, state);
  const ahead = others.every((o) => (seatsNow[playerId] ?? 0) > (seatsNow[o] ?? 0));

  // Value of reaching a step on a track, holding everyone else still.
  const steps = (track: string, id: string) => meterOf(state, track, id).steps;
  const value = (track: string, to: number): number => {
    if (isRegion(pack, track)) {
      const region = pack.regions.find((r) => r.id === track)!;
      const theirs = others.reduce((a, id) => a + steps(track, id), 0);
      const share = (pips: number) => (pips + theirs === 0 ? 0 : pips / (pips + theirs));
      const from = steps(track, playerId);
      let v = region.seats * (share(to) - share(from));
      // Taking the lead: worth part of every region group this region belongs to.
      const leader = regionLeader(state, track);
      const top = leader ? steps(track, leader) : 0;
      if (leader !== playerId && to > top) {
        for (const g of pack.groups) if (g.kind === "state" && g.regions.includes(track)) v += incomeWorth(g.income) * (1 + groupModifier(pack, payer, g.id) / 100) * 0.5;
      }
      // The last regions to reach contention start the final turn: worth it when ahead, a mistake when behind.
      if (t.timing && from < pack.rules.contentionAt && to >= pack.rules.contentionAt && uncontested <= 2 && !contested(track)) {
        v += ahead ? region.seats * 0.3 : -region.seats;
      }
      return v;
    }
    // National group: worth its income once this player would lead it with at least 3 steps.
    const g = nationalGroup(pack, track)!;
    const top = Math.max(0, ...others.map((id) => steps(track, id)));
    const leadsAfter = to >= pack.rules.contentionAt && to > top;
    const leadsNow = ctrl[track] === playerId;
    return leadsAfter && !leadsNow ? incomeWorth(g.income) * (1 + groupModifier(pack, payer, g.id) / 100) : 0.05;
  };

  const tracks = trackIds(pack).filter((id) => state.locked[id] === undefined);
  const jitter = new Map(tracks.map((id) => [id, 1 + t.noise * (rand() - 0.5) * 2] as const));
  const budget = totalMoney(player) * (final ? 1 : t.spend * (0.95 + 0.1 * rand()));
  const targets: Record<string, number> = {};
  let spent = 0;

  // Greedy: keep adding the step (or two) with the best value per pound until the budget is used.
  for (let guard = 0; guard < 400; guard++) {
    let best: { id: string; to: number; cost: number; score: number } | null = null;
    for (const id of tracks) {
      const m = meterOf(state, id, playerId);
      const from = targets[id] ?? m.steps;
      for (const add of [1, 2]) {
        const to = from + add;
        if (to > pack.rules.steps || (!m.entered && to > pack.rules.firstEntryMax)) continue;
        const cost = moveCost(pack, payer, id, from, to);
        if (spent + cost > budget) continue;
        const gain = value(id, to) - value(id, from);
        if (gain <= 0) continue;
        const score = (gain / cost) * jitter.get(id)!;
        if (!best || score > best.score) best = { id, to, cost, score };
      }
    }
    if (!best) break;
    const trial: Plan = { ...plan, steps: { ...plan.steps, [best.id]: best.to } };
    if (validatePlan(pack, state, playerId, trial).length > 0) {
      tracks.splice(tracks.indexOf(best.id), 1);
      continue;
    }
    plan.steps = trial.steps!;
    targets[best.id] = best.to;
    spent += best.cost;
  }

  // Conflicts: step around targets rivals are likely to aim for; Hard also defends leads against an overtake.
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
    const trial: Plan = { ...plan, steps: { ...plan.steps, [id]: to } };
    if (validatePlan(pack, state, playerId, trial).length > 0) return false;
    plan.steps = trial.steps!;
    return true;
  }

  return { plan, rng };
}
