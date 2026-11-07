/**
 * What happened in a turn, per party, worked out from the states before and after and the turn's events.
 * Feeds the turn recap, the turn summary screen and the news ticker.
 */
import { projectedSeats } from "./standing.js";
import type { GameState, MapPack, TurnEvent } from "./types.js";

export interface ConflictLine {
  regionId: string;
  step: number;
  rivals: string[];
  amount: number;
}

export interface PartySummary {
  playerId: string;
  seatsBefore: number;
  seatsAfter: number;
  /** Money spent this turn, including money lost in conflicts. */
  spent: number;
  moves: { regionId: string; from: number; to: number; cost: number; firstEntry: boolean }[];
  conflicts: ConflictLine[];
  freePips: { regionId: string; candidateId: string; to: number }[];
  groupsGained: string[];
  groupsLost: string[];
  locked: string[];
  picked: string | null;
  /** Income for the coming turn: base money plus each group controlled. Empty once the campaign is over. */
  income: { base: number; groups: Record<string, number> } | null;
}

export interface TurnSummary {
  turn: number;
  parties: PartySummary[];
  /** Regions that changed this turn, in map order: where the recap stops. */
  changedRegions: string[];
  newlyContended: string[];
  finalTurnNext: boolean;
  electionNext: boolean;
}

export function summarizeTurn(pack: MapPack, before: GameState, after: GameState, events: TurnEvent[]): TurnSummary {
  const seatsBefore = projectedSeats(pack, before);
  const seatsAfter = projectedSeats(pack, after);
  const parties: PartySummary[] = before.players.map((p) => ({
    playerId: p.id,
    seatsBefore: seatsBefore[p.id] ?? 0,
    seatsAfter: seatsAfter[p.id] ?? 0,
    spent: after.players.find((x) => x.id === p.id)!.spent - p.spent,
    moves: [],
    conflicts: [],
    freePips: [],
    groupsGained: [],
    groupsLost: [],
    locked: [],
    picked: null,
    income: null,
  }));
  const of = (id: string) => parties.find((p) => p.playerId === id)!;
  const changed = new Set<string>();
  const newlyContended: string[] = [];
  let finalTurnNext = false;
  let electionNext = false;

  for (const e of events) {
    switch (e.type) {
      case "moved":
        of(e.playerId).moves.push({ regionId: e.regionId, from: e.from, to: e.to, cost: e.cost, firstEntry: e.from === 0 });
        changed.add(e.regionId);
        break;
      case "conflict":
        for (const id of e.playerIds) of(id).conflicts.push({ regionId: e.regionId, step: e.step, rivals: e.playerIds.filter((x) => x !== id), amount: e.costs[id] ?? 0 });
        changed.add(e.regionId);
        break;
      case "free_pip":
        of(e.playerId).freePips.push({ regionId: e.regionId, candidateId: e.candidateId, to: e.to });
        changed.add(e.regionId);
        break;
      case "locked":
        of(e.playerId).locked.push(e.regionId);
        break;
      case "control_gained":
        of(e.playerId).groupsGained.push(e.groupId);
        break;
      case "control_lost":
        of(e.playerId).groupsLost.push(e.groupId);
        break;
      case "picked":
        of(e.playerId).picked = e.candidateId;
        break;
      case "income":
        of(e.playerId).income = { base: e.base, groups: e.groups };
        break;
      case "contention":
        newlyContended.push(e.regionId);
        break;
      case "final_turn":
        finalTurnNext = true;
        break;
      case "election":
        electionNext = true;
        break;
      case "assigned":
        break;
    }
  }
  const order = [...pack.regions.map((r) => r.id), ...pack.groups.map((g) => g.id)];
  return {
    turn: before.turn,
    parties,
    changedRegions: [...changed].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    newlyContended,
    finalTurnNext,
    electionNext,
  };
}
