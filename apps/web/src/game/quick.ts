/**
 * Quick match on this device: a connection to the game's matchmaker while searching. It reports how many people are
 * looking on the same map and mode, and the match's code once one is found. Only real people are matched.
 */
import { API_URL, ensureAccount, sessionToken } from "./cloud";

export type SearchState = { status: "connecting" } | { status: "searching"; waiting: number } | { status: "matched"; code: string } | { status: "error"; message: string };

export class QuickSearch {
  state: SearchState = { status: "connecting" };
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private listeners = new Set<(s: SearchState) => void>();

  constructor(
    readonly map: string,
    readonly ranked: boolean,
  ) {
    void this.connect();
  }

  onChange(l: (s: SearchState) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Stops searching. */
  cancel() {
    this.stopped = true;
    try {
      this.ws?.send("cancel");
      this.ws?.close(1000, "cancelled");
    } catch {
      // Already closed.
    }
  }

  private set(s: SearchState) {
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  private async connect() {
    if (this.stopped) return;
    try {
      await ensureAccount();
    } catch (e) {
      this.set({ status: "error", message: e instanceof Error ? e.message : "Couldn't sign in." });
      return;
    }
    const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/api/quick/ws?map=${this.map}&ranked=${this.ranked ? 1 : 0}`, ["mm.v1", `auth.${sessionToken()}`]);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ status: "searching", waiting: 1 });
    };
    ws.onmessage = (e) => {
      let msg: { type: string; waiting?: number; code?: string; message?: string };
      try {
        msg = JSON.parse(String(e.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "queue") this.set({ status: "searching", waiting: msg.waiting ?? 1 });
      else if (msg.type === "matched" && msg.code) {
        this.stopped = true;
        this.set({ status: "matched", code: msg.code });
      } else if (msg.type === "error") this.set({ status: "error", message: msg.message ?? "Something went wrong." });
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      // 4000: this person started searching somewhere else (another tab), which took over.
      if (e.code === 4000 || e.code === 4400) {
        this.stopped = true;
        this.set({ status: "error", message: e.code === 4000 ? "You're searching in another tab." : "That map isn't available." });
        return;
      }
      this.set({ status: "connecting" });
      setTimeout(() => void this.connect(), Math.min(10_000, 1000 * 2 ** this.retry++));
    };
  }
}

/** This season's ratings for the signed-in player, by map (an empty list until they play ranked). */
export async function myRatings(): Promise<{ season: { name: string }; ratings: { map: string; rating: number; games: number; wins: number }[] }> {
  await ensureAccount();
  const res = await fetch(`${API_URL}/api/ratings/me`, { headers: { authorization: `Bearer ${sessionToken()}` } });
  if (!res.ok) throw new Error(`ratings ${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof myRatings>>;
}
