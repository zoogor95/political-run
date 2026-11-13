import type { GameState, MapPack, Meter, ReservedSeatsDef, UnitDef } from "./types.js";

export function meterOf(state: GameState, regionId: string, playerId: string): Meter {
  const m = state.meters[regionId]?.[playerId];
  if (!m) throw new Error(`No meter for ${playerId} in ${regionId}`);
  return m;
}

/**
 * Compares two players' standing in a region: more steps wins; on equal steps, whoever reached that step first wins.
 * If they reached it at the same moment (two free pips on one turn), the earlier of the step below decides, and so on;
 * then seat order. Returns a negative number if a ranks above b.
 */
export function compareStanding(state: GameState, regionId: string, a: string, b: string): number {
  const ma = meterOf(state, regionId, a);
  const mb = meterOf(state, regionId, b);
  if (ma.steps !== mb.steps) return mb.steps - ma.steps;
  for (let i = ma.steps - 1; i >= 0; i--) {
    const d = (ma.reached[i] ?? 0) - (mb.reached[i] ?? 0);
    if (d !== 0) return d;
  }
  return seatIndex(state, a) - seatIndex(state, b);
}

function seatIndex(state: GameState, id: string): number {
  return state.players.findIndex((p) => p.id === id);
}

/** Players ranked by standing in a region, leader first. */
export function regionRanking(state: GameState, regionId: string): string[] {
  return state.players.map((p) => p.id).sort((a, b) => compareStanding(state, regionId, a, b));
}

/** The player leading a region, or null if nobody has a step there. */
export function regionLeader(state: GameState, regionId: string): string | null {
  const top = regionRanking(state, regionId)[0];
  return top !== undefined && meterOf(state, regionId, top).steps > 0 ? top : null;
}

export function inContention(pack: MapPack, state: GameState, regionId: string): boolean {
  return state.players.some((p) => meterOf(state, regionId, p.id).steps >= pack.rules.contentionAt);
}

export function allInContention(pack: MapPack, state: GameState): boolean {
  return pack.regions.every((r) => inContention(pack, state, r.id));
}

/**
 * Shares out a whole number in proportion to weights by the largest-remainder method. Remainder ties go to the earlier
 * weight, so callers list weights in tiebreak order. Every share is 0 when every weight is 0.
 */
export function shareOut(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const quotas = weights.map((w) => (total * w) / sum);
  const out = quotas.map(Math.floor);
  let given = out.reduce((a, b) => a + b, 0);
  // A stable sort on remainder alone keeps the callers' order for ties.
  const order = quotas.map((q, i) => ({ i, rem: q - Math.floor(q) })).sort((x, y) => y.rem - x.rem);
  for (let k = 0; given < total; k++, given++) out[order[k % order.length]!.i]! += 1;
  return out;
}

/**
 * Splits a region's seats by pip share using the largest-remainder method.
 * Remainder ties go to the higher standing in the region. Players with no pips get no seats.
 */
export function splitSeats(state: GameState, regionId: string, seats: number): Record<string, number> {
  const ranked = regionRanking(state, regionId);
  const shares = shareOut(seats, ranked.map((id) => meterOf(state, regionId, id).steps));
  return Object.fromEntries(ranked.map((id, i) => [id, shares[i]!]));
}

/** A region's result units, biggest first (ties by id); empty when its seats are split one by one. */
export function regionUnits(pack: MapPack, regionId: string): UnitDef[] {
  let byRegion = unitsByRegion.get(pack);
  if (!byRegion) {
    byRegion = new Map();
    for (const u of pack.units ?? []) byRegion.set(u.region, [...(byRegion.get(u.region) ?? []), u]);
    for (const list of byRegion.values()) list.sort((a, b) => b.seats - a.seats || (a.id < b.id ? -1 : 1));
    unitsByRegion.set(pack, byRegion);
  }
  return byRegion.get(regionId) ?? [];
}

const unitsByRegion = new WeakMap<MapPack, Map<string, UnitDef[]>>();

/**
 * Who takes each of a region's units. Seats are first shared out by pip share (splitSeats); then, biggest unit first,
 * each unit goes to the player furthest short of that share, so the leader takes the biggest unit. Ties go to the
 * higher standing. Players with no pips take nothing; with nobody campaigning every unit is null.
 */
export function unitWinners(pack: MapPack, state: GameState, regionId: string): Record<string, string | null> {
  const region = pack.regions.find((r) => r.id === regionId)!;
  const entitled = splitSeats(state, regionId, region.seats);
  const ranked = Object.keys(entitled).filter((id) => meterOf(state, regionId, id).steps > 0);
  const short = new Map(ranked.map((id) => [id, entitled[id]!]));
  const out: Record<string, string | null> = {};
  for (const u of regionUnits(pack, regionId)) {
    let best: string | null = null;
    for (const id of ranked) if (best === null || short.get(id)! > short.get(best)!) best = id;
    out[u.id] = best;
    if (best !== null) short.set(best, short.get(best)! - u.seats);
  }
  return out;
}

