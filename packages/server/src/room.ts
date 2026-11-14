/**
 * A private online match: the lobby while friends join by invite code, then the match itself, played on the server.
 * Pure logic with no Cloudflare APIs, so it can be tested directly; the Durable Object (match.ts) stores it and carries
 * its messages over WebSockets.
 *
 * Each turn, every person still in the race sends a plan. When the last one arrives the server plans for the computer
 * parties, resolves the turn and sends everyone the full set of plans with the random stream used, so each device plays
 * the turn itself (for the recap) and lands on exactly the board the server holds.
 */
import {
  activePlayers,
  createMatch,
  planComputers,
  playOut,
  playTurn,
  validateCustom,
  validatePlan,
  withCustomCandidates,
  type AiLevel,
  type CustomCandidate,
  type ElectionResult,
  type GameState,
  type MapPack,
  type Plan,
} from "@majority-map/core";
import pkPack from "@majority-map/content/packs/pk/pack.json";
import ukPack from "@majority-map/content/packs/uk/pack.json";
import usPack from "@majority-map/content/packs/us/pack.json";

export const PACKS: Record<string, MapPack> = { uk: ukPack as unknown as MapPack, pk: pkPack as unknown as MapPack, us: usPack as unknown as MapPack };

export interface SeatSetup {
  id: string;
  kind: "human" | "ai";
  label: string;
  level: AiLevel;
  party: { name: string; color: string; emblem: string };
  leaderId: string;
}

/** What the host chose on the setup screen. */
export interface MatchSetup {
  map: string;
  seats: SeatSetup[];
  customs?: CustomCandidate[];
  luck?: boolean;
}

export interface RoomSeat extends SeatSetup {
  /** The person in this seat, once someone has taken it. */
  accountId?: string;
  playerName?: string;
}

/** One resolved turn as sent to every device: all plans, and the random stream left after the computers planned. */
export interface TurnLog {
  /** Position in the match's list of turns, from 0, so a device can tell when it has missed one. */
  index: number;
  turn: number;
  plans: Record<string, Plan>;
  rng: number;
}

export interface RoomData {
  code: string;
  /** The match's row in the database. */
  matchId: string;
  status: "lobby" | "active" | "finished";
  host: string;
  setup: MatchSetup;
  seats: RoomSeat[];
  seed: number;
  state: GameState | null;
  /** This turn's plans so far, by seat. */
  plans: Record<string, Plan>;
  log: TurnLog[];
  result: ElectionResult | null;
  createdAt: number;
}

/** What one device is told about the match; the plans other people have sent stay secret until the turn resolves. */
export interface RoomView {
  type: "room";
  code: string;
  status: RoomData["status"];
  youHost: boolean;
  /** Your seat, once you have one. */
  you: string | null;
  setup: MatchSetup;
  seats: { id: string; kind: "human" | "ai"; label: string; level: AiLevel; party: SeatSetup["party"]; leaderId: string; playerName: string | null }[];
  /** The board now (from the start of the match). */
  state: GameState | null;
  /** How many turns have resolved: the board is the one after that many. */
  turnsPlayed: number;
  /** Seats that have sent this turn's plan. */
  submitted: string[];
  /** Your own plan for this turn, if you've sent it (so a reload shows it). */
  yourPlan: Plan | null;
  result: ElectionResult | null;
}

export type ServerMessage = RoomView | ({ type: "turn" } & TurnLog) | { type: "error"; message: string };

export class RoomError extends Error {}

export function packFor(setup: MatchSetup): MapPack {
  const base = PACKS[setup.map];
  if (!base) throw new RoomError("Unknown map");
  return withCustomCandidates(base, setup.customs ?? []);
}

const LEVELS: AiLevel[] = ["easy", "normal", "hard"];

/** Checks a setup before a lobby opens: the map, 2 to 5 seats with at least two people, fair custom candidates. */
export function checkSetup(setup: MatchSetup): void {
  if (!setup || typeof setup !== "object" || !Array.isArray(setup.seats)) throw new RoomError("Missing setup");
  const base = PACKS[setup.map];
  if (!base) throw new RoomError("Unknown map");
  if (setup.seats.length < 2 || setup.seats.length > 5) throw new RoomError("A match needs 2 to 5 seats");
  if (setup.seats.filter((s) => s.kind === "human").length < 2) throw new RoomError("Leave at least one seat for a friend");
  for (const s of setup.seats) {
    if (s.kind !== "human" && s.kind !== "ai") throw new RoomError("Each seat is a person or the computer");
    if (!LEVELS.includes(s.level)) throw new RoomError("Unknown computer level");
    if (typeof s.label !== "string" || s.label.length > 28) throw new RoomError("Seat names are up to 28 characters");
    if (typeof s.party?.name !== "string" || !s.party.name.trim() || s.party.name.length > 28) throw new RoomError("Each party needs a name of up to 28 characters");
  }
  const customs = setup.customs ?? [];
  if (!Array.isArray(customs) || customs.length > 5) throw new RoomError("Too many custom candidates");
  for (const c of customs) if (c.packId !== base.id || validateCustom(base, c).length > 0) throw new RoomError("A custom candidate breaks the creator's rules");
  try {
    createMatch(packFor(setup), { seed: 1, players: playersOf(setup.seats) });
  } catch (e) {
    throw new RoomError(e instanceof Error ? e.message : "That setup can't start");
  }
}

