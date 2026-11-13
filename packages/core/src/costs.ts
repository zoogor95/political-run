import type { CandidateDef, GameState, MapPack, PlayerState } from "./types.js";

function candidate(pack: MapPack, id: string): CandidateDef {
  const c = pack.candidates.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown candidate "${id}"`);
  return c;
}

/**
 * Total modifier, in percent, for one player on one group: the leader's full modifier plus
 * the member share (20%) of each party member's modifier. Members count from the moment they're picked.
 */
export function groupModifier(pack: MapPack, player: PlayerState, groupId: string): number {
  let pct = candidate(pack, player.leaderId).modifiers[groupId] ?? 0;
  for (const m of player.members) {
    pct += ((candidate(pack, m.candidateId).modifiers[groupId] ?? 0) * pack.rules.memberSharePct) / 100;
  }
  return pct;
}

/**
 * Step cost multiplier for a player on a track. In a region, modifiers from every state group the region belongs to
 * add together; on a national group's meter, that group's modifier applies. A +25% bonus makes steps 25% cheaper.
 * The result is clamped to the pack's range (50% to 150% by default).
 */
export function costMultiplier(pack: MapPack, player: PlayerState, trackId: string): number {
  let pct = 0;
  const national = pack.groups.find((g) => g.id === trackId && g.kind === "national");
  if (national) pct = groupModifier(pack, player, national.id);
  else {
    for (const g of pack.groups) {
      if (g.kind === "state" && g.regions.includes(trackId)) pct += groupModifier(pack, player, g.id);
    }
  }
  const m = 1 - pct / 100;
  return Math.min(pack.rules.costClampMax, Math.max(pack.rules.costClampMin, m));
}

/** Campaign cost of the first step on a region or national group meter. */
export function trackBaseCost(pack: MapPack, trackId: string): number {
  const region = pack.regions.find((r) => r.id === trackId);
  if (region) return region.baseCost;
  const group = pack.groups.find((g) => g.id === trackId && g.kind === "national");
  if (group?.baseCost !== undefined) return group.baseCost;
  throw new Error(`Unknown region or national group "${trackId}"`);
}

/** The pack's money step: every cost and income is a whole number of it. */
export function moneyStep(pack: MapPack): number {
  return pack.rules.moneyStep ?? 1000;
}

/** Rounds an amount of money to the nearest money step (1K). */
export function roundMoney(pack: MapPack, amount: number): number {
  const step = moneyStep(pack);
  return Math.round(amount / step) * step;
}

/** Cost of one step (step 1 is the first) for a player on a track, to the nearest 1K and never less than 1K. */
export function stepCost(pack: MapPack, player: PlayerState, trackId: string, step: number): number {
  return Math.max(moneyStep(pack), roundMoney(pack, trackBaseCost(pack, trackId) * costMultiplier(pack, player, trackId) * pack.rules.costGrowth ** (step - 1)));
}

/** Cost of moving from one step to a higher target step. */
export function moveCost(pack: MapPack, player: PlayerState, trackId: string, from: number, to: number): number {
  let total = 0;
  for (let s = from + 1; s <= to; s++) total += stepCost(pack, player, trackId, s);
  return total;
}

export function playerById(state: GameState, id: string): PlayerState {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown player "${id}"`);
  return p;
}
