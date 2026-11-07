import { grantIncome } from "./economy.js";
import { majority, meterOf, splitSeats, totalPips } from "./standing.js";
import type { GameState, MapPack } from "./types.js";

export interface ElectionResult {
  /** Seats won in each region, by player. */
  regionSeats: Record<string, Record<string, number>>;
  /** Total seats by player. */
  seats: Record<string, number>;
  /** Players from first to last. */
  ranking: string[];
  /** True when two or more players tied for most seats in the first round, which starts a second round. */
  secondRound: boolean;
  /** Government formation, for display only. */
  government: Government;
  /** Votes by player: each region's voters split by pip share. Shown on election night; never affects the result. */
  popularVote: Record<string, number>;
}

export interface Government {
  /** Largest party first, then partners from largest to smallest until the majority is reached. */
  members: string[];
  /** Second-largest party. */
  opposition: string | null;
  /** Parties left outside once the majority is reached. */
  outside: string[];
  /** Seats the government holds. */
  seats: number;
  hasMajority: boolean;
}

/**
 * Counts the election (Parliamentary): each region's seats are split by pip share. Most seats wins.
 * A tie for most seats in the first round means a second round (see startSecondRound). In later rounds
 * a tie is broken by total pips, then by less money spent.
 */
export function countElection(pack: MapPack, state: GameState): ElectionResult {
  if (pack.gameType !== "parliamentary") throw new Error("Presidential elections are not implemented yet");
  const regionSeats: Record<string, Record<string, number>> = {};
  const seats: Record<string, number> = {};
  state.players.forEach((p) => (seats[p.id] = 0));
  for (const r of pack.regions) {
    const split = splitSeats(state, r.id, r.seats);
    regionSeats[r.id] = split;
    for (const [id, n] of Object.entries(split)) seats[id] = (seats[id] ?? 0) + n;
  }

  const seatOrder = state.players.map((p) => p.id);
  const bySeats = [...seatOrder].sort((a, b) => seats[b]! - seats[a]!);
  const top = seats[bySeats[0]!]!;
  const tiedForTop = bySeats.filter((id) => seats[id] === top).length > 1;
  const secondRound = tiedForTop && state.round === 1;

  const spent = (id: string) => state.players.find((p) => p.id === id)!.spent;
  const ranking = [...seatOrder].sort(
    (a, b) =>
      seats[b]! - seats[a]! ||
      totalPips(pack, state, b) - totalPips(pack, state, a) ||
      spent(a) - spent(b) ||
      seatOrder.indexOf(a) - seatOrder.indexOf(b),
  );

  return { regionSeats, seats, ranking, secondRound, government: formGovernment(ranking, seats, majority(pack)), popularVote: popularVote(pack, state) };
}

/** Each region's voters split by pip share (largest remainder). Regions without a voter count are skipped. */
export function popularVote(pack: MapPack, state: GameState): Record<string, number> {
  const votes: Record<string, number> = {};
  state.players.forEach((p) => (votes[p.id] = 0));
  for (const r of pack.regions) {
    if (!r.voters) continue;
    for (const [id, n] of Object.entries(splitSeats(state, r.id, r.voters))) votes[id] = (votes[id] ?? 0) + n;
  }
  return votes;
}

export interface ElectionCall {
  regionId: string;
  /** Seats each player won in this region. */
  seats: Record<string, number>;
  /** The player with the most seats here (ties go to the higher standing), or null if nobody campaigned. */
  winner: string | null;
  /** Running seat totals after this call. */
  totals: Record<string, number>;
  /** Set on the call that first takes a player past the majority. */
  majorityFor?: string;
}

/** Election night, call by call, in the pack's call order: who won each region and the running totals. */
export function electionCalls(pack: MapPack, state: GameState): ElectionCall[] {
  const order = pack.callOrder ?? pack.regions.map((r) => r.id);
  const totals: Record<string, number> = {};
  state.players.forEach((p) => (totals[p.id] = 0));
  const needed = majority(pack);
  let crossed = false;
  return order.map((regionId) => {
    const region = pack.regions.find((r) => r.id === regionId)!;
    const seats = splitSeats(state, regionId, region.seats);
    for (const [id, n] of Object.entries(seats)) totals[id] = (totals[id] ?? 0) + n;
    // splitSeats lists players in standing order, so the first with the most seats is the region's winner.
    const best = Object.entries(seats).reduce<[string, number] | null>((a, [id, n]) => (n > 0 && (!a || n > a[1]) ? [id, n] : a), null);
    const call: ElectionCall = { regionId, seats, winner: best ? best[0] : null, totals: { ...totals } };
    const over = Object.entries(totals).find(([, n]) => n >= needed);
    if (!crossed && over) {
      crossed = true;
      call.majorityFor = over[0];
    }
    return call;
  });
}

/** The largest party forms the government; partners join from largest to smallest until it holds a majority. */
export function formGovernment(ranking: string[], seats: Record<string, number>, needed: number): Government {
  const [first, ...rest] = ranking;
  if (first === undefined) return { members: [], opposition: null, outside: [], seats: 0, hasMajority: false };
  const opposition = rest[0] ?? null;
  const members = [first];
  let total = seats[first] ?? 0;
  const outside: string[] = [];
  for (const id of rest.slice(1)) {
    if (total >= needed) outside.push(id);
    else {
      members.push(id);
      total += seats[id] ?? 0;
    }
  }
  return { members, opposition, outside, seats: total, hasMajority: total >= needed };
}

/**
 * Second round after a tie for most seats: every player loses pips in every region (never below 0), region locks open,
 * national group meters are left as they are,
 * the order of who reached each remaining step first is kept, money is kept, and the campaign continues.
 */
export function startSecondRound(pack: MapPack, before: GameState): GameState {
  const state = structuredClone(before);
  const loss = pack.rules.secondRoundPipLoss;
  for (const r of pack.regions) {
    for (const p of state.players) {
      const m = meterOf(state, r.id, p.id);
      m.steps = Math.max(0, m.steps - loss);
      m.reached = m.reached.slice(0, m.steps);
    }
  }
  for (const r of pack.regions) delete state.locked[r.id];
  state.round += 1;
  state.phase = "campaign";
  grantIncome(pack, state, []);
  return state;
}

/** Counts the election and moves the match on: to a second round on a first-round tie, otherwise to finished. */
export function finishElection(pack: MapPack, state: GameState): { state: GameState; result: ElectionResult } {
  if (state.phase !== "election") throw new Error("The election hasn't started");
  const result = countElection(pack, state);
  if (result.secondRound) return { state: startSecondRound(pack, state), result };
  return { state: { ...structuredClone(state), phase: "finished" }, result };
}