/** Seats each player wins in a region: split one by one, or in whole units where the region has them. */
export function wonInRegion(pack: MapPack, state: GameState, regionId: string): Record<string, number> {
  const region = pack.regions.find((r) => r.id === regionId)!;
  const units = regionUnits(pack, regionId);
  const split = splitSeats(state, regionId, region.seats);
  if (units.length === 0) return split;
  const winners = unitWinners(pack, state, regionId);
  for (const id of Object.keys(split)) split[id] = 0;
  for (const u of units) {
    const w = winners[u.id];
    if (w) split[w] = (split[w] ?? 0) + u.seats;
  }
  return split;
}

/** Seats each player wins in each region if the election were held now. */
export function regionSeats(pack: MapPack, state: GameState): Record<string, Record<string, number>> {
  return Object.fromEntries(pack.regions.map((r) => [r.id, wonInRegion(pack, state, r.id)]));
}

/** The regions whose general seats decide a set of reserved seats. */
export function reservedScope(pack: MapPack, def: ReservedSeatsDef): string[] {
  if (def.group === undefined) return pack.regions.map((r) => r.id);
  return pack.groups.find((g) => g.id === def.group)?.regions ?? [];
}

/**
 * Reserved seats by set and player, shared out by general seats won in each set's scope. Remainder ties go to the
 * player with more general seats there, then seat order.
 */
export function allocateReserved(pack: MapPack, state: GameState, won: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const def of pack.reservedSeats ?? []) {
    const scope = reservedScope(pack, def);
    const general = state.players.map((p) => scope.reduce((a, r) => a + (won[r]?.[p.id] ?? 0), 0));
    const order = state.players.map((_, i) => i).sort((a, b) => general[b]! - general[a]!);
    const shares = shareOut(def.seats, order.map((i) => general[i]!));
    out[def.id] = Object.fromEntries(state.players.map((p) => [p.id, 0]));
    order.forEach((i, k) => (out[def.id]![state.players[i]!.id] = shares[k]!));
  }
  return out;
}

/** Seats per player if the election were held now (Parliamentary), reserved seats included. */
export function projectedSeats(pack: MapPack, state: GameState): Record<string, number> {
  const won = regionSeats(pack, state);
  const totals: Record<string, number> = {};
  state.players.forEach((p) => (totals[p.id] = 0));
  for (const split of Object.values(won)) for (const [id, n] of Object.entries(split)) totals[id] = (totals[id] ?? 0) + n;
  for (const set of Object.values(allocateReserved(pack, state, won))) for (const [id, n] of Object.entries(set)) totals[id] = (totals[id] ?? 0) + n;
  return totals;
}

/** Seats won in regions. */
export function generalSeats(pack: MapPack): number {
  return pack.regions.reduce((a, r) => a + r.seats, 0);
}

/** Every seat in the parliament: general seats plus reserved seats. */
export function totalSeats(pack: MapPack): number {
  return generalSeats(pack) + (pack.reservedSeats ?? []).reduce((a, d) => a + d.seats, 0);
}

export function majority(pack: MapPack): number {
  return Math.floor(totalSeats(pack) / 2) + 1;
}

/**
 * How many parliament seats one of a region's general seats is worth once reserved seats are shared out: 1, plus each
 * reserved set's seats per general seat in its scope. In Punjab a general seat also brings about 0.23 of a women's seat.
 */
export function seatWeight(pack: MapPack, regionId: string): number {
  let weights = seatWeights.get(pack);
  if (!weights) seatWeights.set(pack, (weights = new Map()));
  const known = weights.get(regionId);
  if (known !== undefined) return known;
  let w = 1;
  for (const def of pack.reservedSeats ?? []) {
    const scope = reservedScope(pack, def);
    if (!scope.includes(regionId)) continue;
    const general = pack.regions.filter((r) => scope.includes(r.id)).reduce((a, r) => a + r.seats, 0);
    if (general > 0) w += def.seats / general;
  }
  weights.set(regionId, w);
  return w;
}

/** Seat weights by pack: packs don't change during a match. */
const seatWeights = new WeakMap<MapPack, Map<string, number>>();

/** A player's pips across every region (national group meters don't count). */
export function totalPips(pack: MapPack, state: GameState, playerId: string): number {
  return pack.regions.reduce((a, r) => a + (state.meters[r.id]?.[playerId]?.steps ?? 0), 0);
}
