/**
 * The Durable Object behind each private match: one instance per invite code, holding the room (room.ts) in storage and
 * every device's WebSocket. Sockets use the hibernation API, so an idle match costs nothing while friends think.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./api.js";
import { join, leave, newRoom, packFor, RoomError, start, submit, view, type MatchSetup, type RoomData, type ServerMessage } from "./room.js";

/** A plan is small; anything bigger than this isn't one. */
const MAX_MESSAGE = 32_000;

interface Attachment {
  accountId: string;
}

export class MatchRoom extends DurableObject<Env> {
  private room: RoomData | null | undefined;

  private async load(): Promise<RoomData | null> {
    if (this.room === undefined) this.room = (await this.ctx.storage.get<RoomData>("room")) ?? null;
    return this.room;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("room", this.room);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // A socket that just closed; it gets everything again when it reconnects.
    }
  }

  /** Each device's own view of the room. */
  private broadcastViews(room: RoomData) {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, view(room, (ws.deserializeAttachment() as Attachment).accountId));
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/create") {
      const b = (await req.json()) as { code: string; matchId: string; setup: MatchSetup; host: { accountId: string; name: string }; seed: number };
      this.room = newRoom(b.code, b.matchId, b.setup, b.host, b.seed, Date.now());
      await this.save();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/ws") {
      const room = await this.load();
      const accountId = req.headers.get("x-account-id")!;
      const name = req.headers.get("x-account-name") ?? "Player";
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [accountId]);
      server.serializeAttachment({ accountId } satisfies Attachment);
      if (!room) {
        this.send(server, { type: "error", message: "No match has that invite code." });
        server.close(4404, "no match");
      } else {
        try {
          join(room, accountId, name);
          await this.save();
          this.broadcastViews(room);
        } catch (e) {
          this.send(server, { type: "error", message: e instanceof RoomError ? e.message : "Couldn't join the match." });
          server.close(4409, "can't join");
        }
      }
      return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "mm.v1" } });
    }
    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { accountId } = ws.deserializeAttachment() as Attachment;
    const room = await this.load();
    if (!room) return;
    if (typeof message !== "string" || message.length > MAX_MESSAGE) return this.send(ws, { type: "error", message: "That message is too large." });
    let msg: { type?: string; turn?: number; plan?: unknown };
    try {
      msg = JSON.parse(message) as typeof msg;
    } catch {
      return this.send(ws, { type: "error", message: "That message wasn't understood." });
    }
    try {
      if (msg.type === "start") {
        start(room, accountId);
        await this.save();
        await this.recordStart(room);
        this.broadcastViews(room);
      } else if (msg.type === "plan") {
        const out = submit(room, accountId, Number(msg.turn), msg.plan as never);
        await this.save();
        for (const t of out.turns) for (const s of this.ctx.getWebSockets()) this.send(s, { type: "turn", ...t });
        this.broadcastViews(room);
        if (out.turns.length) await this.recordTurn(room, out.finished);
      } else if (msg.type === "leave") {
        leave(room, accountId);
        await this.save();
        this.broadcastViews(room);
        ws.close(1000, "left");
      } else if (msg.type === "sync") {
        this.send(ws, view(room, accountId));
      }
    } catch (e) {
      if (!(e instanceof RoomError)) console.error(e);
      this.send(ws, { type: "error", message: e instanceof RoomError ? e.message : "Something went wrong on the server." });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      // Already closed.
    }
  }

  /** The match's database row: who sat where, once it starts. Failures are logged; the match itself carries on. */
  private async recordStart(room: RoomData) {
    try {
      const pack = packFor(room.setup);
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE matches SET status = 'active', current_turn = 1 WHERE id = ?").bind(room.matchId),
        ...room.seats.map((s, i) =>
          this.env.DB.prepare(
            "INSERT INTO match_seats (match_id, seat, account_id, ai_level, candidate_kind, candidate_ref, party_name, party_color, party_emblem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(room.matchId, i, s.accountId ?? null, s.kind === "ai" ? s.level : null, pack.candidates.find((c) => c.id === s.leaderId && "custom" in c) ? "custom" : "roster", s.leaderId, s.party.name, s.party.color.toLowerCase(), s.party.emblem),
        ),
      ]);
    } catch (e) {
      console.error("recordStart", e);
    }
  }

  private async recordTurn(room: RoomData, finished: boolean) {
    try {
      const writes = [this.env.DB.prepare("UPDATE matches SET current_turn = ? WHERE id = ?").bind(room.log.length + 1, room.matchId)];
      if (finished && room.result) {
        const r = room.result;
        const seatIndex = (id: string | undefined) => (id ? room.seats.findIndex((s) => s.id === id) : -1);
        const now = Date.now();
        writes.push(
          this.env.DB.prepare("UPDATE matches SET status = 'finished', final_turn = ?, finished_at = ? WHERE id = ?").bind(room.log.length, now, room.matchId),
          this.env.DB.prepare("INSERT OR REPLACE INTO match_results (match_id, winner_seat, government, second_round, regions, popular_vote) VALUES (?, ?, ?, ?, ?, ?)").bind(
            room.matchId,
            seatIndex(r.ranking[0]),
            JSON.stringify(r.government),
            room.state && room.state.round > 1 ? 1 : 0,
            JSON.stringify(r.regionSeats),
            JSON.stringify(r.popularVote),
          ),
          ...room.seats.map((s, i) =>
            this.env.DB.prepare("UPDATE match_seats SET final_seats = ?, final_popular_vote = ?, final_rank = ? WHERE match_id = ? AND seat = ?").bind(
              r.seats[s.id] ?? 0,
              Math.round(r.popularVote[s.id] ?? 0),
              r.ranking.indexOf(s.id) + 1,
              room.matchId,
              i,
            ),
          ),
        );
      }
      await this.env.DB.batch(writes);
    } catch (e) {
      console.error("recordTurn", e);
    }
  }
}
