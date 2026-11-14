/**
 * One turn of a match from start to finish: the computer parties plan, every plan resolves, and on the final turn the
 * votes are counted. Shared by the device (solo, pass and play) and the server (online matches), so both play a turn
 * exactly the same way from the same plans and random stream.
 */
import { planAi, type AiLevel } from "./ai.js";
import { finishElection, type ElectionResult } from "./election.js";
import { resolveTurn } from "./turn.js";
import type { GameState, MapPack, Plan, TurnEvent } from "./types.js";

/** The computer parties' plans, drawing on the match's random stream in seat order; and the stream after them. */
export function planComputers(pack: MapPack, state: GameState, levels: Record<string, AiLevel>): { plans: Record<string, Plan>; rng: number } {
  let rng = state.rng;
  const plans: Record<string, Plan> = {};
  for (const p of state.players) {
    const level = levels[p.id];
    if (!level) continue;
    const r = planAi(pack, state, p.id, level, rng);
    rng = r.rng;
    plans[p.id] = r.plan;
  }
  return { plans, rng };
}

export interface TurnPlayed {
  /** The board right after the turn resolved, before any count. */
  resolved: GameState;
  events: TurnEvent[];
  /** The board after the turn, and after the count when there was one. */
  next: GameState;
  /** The count, when this was the final turn of a round. */
  election: { atCount: GameState; result: ElectionResult } | null;
}

/** Resolves every party's plan (with the random stream left after the computers planned), then counts if it's time. */
export function playTurn(pack: MapPack, state: GameState, plans: Record<string, Plan>, rng: number): TurnPlayed {
  const r = resolveTurn(pack, { ...state, rng }, plans);
  if (r.state.phase !== "election") return { resolved: r.state, events: r.events, next: r.state, election: null };
  const done = finishElection(pack, r.state);
  return { resolved: r.state, events: r.events, next: done.state, election: { atCount: r.state, result: done.result } };
}

/**
 * Presidential, once no person is left in the race: the computer candidates play on to a winner. Returns the end
 * state, the deciding result and the board at that count.
 */
export function playOut(pack: MapPack, from: GameState, levelOf: (id: string) => AiLevel | null): { state: GameState; result: ElectionResult; atCount: GameState } {
  let s = from;
  for (let guard = 0; guard < 400; guard++) {
    if (s.phase === "election") {
      const done = finishElection(pack, s);
      if (done.state.phase === "finished") return { state: done.state, result: done.result, atCount: s };
      s = done.state;
      continue;
    }
    const levels = Object.fromEntries(s.players.map((p) => [p.id, levelOf(p.id) ?? "normal"])) as Record<string, AiLevel>;
    const ai = planComputers(pack, s, levels);
    s = resolveTurn(pack, { ...s, rng: ai.rng }, ai.plans).state;
  }
  const result = finishElection(pack, { ...s, phase: "election" });
  return { state: result.state, result: result.result, atCount: s };
}
