/**
 * Computer opponents. Easy: invests most of its money each turn, mostly in regions that give many seats for their
 * cost, enters new regions steadily, picks and assigns party members, and never thinks about conflicts. Normal and
 * Hard come later (milestone M1.5). Deterministic: all randomness comes from the seeded generator passed in.
 */
import { moveCost, playerById } from "./costs.js";
import { isRegion, totalMoney, trackIds } from "./economy.js";
import { nextRandom } from "./rng.js";
import { meterOf, regionLeader } from "./standing.js";
import { canPick, pickPool, validatePlan } from "./turn.js";
import type { GameState, MapPack, Plan } from "./types.js";

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
