/**
 * Private online matches: open a lobby from a setup, join one by invite code, and the live link to the match on the
 * game's server. The server holds the match and resolves each turn; every device is sent all the plans with the random
 * stream used and plays the turn itself, so the recap and the board are exactly the server's.
 */
import type { AiLevel, ElectionResult, GameState, Plan } from "@majority-map/core";
import { API_URL, CloudError, ensureAccount, sessionToken } from "./cloud";
import { isMapId } from "./model";
import type { MatchConfig, Seat } from "./setup";

/** What the server tells this device about the match (packages/server/src/room.ts, RoomView). */
export interface RoomView {
  type: "room";
  code: string;
  status: "lobby" | "active" | "finished";
  youHost: boolean;
  you: string | null;
  setup: { map: string; seats: Seat[]; customs?: MatchConfig["customs"]; luck?: boolean; turnSeconds?: number | null };
  seats: { id: string; kind: "human" | "ai"; label: string; level: AiLevel; party: Seat["party"]; leaderId: string; playerName: string | null; ready: boolean }[];
  state: GameState | null;
  turnsPlayed: number;
  submitted: string[];
  yourPlan: Plan | null;
  result: ElectionResult | null;
  /** When this turn's plans are due, by the server's clock. */
  deadline: number | null;
  missed: Record<string, number>;
  /** Seats the computer is playing for after missed turns. */
  autopilot: string[];
  /** The server's clock when it sent this. */
  now: number;
}

/** One of the player's matches, for the ongoing matches list. */
export interface MatchSummary {
  code: string;
  status: "lobby" | "active" | "finished";
  map: string;
  turn: number;
  deadline: number | null;
  createdAt: number;
  finishedAt: number | null;
  party: string | null;
  people: number;
  yourMove: boolean;
}

/** One resolved turn: every party's plan and the random stream left after the computers planned. */
export interface TurnLog {
  index: number;
  turn: number;
  plans: Record<string, Plan>;
  rng: number;
}

type ServerMessage = RoomView | ({ type: "turn" } & TurnLog) | { type: "error"; message: string };

/** Invite codes: six characters, read out or typed in any case; O and I/L mean 0 and 1. */
export function normalizeInvite(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(raw) ? raw : null;
}

/** The link a host shares: opens the game straight into the lobby. */
export function inviteLink(code: string): string {
  const url = new URL(location.href);
  url.search = `?join=${code}`;
  url.hash = "";
  return url.toString();
}

