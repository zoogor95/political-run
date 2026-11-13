/**
 * Computer opponents. Easy: invests most of its money each turn, mostly in regions that give many seats for their
 * cost, enters new regions steadily, picks and assigns party members, and never thinks about conflicts. Normal and
 * Hard are in ai-smart.ts. Deterministic: all randomness comes from the seeded generator passed in.
 */
import { moveCost, playerById } from "./costs.js";
import { isRegion, totalMoney, trackIds } from "./economy.js";
import { hashString, nextRandom, seedRng } from "./rng.js";
import { matchKey, meterOf, regionLeader } from "./standing.js";
import { canPick, pickPool, validatePlan } from "./turn.js";
import type { GameState, MapPack, Plan } from "./types.js";
import { STRATEGIES, planSmart, type StrategyId, type Tuning } from "./ai-smart.js";

export interface AiResult {
  plan: Plan;
  /** Next random generator state; store it back on the game state. */
  rng: number;
}

export function planEasy(pack: MapPack, state: GameState, playerId: string, rng: number): AiResult {
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const player = playerById(state, playerId);
  const plan: Plan = { steps: {} };

  if (canPick(pack, state, playerId)) {
    const pool = pickPool(pack, state, playerId);
    if (pool.length > 0) plan.pick = pool[Math.floor(rand() * pool.length)]!;
  }

  // Waiting members go to the entered region with the most seats that has no member yet.
  const withMember = new Set(player.members.map((m) => m.regionId));
  const waiting = [...player.members.filter((m) => m.regionId === null).map((m) => m.candidateId), ...(plan.pick ? [plan.pick] : [])];
  const free = pack.regions
    .filter((r) => meterOf(state, r.id, playerId).entered && !withMember.has(r.id) && state.locked[r.id] === undefined)
    .sort((a, b) => b.seats - a.seats);
  waiting.forEach((candidateId, i) => {
    const r = free[i];
    if (r) (plan.assign ??= {})[candidateId] = r.id;
  });

  // Score every track by seats per pound for its next step, with plenty of randomness. National groups count as
  // a few seats' worth, for their income.
  const budget = totalMoney(player) * (0.7 + 0.25 * rand());
  const worth = (id: string) => pack.regions.find((r) => r.id === id)?.seats ?? 4;
  const tracks = trackIds(pack).filter((id) => state.locked[id] === undefined);
  const weight = new Map(tracks.map((id) => {
    const leader = isRegion(pack, id) ? regionLeader(state, id) : null;
    return [id, (leader !== null && leader !== playerId ? 1.3 : 1) * (0.5 + rand())] as const;
  }));
  const targets: Record<string, number> = {};
  let spent = 0;

  // Add one step at a time to the best-value track that still fits, until the budget is used or nothing fits.
  for (let guard = 0; guard < 200; guard++) {
    let best: { id: string; target: number; cost: number; score: number } | null = null;
    for (const id of tracks) {
      const m = meterOf(state, id, playerId);
      const from = targets[id] ?? m.steps;
      const target = from + 1;
      if (target > pack.rules.steps || (!m.entered && target > pack.rules.firstEntryMax)) continue;
      const cost = moveCost(pack, player, id, from, target);
      if (spent + cost > budget) continue;
      const score = (worth(id) / cost) * weight.get(id)!;
      if (!best || score > best.score) best = { id, target, cost, score };
    }
    if (!best) break;
    const trial: Plan = { ...plan, steps: { ...plan.steps, [best.id]: best.target } };
    if (validatePlan(pack, state, playerId, trial).length > 0) {
      tracks.splice(tracks.indexOf(best.id), 1); // can't afford more here with the money allowed in it
      continue;
    }
    plan.steps = trial.steps!;
    targets[best.id] = best.target;
    spent += best.cost;
    // Spread out a little: each extra step in the same place is worth a bit less.
    weight.set(best.id, weight.get(best.id)! * 0.85);
  }
  return { plan, rng };
}

export type AiLevel = "easy" | "normal" | "hard";

/** Ways to play a personality can have: every strategy the balance simulator found competitive. */
export const PERSONALITY_STRATEGIES: StrategyId[] = ["balanced", "big-regions", "small-regions", "groups", "rush"];

export interface Personality {
  strategy: StrategyId;
  /** Region groups this player treats as home turf. */
  favourites: string[];
  tuning: Partial<Tuning>;
}

/** How much more a player values its favourite areas, and the random spread on every other track. */
const HOME_BONUS = 0.3;
const WOBBLE = 0.08;

/**
 * A Normal or Hard player's character for one match: a way to play and a couple of favourite areas it values more.
 * Without one, bots that think alike chase the same regions every turn and clash. Fixed for the whole match: worked out
 * from the match seed and the player's id, so it needs nothing saved.
 */
export function personality(pack: MapPack, state: GameState, playerId: string): Personality {
  const table = matchKey(state);
  let rng = seedRng(hashString(`${table}:${playerId}`));
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const strategy = PERSONALITY_STRATEGIES[Math.floor(rand() * PERSONALITY_STRATEGIES.length)]!;
  // Home turf: areas, not groups that cover most of the map.
  const areas = pack.groups.filter((g) => g.kind === "state" && g.regions.length > 0 && g.regions.length <= pack.regions.length / 2).map((g) => g.id);
  const favourites: string[] = [];
  for (let i = 0; i < 2 && areas.length > 0; i++) favourites.push(areas.splice(Math.floor(rand() * areas.length), 1)[0]!);
  const home = new Set(pack.groups.filter((g) => favourites.includes(g.id)).flatMap((g) => g.regions));
  const affinity: Record<string, number> = {};
  for (const id of trackIds(pack)) affinity[id] = (1 + WOBBLE * (2 * rand() - 1)) * (home.has(id) ? 1 + HOME_BONUS : 1);
  return { strategy, favourites, tuning: { ...STRATEGIES[strategy].tuning, affinity } };
}

/** Plans a turn for a computer player at the given difficulty. Normal and Hard play to their personality. */
export function planAi(pack: MapPack, state: GameState, playerId: string, level: AiLevel, rng: number): AiResult {
  if (level === "easy") return planEasy(pack, state, playerId, rng);
  return planSmart(pack, state, playerId, level, rng, personality(pack, state, playerId).tuning);
}
