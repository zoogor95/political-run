/**
 * Matchmaking for quick matches: one Durable Object holds everyone searching, a queue per map and mode (casual or
 * ranked). Only real people are matched, never computers. When two or more are waiting, others get a short while to
 * join (up to four), then the match starts and everyone in it is sent its code.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./api.js";
import { notifyAccounts } from "./push.js";
import { createQuickMatch } from "./quick.js";
import { PACKS } from "./room.js";

/** How long others get to join once two people are waiting, and the most a quick match seats. */
export const GATHER_MS = 15_000;
export const MAX_PLAYERS = 4;

interface Searcher {
  accountId: string;
  name: string;
  queue: string;
  since: number;
}

export type QuickMessage = { type: "queue"; waiting: number } | { type: "matched"; code: string } | { type: "error"; message: string };

export class Matchmaker extends DurableObject<Env> {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    const map = url.searchParams.get("map") ?? "";
    const ranked = url.searchParams.get("ranked") === "1";
    const accountId = req.headers.get("x-account-id")!;
    const name = req.headers.get("x-account-name") ?? "Player";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (!PACKS[map]) {
      this.ctx.acceptWebSocket(server, ["bad"]);
      this.send(server, { type: "error", message: "Unknown map" });
      server.close(4400, "unknown map");
      return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "mm.v1" } });
    }
    // One search per person: a second tab (or a change of map) replaces the first.
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Searcher | null)?.accountId === accountId) ws.close(4000, "replaced");
    }
    const queue = `${map}:${ranked ? "ranked" : "casual"}`;
    this.ctx.acceptWebSocket(server, [queue]);
    server.serializeAttachment({ accountId, name, queue, since: Date.now() } satisfies Searcher);
    await this.consider(queue);
    return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "mm.v1" } });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "cancel") ws.close(1000, "cancelled");
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      // Already closed.
    }
    const queue = (ws.deserializeAttachment() as Searcher | null)?.queue;
    if (queue) this.announce(queue, ws);
  }

  /** The time to gather others is up: start a match in every queue with two or more people. */
  override async alarm(): Promise<void> {
    const queues = new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Searcher | null)?.queue).filter((q): q is string => Boolean(q)));
    for (const q of queues) {
      const waiting = this.waiting(q);
      if (waiting.length >= 2) await this.form(q, waiting.slice(0, MAX_PLAYERS));
    }
    // People left over (a fifth, say) start gathering again.
    for (const q of queues) if (this.waiting(q).length >= 2) await this.ctx.storage.setAlarm(Date.now() + GATHER_MS);
  }

  /** Everyone searching in a queue, longest-waiting first. */
  private waiting(queue: string, leaving?: WebSocket): { ws: WebSocket; who: Searcher }[] {
    return this.ctx
      .getWebSockets(queue)
      .filter((ws) => ws !== leaving)
      .map((ws) => ({ ws, who: ws.deserializeAttachment() as Searcher }))
      .sort((a, b) => a.who.since - b.who.since);
  }

  private announce(queue: string, leaving?: WebSocket) {
    const waiting = this.waiting(queue, leaving);
    for (const { ws } of waiting) this.send(ws, { type: "queue", waiting: waiting.length });
  }

  /** Someone joined: tell the queue how many are looking, and start (or schedule) a match if there are enough. */
  private async consider(queue: string) {
    this.announce(queue);
    const waiting = this.waiting(queue);
    if (waiting.length >= MAX_PLAYERS) await this.form(queue, waiting.slice(0, MAX_PLAYERS));
    else if (waiting.length >= 2 && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + GATHER_MS);
  }

  private async form(queue: string, group: { ws: WebSocket; who: Searcher }[]) {
    const [map, mode] = queue.split(":") as [string, string];
    try {
      const code = await createQuickMatch(
        this.env,
        map,
        mode === "ranked",
        group.map((g) => ({ accountId: g.who.accountId, name: g.who.name })),
      );
      for (const { ws } of group) {
        this.send(ws, { type: "matched", code });
        ws.close(1000, "matched");
      }
      // In case the game is in a background tab: a push to say the match is on.
      const url = `${this.env.SITE_URL ?? ""}/?join=${code}`;
      this.ctx.waitUntil(notifyAccounts(this.env, group.map((g) => g.who.accountId), { title: "Majority Map", body: "Match found! Your move.", url, tag: `mm-${code}` }).catch(() => 0));
    } catch (e) {
      console.error("quick match", e);
      for (const { ws } of group) this.send(ws, { type: "error", message: "Couldn't start the match. Still searching…" });
    }
  }

  private send(ws: WebSocket, msg: QuickMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Gone already.
    }
  }
}