/** Opens a lobby for the setup chosen on the setup screen; returns its invite code. */
export async function openLobby(config: MatchConfig): Promise<string> {
  await ensureAccount();
  const setup = { map: config.map ?? "uk", seats: config.seats, customs: config.customs ?? [], ...(config.luck ? { luck: true } : {}), turnSeconds: config.turnSeconds ?? null };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/matches`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken()}` }, body: JSON.stringify({ setup }) });
  } catch {
    throw new CloudError("Couldn't reach the game's server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as { code?: string; error?: { message: string } } | null;
  if (!res.ok || !data?.code) throw new CloudError(data?.error?.message ?? "The game's server had a problem. Try again in a minute.");
  return data.code;
}

/** The player's lobbies, matches in play (their move first) and recent results. Times are on this device's clock. */
export async function myMatches(): Promise<MatchSummary[]> {
  await ensureAccount();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/matches/mine`, { headers: { authorization: `Bearer ${sessionToken()}` } });
  } catch {
    throw new CloudError("Couldn't reach the game's server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as { matches: MatchSummary[]; now: number } | null;
  if (!res.ok || !data) throw new CloudError("The game's server had a problem. Try again in a minute.");
  const skew = Date.now() - data.now;
  return data.matches.map((m) => ({ ...m, deadline: m.deadline === null ? null : m.deadline + skew }));
}

/** The match config the play screen uses, from the server's view: people's seats are named after who sits there. */
export function configOf(view: RoomView): MatchConfig {
  return {
    mode: "online",
    map: isMapId(view.setup.map) ? view.setup.map : "uk",
    seats: view.seats.map((s) => ({ id: s.id, kind: s.kind, label: s.playerName ?? s.label, level: s.level, party: s.party, leaderId: s.leaderId })),
    ...(view.setup.customs?.length ? { customs: view.setup.customs } : {}),
    ...(view.setup.luck ? { luck: true } : {}),
    turnSeconds: view.setup.turnSeconds ?? null,
  };
}

export type LinkStatus = "connecting" | "open" | "reconnecting" | "closed";

/**
 * The live connection to one match. Reconnects by itself after a dropped connection (the server sends the whole view
 * again on every join); stops for good after leaving or when the server refuses the device a seat.
 */
export class MatchLink {
  view: RoomView | null = null;
  /** This device's clock minus the server's, from the last view. */
  skew = 0;
  status: LinkStatus = "connecting";
  error: string | null = null;
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private listeners = new Set<() => void>();
  private turnListeners = new Set<(t: TurnLog) => void>();
  /** Turns that arrived with nobody listening yet (between the lobby and the play screen). */
  private pending: TurnLog[] = [];

  constructor(readonly code: string) {
    void this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    try {
      await ensureAccount();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : "Couldn't sign in.");
      return;
    }
    const url = `${API_URL.replace(/^http/, "ws")}/api/matches/${this.code}/ws`;
    const ws = new WebSocket(url, ["mm.v1", `auth.${sessionToken()}`]);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ status: "open", error: null });
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "room") {
        this.skew = Date.now() - msg.now;
        this.set({ view: msg });
      }
      else if (msg.type === "turn") {
        const t: TurnLog = { index: msg.index, turn: msg.turn, plans: msg.plans, rng: msg.rng };
        if (this.turnListeners.size === 0) this.pending.push(t);
        this.turnListeners.forEach((l) => l(t));
      } else if (msg.type === "error") this.set({ error: msg.message });
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      // 4404: no such match; 4409: can't join (full or started). Both are final.
      if (this.stopped || e.code === 4404 || e.code === 4409) {
        this.stopped = true;
        this.set({ status: "closed" });
        return;
      }
      this.set({ status: "reconnecting" });
      const wait = Math.min(10_000, 1000 * 2 ** this.retry++);
      setTimeout(() => void this.connect(), wait);
    };
  }

  private fail(message: string) {
    this.stopped = true;
    this.set({ status: "closed", error: message });
  }

  private set(patch: Partial<Pick<MatchLink, "view" | "status" | "error">>) {
    Object.assign(this, patch);
    this.listeners.forEach((l) => l());
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Calls back for each resolved turn, first with any that arrived before anyone listened. */
  onTurn(l: (t: TurnLog) => void): () => void {
    this.turnListeners.add(l);
    this.pending.splice(0).forEach(l);
    return () => this.turnListeners.delete(l);
  }

  private send(msg: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.set({ error: "Not connected right now. Reconnecting…" });
      return false;
    }
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** When this turn's plans are due, on this device's clock. */
  deadline(): number | null {
    return this.view?.deadline ? this.view.deadline + this.skew : null;
  }

  start = () => this.send({ type: "start" });
  /** Changes your own party in the lobby (first come, first served; the server refuses what's taken). */
  pick = (change: { name?: string; color?: string; emblem?: string; leaderId?: string }) => this.send({ type: "pick", change });
  setReady = (ready: boolean) => this.send({ type: "ready", ready });
  submit = (turn: number, plan: Plan) => this.send({ type: "plan", turn, plan });
  clearError = () => this.set({ error: null });

  /** Leaves the lobby (freeing the seat) or simply disconnects from a match in play. */
  leave() {
    if (this.view?.status === "lobby") this.send({ type: "leave" });
    this.close();
  }

  close() {
    this.stopped = true;
    this.ws?.close(1000, "bye");
    this.set({ status: "closed" });
  }
}
