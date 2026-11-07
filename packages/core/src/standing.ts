import type { GameState, MapPack, Meter } from "./types.js";

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
 * Splits a region's seats by pip share using the largest-remainder method.
 * Remainder ties go to the higher standing in the region. Players with no pips get no seats.
 */
export function splitSeats(state: GameState, regionId: string, seats: number): Record<string, number> {
  const ranked = regionRanking(state, regionId);
  const pips = ranked.map((id) => meterOf(state, regionId, id).steps);
  const total = pips.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  ranked.forEach((id) => (out[id] = 0));
  if (total === 0) return out;
  const quotas = pips.map((p) => (seats * p) / total);
  let given = 0;
  quotas.forEach((q, i) => {
    const f = Math.floor(q);
    out[ranked[i]!] = f;
    given += f;
  });
  // Ranked order is the tiebreak, so a stable sort on remainder alone is enough.
  const order = quotas.map((q, i) => ({ i, rem: q - Math.floor(q) })).sort((x, y) => y.rem - x.rem);
  for (let k = 0; given < seats; k++, given++) {
    const id = ranked[order[k % order.length]!.i]!;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** Seats per player if the election were held now (Parliamentary). */
export function projectedSeats(pack: MapPack, state: GameState): Record<string, number> {
  const totals: Record<string, number> = {};
  state.players.forEach((p) => (totals[p.id] = 0));
  for (const r of pack.regions) {
    const split = splitSeats(state, r.id, r.seats);
    for (const [id, n] of Object.entries(split)) totals[id] = (totals[id] ?? 0) + n;
  }
  return totals;
}

export function totalSeats(pack: MapPack): number {
  return pack.regions.reduce((a, r) => a + r.seats, 0);
}

export function majority(pack: MapPack): number {
  return Math.floor(totalSeats(pack) / 2) + 1;
}

/** A player's pips across every region (national group meters don't count). */
export function totalPips(pack: MapPack, state: GameState, playerId: string): number {
  return pack.regions.reduce((a, r) => a + (state.meters[r.id]?.[playerId]?.steps ?? 0), 0);
}
