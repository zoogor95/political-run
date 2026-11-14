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
  candidateParties,
  createMatch,
  PARTY_COLORS,
  PARTY_EMBLEMS,
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
  /** Time each person has to send a plan; none means the match waits for everyone. */
  turnSeconds?: number | null;
}

/** Turn timers on offer: a minute for a quick game up to a day for a slow one. */
export const TURN_TIMERS = [60, 300, 3600, 43_200, 86_400];
/** After this many missed turns in a row, the computer plays a person's turns until they send a plan again. */
export const AUTOPILOT_AFTER = 3;

export interface RoomSeat extends SeatSetup {
  /** The person in this seat, once someone has taken it. */
  accountId?: string;
  playerName?: string;
  /** In the lobby: this person has made their picks and is ready to start. */
  ready?: boolean;
}

/** What a person can change about their own seat in the lobby. */
export interface PickChange {
  name?: string;
  color?: string;
  emblem?: string;
  leaderId?: string;
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
  /** When this turn's plans are due (with a turn timer). */
  deadline: number | null;
  /** Turns missed in a row, by seat. */
  missed: Record<string, number>;
  /** Seats the computer is playing for after too many missed turns. */
  autopilot: string[];
  /** Seats whose person resigned: the computer (Normal) plays them for the rest of the match. Absent in older rooms. */
  resigned?: string[];
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
  seats: { id: string; kind: "human" | "ai"; label: string; level: AiLevel; party: SeatSetup["party"]; leaderId: string; playerName: string | null; ready: boolean }[];
  /** The board now (from the start of the match). */
  state: GameState | null;
  /** How many turns have resolved: the board is the one after that many. */
  turnsPlayed: number;
  /** Seats that have sent this turn's plan. */
  submitted: string[];
  /** Your own plan for this turn, if you've sent it (so a reload shows it). */
  yourPlan: Plan | null;
  result: ElectionResult | null;
  deadline: number | null;
  missed: Record<string, number>;
  autopilot: string[];
  resigned: string[];
  /** The server's clock when this view was made, so a device can show the time left whatever its own clock says. */
  now: number;
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
  if (setup.turnSeconds != null && !TURN_TIMERS.includes(setup.turnSeconds)) throw new RoomError("Unknown turn timer");
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
  return { code, matchId, status: "lobby", host: host.accountId, setup, seats, seed, state: null, plans: {}, log: [], result: null, createdAt: now, deadline: null, missed: {}, autopilot: [] };
}

export const seatOf = (room: RoomData, accountId: string) => room.seats.find((s) => s.accountId === accountId) ?? null;

