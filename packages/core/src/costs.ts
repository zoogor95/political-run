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
 * Step cost multiplier for a player in a region. Modifiers from every state group the region belongs to add together;
 * a +25% bonus makes steps 25% cheaper. The result is clamped to the pack's range (50% to 150% by default).
 */
export function costMultiplier(pack: MapPack, player: PlayerState, regionId: string): number {
  let pct = 0;
  for (const g of pack.groups) {
    if (g.kind === "state" && g.regions.includes(regionId)) pct += groupModifier(pack, player, g.id);
  }
  const m = 1 - pct / 100;
  return Math.min(pack.rules.costClampMax, Math.max(pack.rules.costClampMin, m));
}

/** Cost of one step (step 1 is the first) for a player in a region, rounded to whole currency units. */
export function stepCost(pack: MapPack, player: PlayerState, regionId: string, step: number): number {
  const region = pack.regions.find((r) => r.id === regionId);
  if (!region) throw new Error(`Unknown region "${regionId}"`);
  return Math.round(region.baseCost * costMultiplier(pack, player, regionId) * pack.rules.costGrowth ** (step - 1));
}

/** Cost of moving from one step to a higher target step. */
export function moveCost(pack: MapPack, player: PlayerState, regionId: string, from: number, to: number): number {
  let total = 0;
  for (let s = from + 1; s <= to; s++) total += stepCost(pack, player, regionId, s);
  return total;
}

export function playerById(state: GameState, id: string): PlayerState {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown player "${id}"`);
  return p;
}