function playersOf(seats: SeatSetup[]) {
  return seats.map((s) => ({ id: s.id, leaderId: s.leaderId, party: { ...s.party, name: s.party.name.trim() } }));
}

/** A new lobby. The host takes the first person's seat. */
export function newRoom(code: string, matchId: string, setup: MatchSetup, host: { accountId: string; name: string }, seed: number, now: number): RoomData {
  checkSetup(setup);
  const seats: RoomSeat[] = setup.seats.map((s) => ({ ...s }));
  const first = seats.find((s) => s.kind === "human")!;
  first.accountId = host.accountId;
  first.playerName = host.name;
  return { code, matchId, status: "lobby", host: host.accountId, setup, seats, seed, state: null, plans: {}, log: [], result: null, createdAt: now };
}

export const seatOf = (room: RoomData, accountId: string) => room.seats.find((s) => s.accountId === accountId) ?? null;

export function view(room: RoomData, accountId: string): RoomView {
  const mine = seatOf(room, accountId);
  return {
    type: "room",
    code: room.code,
    status: room.status,
    youHost: room.host === accountId,
    you: mine?.id ?? null,
    setup: room.setup,
    seats: room.seats.map((s) => ({ id: s.id, kind: s.kind, label: s.label, level: s.level, party: s.party, leaderId: s.leaderId, playerName: s.playerName ?? null })),
    state: room.state,
    turnsPlayed: room.log.length,
    submitted: Object.keys(room.plans),
    yourPlan: mine ? (room.plans[mine.id] ?? null) : null,
    result: room.result,
  };
}

/** Takes the first free person's seat; someone already seated keeps theirs (a reload or a second tab). */
export function join(room: RoomData, accountId: string, name: string): RoomSeat {
  const mine = seatOf(room, accountId);
  if (mine) {
    mine.playerName = name;
    return mine;
  }
  if (room.status !== "lobby") throw new RoomError("This match has already started");
  const free = room.seats.find((s) => s.kind === "human" && !s.accountId);
  if (!free) throw new RoomError("This match is full");
  free.accountId = accountId;
  free.playerName = name;
  return free;
}

/** Leaving the lobby frees the seat; the host can't leave (closing the lobby is simply not starting it). */
export function leave(room: RoomData, accountId: string): void {
  const mine = seatOf(room, accountId);
  if (!mine || room.status !== "lobby" || room.host === accountId) return;
  delete mine.accountId;
  delete mine.playerName;
}

export function start(room: RoomData, accountId: string): void {
  if (room.host !== accountId) throw new RoomError("Only the host can start the match");
  if (room.status !== "lobby") throw new RoomError("The match has already started");
  if (room.seats.some((s) => s.kind === "human" && !s.accountId)) throw new RoomError("Wait until every friend's seat is taken");
  room.state = createMatch(packFor(room.setup), { seed: room.seed, players: playersOf(room.seats), ...(room.setup.luck ? { luck: true } : {}) });
  room.status = "active";
}

const humansIn = (room: RoomData, state: GameState) => {
  const active = new Set(activePlayers(state).map((p) => p.id));
  return room.seats.filter((s) => s.kind === "human" && active.has(s.id));
};

/** What happened when a plan arrived: the turns that resolved (usually none or one). */
export interface SubmitOutcome {
  turns: TurnLog[];
  finished: boolean;
}

/**
 * A person's plan for this turn. Plans can be changed until the turn resolves; when everyone still in the race has
 * sent one, the turn resolves. Presidential: once no person is left in the race, the computers play on to a winner.
 */
export function submit(room: RoomData, accountId: string, turn: number, plan: Plan): SubmitOutcome {
  const mine = seatOf(room, accountId);
  if (!mine) throw new RoomError("You don't have a seat in this match");
  if (room.status !== "active" || !room.state) throw new RoomError("The match isn't being played");
  if (turn !== room.state.turn) throw new RoomError("That plan is for another turn");
  const pack = packFor(room.setup);
  const state = room.state;
  if (!humansIn(room, state).some((s) => s.id === mine.id)) throw new RoomError("You're out of the race");
  if (!plan || typeof plan !== "object" || validatePlan(pack, state, mine.id, plan).length > 0) throw new RoomError("That plan breaks the rules");
  room.plans[mine.id] = plan;
  if (humansIn(room, state).some((s) => !room.plans[s.id])) return { turns: [], finished: false };

  const levels = Object.fromEntries(room.seats.filter((s) => s.kind === "ai").map((s) => [s.id, s.level])) as Record<string, AiLevel>;
  const ai = planComputers(pack, state, levels);
  const plans = { ...room.plans, ...ai.plans };
  const played = playTurn(pack, state, plans, ai.rng);
  const log: TurnLog = { index: room.log.length, turn: state.turn, plans, rng: ai.rng };
  room.log.push(log);
  room.plans = {};
  room.state = played.next;
  if (played.next.phase === "finished" && played.election) {
    room.result = played.election.result;
    room.status = "finished";
  } else if (humansIn(room, played.next).length === 0) {
    // Every person is out: the devices play this out themselves from the same board, and so does the server.
    const levelOf = (id: string) => {
      const seat = room.seats.find((s) => s.id === id);
      return seat?.kind === "ai" ? seat.level : null;
    };
    const out = playOut(pack, played.next, levelOf);
    room.state = out.state;
    room.result = out.result;
    room.status = "finished";
  }
  return { turns: [log], finished: room.status === "finished" };
}