export function view(room: RoomData, accountId: string, now = Date.now()): RoomView {
  const mine = seatOf(room, accountId);
  return {
    type: "room",
    code: room.code,
    status: room.status,
    youHost: room.host === accountId,
    you: mine?.id ?? null,
    setup: room.setup,
    seats: room.seats.map((s) => ({ id: s.id, kind: s.kind, label: s.label, level: s.level, party: s.party, leaderId: s.leaderId, playerName: s.playerName ?? null, ready: Boolean(s.ready) })),
    state: room.state,
    turnsPlayed: room.log.length,
    submitted: Object.keys(room.plans),
    yourPlan: mine ? (room.plans[mine.id] ?? null) : null,
    result: room.result,
    deadline: room.deadline,
    missed: room.missed,
    autopilot: room.autopilot,
    resigned: room.resigned ?? [],
    now,
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
  free.ready = false;
  // A seat the host left with its placeholder name becomes the newcomer's party ("Ali Party"), if no one has that name.
  const own = `${name} Party`.slice(0, 28);
  const presidential = packFor(room.setup).gameType === "presidential";
  if (!presidential && /^(Friend|Player) \d+ Party$/.test(free.party.name) && !room.seats.some((s) => s !== free && s.party.name.toLowerCase() === own.toLowerCase())) {
    free.party = { ...free.party, name: own };
  }
  return free;
}

const cleanName = (n: string) => n.trim().replace(/\s+/g, " ");

/**
 * A person changes their own party in the lobby: name, colour, emblem or leader (Presidential: the candidate, and the
 * party follows). First come, first served: what another seat has is refused. Picks lock once you're ready.
 */
export function pick(room: RoomData, accountId: string, change: PickChange): void {
  const mine = seatOf(room, accountId);
  if (!mine) throw new RoomError("You don't have a seat in this match");
  if (room.status !== "lobby") throw new RoomError("The match has already started");
  if (mine.ready) throw new RoomError("You're ready: choose Change my pick first");
  const pack = packFor(room.setup);
  const others = room.seats.filter((s) => s !== mine);
  if (change.leaderId !== undefined) {
    const known = pack.candidates.some((c) => c.id === change.leaderId);
    if (!known) throw new RoomError("Unknown leader");
    if (others.some((s) => s.leaderId === change.leaderId)) throw new RoomError("Another seat has that leader");
    mine.leaderId = change.leaderId;
  }
  if (pack.gameType === "presidential") {
    // Every party follows from its candidate, as on the setup screen.
    const names = Object.fromEntries((room.setup.customs ?? []).map((c) => [c.id, c.name]));
    const parties = candidateParties(pack, room.seats, names);
    room.seats.forEach((s, i) => (s.party = parties[i]!.party));
    return;
  }
  const party = { ...mine.party };
  if (change.name !== undefined) {
    const n = typeof change.name === "string" ? cleanName(change.name) : "";
    if (n.length < 1 || n.length > 28) throw new RoomError("Party names are 1 to 28 characters");
    if (others.some((s) => s.party.name.toLowerCase() === n.toLowerCase())) throw new RoomError("Another party has that name");
    party.name = n;
  }
  if (change.color !== undefined) {
    const c = String(change.color).toLowerCase();
    if (!PARTY_COLORS.some((x) => x.hex === c)) throw new RoomError("Unknown colour");
    if (others.some((s) => s.party.color.toLowerCase() === c)) throw new RoomError("Someone picked that colour first");
    party.color = c;
  }
  if (change.emblem !== undefined) {
    if (!PARTY_EMBLEMS.includes(change.emblem)) throw new RoomError("Unknown emblem");
    if (others.some((s) => s.party.emblem === change.emblem)) throw new RoomError("Someone picked that emblem first");
    party.emblem = change.emblem;
  }
  mine.party = party;
}

/** Ready (picks locked) or not. */
export function setReady(room: RoomData, accountId: string, ready: boolean): void {
  const mine = seatOf(room, accountId);
  if (!mine) throw new RoomError("You don't have a seat in this match");
  if (room.status !== "lobby") throw new RoomError("The match has already started");
  mine.ready = ready;
}

/** Leaving the lobby frees the seat; the host can't leave (closing the lobby is simply not starting it). */
export function leave(room: RoomData, accountId: string): void {
  const mine = seatOf(room, accountId);
  if (!mine || room.status !== "lobby" || room.host === accountId) return;
  delete mine.accountId;
  delete mine.playerName;
}

const nextDeadline = (room: RoomData, now: number) => (room.status === "active" && room.setup.turnSeconds ? now + room.setup.turnSeconds * 1000 : null);

export function start(room: RoomData, accountId: string, now = Date.now()): void {
  if (room.host !== accountId) throw new RoomError("Only the host can start the match");
  if (room.status !== "lobby") throw new RoomError("The match has already started");
  if (room.seats.some((s) => s.kind === "human" && !s.accountId)) throw new RoomError("Wait until every friend's seat is taken");
  // The host starting is their ready; everyone else says so themselves.
  if (room.seats.some((s) => s.kind === "human" && s.accountId !== room.host && !s.ready)) throw new RoomError("Wait until everyone is ready");
  room.state = createMatch(packFor(room.setup), { seed: room.seed, players: playersOf(room.seats), ...(room.setup.luck ? { luck: true } : {}) });
  room.status = "active";
  room.deadline = nextDeadline(room, now);
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

/** People still to send a plan this turn (the computer plays for anyone on autopilot). */
export function waitingOn(room: RoomData): string[] {
  if (room.status !== "active" || !room.state) return [];
  return humansIn(room, room.state)
    .filter((s) => !room.autopilot.includes(s.id) && !room.plans[s.id])
    .map((s) => s.id);
}

/**
 * A person's plan for this turn. Plans can be changed until the turn resolves; when everyone still in the race has
 * sent one, the turn resolves. Sending a plan also ends any autopilot for that person.
 */
export function submit(room: RoomData, accountId: string, turn: number, plan: Plan, now = Date.now()): SubmitOutcome {
  const mine = seatOf(room, accountId);
  if (!mine) throw new RoomError("You don't have a seat in this match");
  if (room.status !== "active" || !room.state) throw new RoomError("The match isn't being played");
  if (turn !== room.state.turn) throw new RoomError("That plan is for another turn");
  const pack = packFor(room.setup);
  const state = room.state;
  if (!humansIn(room, state).some((s) => s.id === mine.id)) throw new RoomError("You're out of the race");
  if (!plan || typeof plan !== "object" || validatePlan(pack, state, mine.id, plan).length > 0) throw new RoomError("That plan breaks the rules");
  if (room.resigned?.includes(mine.id)) throw new RoomError("You resigned from this match");
  room.plans[mine.id] = plan;
  room.missed[mine.id] = 0;
  room.autopilot = room.autopilot.filter((id) => id !== mine.id);
  if (waitingOn(room).length > 0) return { turns: [], finished: false };
  return resolve(room, now);
}

/**
 * The turn timer ran out: anyone who hasn't sent a plan misses the turn and campaigns with nothing new this turn.
 * A third miss in a row hands their seat to the computer (Normal) from this turn on, until they send a plan again.
 */
export function timeout(room: RoomData, now = Date.now()): SubmitOutcome {
  if (room.status !== "active" || !room.state || room.deadline === null || now < room.deadline) return { turns: [], finished: false };
  for (const id of waitingOn(room)) {
    room.missed[id] = (room.missed[id] ?? 0) + 1;
    if (room.missed[id]! >= AUTOPILOT_AFTER) room.autopilot.push(id);
    else room.plans[id] = {};
  }
  return resolve(room, now);
}

/** The most turns a match can play on its own once every person has resigned (a safety net: matches end long before). */
const PLAY_ON_LIMIT = 400;

/**
 * A person resigns: the computer (Normal) takes their seat for the rest of the match, and they can't plan again. If
 * everyone else has already sent a plan, the turn resolves now; if nobody is left to plan, the match plays out to the
 * end, every turn sent to the devices as usual.
 */
export function resign(room: RoomData, accountId: string, now = Date.now()): SubmitOutcome {
  const mine = seatOf(room, accountId);
  if (!mine) throw new RoomError("You don't have a seat in this match");
  if (room.status !== "active" || !room.state) throw new RoomError("The match isn't being played");
  if (!humansIn(room, room.state).some((s) => s.id === mine.id)) throw new RoomError("You're out of the race");
  room.resigned = [...new Set([...(room.resigned ?? []), mine.id])];
  if (!room.autopilot.includes(mine.id)) room.autopilot.push(mine.id);
  delete room.plans[mine.id];
  const out: SubmitOutcome = { turns: [], finished: false };
  // Resolve while nobody is left to wait for: once for the turn in hand, or to the end if every person has resigned.
  const anyoneLeft = () => room.status === "active" && room.state !== null && humansIn(room, room.state).some((s) => !room.resigned!.includes(s.id));
  if (waitingOn(room).length > 0) return out;
  do {
    const step = resolve(room, now);
    out.turns.push(...step.turns);
    out.finished = step.finished;
  } while (!anyoneLeft() && room.status === "active" && out.turns.length < PLAY_ON_LIMIT);
  return out;
}

/** Plays the turn: the computers (and anyone on autopilot) plan, everything resolves, and the next deadline is set. */
function resolve(room: RoomData, now: number): SubmitOutcome {
  const pack = packFor(room.setup);
  const state = room.state!;
  const levels = Object.fromEntries([
    ...room.seats.filter((s) => s.kind === "ai").map((s) => [s.id, s.level]),
    ...room.autopilot.filter((id) => !room.plans[id]).map((id) => [id, "normal"]),
  ]) as Record<string, AiLevel>;
  const ai = planComputers(pack, state, levels);
  const plans = { ...ai.plans, ...room.plans };
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
  room.deadline = nextDeadline(room, now);
  return { turns: [log], finished: room.status === "finished" };
}
