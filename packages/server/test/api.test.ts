import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle, type Env } from "../src/api.js";

/** A fresh local D1 database (Miniflare) with every migration applied, as on Cloudflare. */
async function freshEnv(): Promise<{ env: Env; mf: Miniflare }> {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response(\"\") } }", d1Databases: ["DB"] });
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  }
  return { env: { DB: db, ALLOWED_ORIGINS: "https://majoritymap.example" }, mf };
}

const KEY = "k".repeat(43);
const T0 = 1_800_000_000_000;

let env: Env;
let mf: Miniflare;
beforeEach(async () => ({ env, mf } = await freshEnv()));
afterEach(async () => mf?.dispose());

async function call(method: string, path: string, opts: { token?: string; body?: unknown; now?: number; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.origin = opts.origin;
  const req = new Request(`https://api.example${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const res = await handle(req, env, opts.now ?? T0);
  // Responses are read loosely here; the API's own code checks their shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, data: (res.status === 204 ? null : await res.json()) as Record<string, any> };
}

const signIn = (key = KEY, extra: Record<string, unknown> = {}) => call("POST", "/api/accounts/device", { body: { key, ...extra } });

describe("device accounts", () => {
  it("creates an account the first time and signs the same account in after, as a recovery code does", async () => {
    const first = await signIn(KEY, { displayName: "Zoogor" });
    expect(first.status).toBe(201);
    expect(first.data.created).toBe(true);
    expect(first.data.account.displayName).toBe("Zoogor");
    expect(first.data.account.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // UUIDv7
    const again = await signIn(KEY);
    expect(again.status).toBe(200);
    expect(again.data.created).toBe(false);
    expect(again.data.account.id).toBe(first.data.account.id);
    expect(again.data.token).not.toBe(first.data.token); // a new session for the new device
    const other = await signIn("z".repeat(43));
    expect(other.data.account.id).not.toBe(first.data.account.id);
    expect(other.data.account.displayName).toMatch(/^Player \d{4}$/);
  });

  it("stores only hashes of the device key and the session token", async () => {
    const { data } = await signIn();
    const idRow = await env.DB.prepare("SELECT provider_user_id FROM identities").first<{ provider_user_id: string }>();
    const sRow = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(idRow!.provider_user_id).not.toContain(KEY);
    expect(idRow!.provider_user_id).toMatch(/^[0-9a-f]{64}$/);
    expect(sRow!.token_hash).not.toBe(data.token);
  });

  it("restores only an account that exists when asked not to create one", async () => {
    expect((await signIn(KEY, { create: false })).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n")).toBe(0);
    const first = await signIn();
    const back = await signIn(KEY, { create: false });
    expect(back.status).toBe(200);
    expect(back.data.account.id).toBe(first.data.account.id);
  });

  it("refuses short or malformed keys", async () => {
    expect((await signIn("short")).status).toBe(400);
    expect((await signIn("!".repeat(50))).status).toBe(400);
    expect((await call("POST", "/api/accounts/device", { body: { displayName: "x" } })).data.error.code).toBe("bad_key");
  });
});

describe("the profile", () => {
  it("needs a valid session", async () => {
    expect((await call("GET", "/api/me")).status).toBe(401);
    expect((await call("GET", "/api/me", { token: "nope" })).status).toBe(401);
  });

  it("keeps name, home region, settings, party, stats and achievements, and gives them back on another device", async () => {
    const { data } = await signIn();
    const token = data.token as string;
    expect((await call("PUT", "/api/me", { token, body: { displayName: "  The   Zoogor ", homeCountry: "pk", homeRegion: "Lahore" } })).data.account).toMatchObject({
      displayName: "The Zoogor",
      homeCountry: "PK",
      homeRegion: "Lahore",
    });
    await call("PUT", "/api/me/settings", { token, body: { settings: { music: 0.4, showTicker: false } } });
    await call("PUT", "/api/me/party", { token, body: { name: "Zoogor Party", color: "#6A3FC8", emblem: "owl" } });
    await call("PUT", "/api/me/stats", { token, body: { stats: { matches: 3, wins: 1 } } });
    await call("POST", "/api/me/achievements", { token, body: { achievements: [{ code: "first-win", unlockedAt: T0 - 5000 }, { code: "majority" }] } });
    // Achievements only add up, keeping the earliest unlock time.
    await call("POST", "/api/me/achievements", { token, body: { achievements: [{ code: "first-win", unlockedAt: T0 - 1000 }] } });

    const restored = await signIn(); // a reinstall: the recovery code signs the same account in
    expect(restored.data).toMatchObject({
      created: false,
      settings: { music: 0.4, showTicker: false },
      party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "owl" },
      stats: { matches: 3, wins: 1 },
      achievements: [
        { code: "first-win", unlockedAt: T0 - 5000 },
        { code: "majority", unlockedAt: T0 },
      ],
    });
  });

  it("checks what it stores", async () => {
    const { data } = await signIn();
    const token = data.token as string;
    expect((await call("PUT", "/api/me", { token, body: { displayName: "" } })).status).toBe(400);
    expect((await call("PUT", "/api/me", { token, body: { displayName: "x".repeat(29) } })).status).toBe(400);
    expect((await call("PUT", "/api/me/party", { token, body: { name: "A", color: "red", emblem: "owl" } })).status).toBe(400);
    expect((await call("PUT", "/api/me/settings", { token, body: { settings: [1, 2] } })).status).toBe(400);
    expect((await call("PUT", "/api/me/stats", { token, body: { stats: { blob: "x".repeat(20_000) } } })).status).toBe(413);
    expect((await call("POST", "/api/me/achievements", { token, body: { achievements: [{ code: "Bad Code" }] } })).status).toBe(400);
  });
});

describe("sessions and deletion", () => {
  it("ends a session on sign-out and when it expires, and extends one in use", async () => {
    const { data } = await signIn();
    const token = data.token as string;
    const day = 24 * 60 * 60 * 1000;
    // Used on day 100 (under 90 days left): extended to day 280.
    expect((await call("GET", "/api/me", { token, now: T0 + 100 * day })).status).toBe(200);
    expect((await call("GET", "/api/me", { token, now: T0 + 250 * day })).status).toBe(200);
    expect((await call("GET", "/api/me", { token, now: T0 + 500 * day })).status).toBe(401);
    const fresh = (await signIn()).data.token as string;
    expect((await call("POST", "/api/sessions/end", { token: fresh })).status).toBe(200);
    expect((await call("GET", "/api/me", { token: fresh })).status).toBe(401);
  });

  it("deletes an account: the profile goes, the device key no longer signs it in, and the row is anonymized", async () => {
    const { data } = await signIn(KEY, { displayName: "Zoogor" });
    const token = data.token as string;
    await call("PUT", "/api/me/settings", { token, body: { settings: { music: 1 } } });
    expect((await call("DELETE", "/api/me", { token })).status).toBe(200);
    expect((await call("GET", "/api/me", { token })).status).toBe(401);
    const row = await env.DB.prepare("SELECT display_name, status FROM accounts").first<{ display_name: string; status: string }>();
    expect(row).toEqual({ display_name: "Deleted player", status: "deleted" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM account_settings").first("n")).toBe(0);
    const again = await signIn();
    expect(again.data.created).toBe(true); // the old key is no longer linked to anything
  });
});

describe("the web", () => {
  it("answers the game's own sites and localhost, not others", async () => {
    const ok = await call("GET", "/api/health", { origin: "https://majoritymap.example" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://majoritymap.example");
    expect((await call("GET", "/api/health", { origin: "http://localhost:5173" })).headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await call("GET", "/api/health", { origin: "https://evil.example" })).headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("OPTIONS", "/api/me", { origin: "https://majoritymap.example" })).status).toBe(204);
    expect((await call("GET", "/api/nowhere")).status).toBe(404);
  });

  it("answers any site when the allowed origins are *", async () => {
    env = { ...env, ALLOWED_ORIGINS: "*" };
    expect((await call("GET", "/api/health", { origin: "https://anywhere.example" })).headers.get("access-control-allow-origin")).toBe("https://anywhere.example");
  });
});

describe("ongoing matches", () => {
  it("lists the player's lobbies and matches, their move first, and recent results, but not other people's", async () => {
    const me = await signIn(KEY, { displayName: "Me" });
    const other = await signIn("o".repeat(43), { displayName: "Other" });
    const myId = me.data.account.id as string;
    const otherId = other.data.account.id as string;
    const day = 24 * 60 * 60 * 1000;
    const match = (id: string, code: string, status: string, by: string, createdAt: number, finishedAt: number | null = null) =>
      env.DB.prepare("INSERT INTO matches (id, mode, game_type, map_pack_id, content_version, engine_version, seed, status, invite_code, created_by, created_at, finished_at) VALUES (?, 'private', 'parliamentary', 'uk', '1', '1', 1, ?, ?, ?, ?, ?)")
        .bind(id, status, code, by, createdAt, finishedAt)
        .run();
    const seat = (matchId: string, n: number, account: string | null, waiting: number) =>
      env.DB.prepare("INSERT INTO match_seats (match_id, seat, account_id, candidate_kind, candidate_ref, party_name, party_color, party_emblem, waiting) VALUES (?, ?, ?, 'roster', 'x', ?, ?, ?, ?)")
        .bind(matchId, n, account, `Party ${n}`, `#00000${n}`, `e${n}`, waiting)
        .run();
    await match("m1", "AAAAAA", "lobby", myId, T0 - 1000);
    await match("m2", "BBBBBB", "active", otherId, T0 - 2000);
    await seat("m2", 0, otherId, 0);
    await seat("m2", 1, myId, 1);
    await match("m3", "CCCCCC", "finished", myId, T0 - 10 * day, T0 - day);
    await seat("m3", 0, myId, 0);
    await match("m4", "DDDDDD", "finished", myId, T0 - 20 * day, T0 - 10 * day);
    await seat("m4", 0, myId, 0);
    await match("m5", "EEEEEE", "lobby", otherId, T0);

    const { data } = await call("GET", "/api/matches/mine", { token: me.data.token as string });
    expect(data.matches.map((m: { code: string }) => m.code)).toEqual(["BBBBBB", "AAAAAA", "CCCCCC"]);
    expect(data.matches[0]).toMatchObject({ yourMove: true, status: "active", party: "Party 1", people: 2 });
    expect(data.matches[1]).toMatchObject({ yourMove: false, status: "lobby" });
    expect((await call("GET", "/api/matches/mine")).status).toBe(401);
  });
});

describe("push notifications", () => {
  const sub = (n: number) => ({ endpoint: `https://push.example/send/${n}`, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });

  it("gives out the public key only where push is set up", async () => {
    expect((await call("GET", "/api/push/key")).status).toBe(404);
    env.VAPID_PUBLIC_KEY = "P".repeat(87);
    env.VAPID_PRIVATE_KEY = "d".repeat(43);
    expect((await call("GET", "/api/push/key")).data).toEqual({ publicKey: "P".repeat(87) });
  });

  it("stores a device's subscription for its account, once, and removes it on request", async () => {
    const { data } = await signIn();
    expect((await call("POST", "/api/push", { body: sub(1) })).status).toBe(401);
    expect((await call("POST", "/api/push", { token: data.token, body: { endpoint: "http://insecure.example", keys: sub(1).keys } })).status).toBe(400);
    expect((await call("POST", "/api/push", { token: data.token, body: sub(1) })).status).toBe(204);
    expect((await call("POST", "/api/push", { token: data.token, body: sub(1) })).status).toBe(204); // again: still one row
    const rows = await env.DB.prepare("SELECT account_id FROM push_subscriptions").all<{ account_id: string }>();
    expect(rows.results).toEqual([{ account_id: data.account.id }]);
    expect((await call("DELETE", "/api/push", { token: data.token, body: { endpoint: sub(1).endpoint } })).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>())!.n).toBe(0);
  });

  it("sends to every device of the accounts, and forgets subscriptions the push service says are gone", async () => {
    const { data } = await signIn();
    await call("POST", "/api/push", { token: data.token, body: sub(1) });
    await call("POST", "/api/push", { token: data.token, body: sub(2) });
    // Real keys, so the messages can be encrypted and signed.
    const { createECDH } = await import("node:crypto");
    const { b64url } = await import("../src/webpush.js");
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    await env.DB.prepare("UPDATE push_subscriptions SET p256dh = ?, auth = ?").bind(b64url(browser.getPublicKey()), b64url(new Uint8Array(16).fill(7))).run();
    const vapid = createECDH("prime256v1");
    vapid.generateKeys();
    env.VAPID_PUBLIC_KEY = b64url(vapid.getPublicKey());
    env.VAPID_PRIVATE_KEY = b64url(vapid.getPrivateKey());
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${(init.headers as Record<string, string>)["content-encoding"]}`);
      return new Response(null, { status: url.endsWith("/2") ? 410 : 201 });
    }) as typeof fetch;
    try {
      const { notifyAccounts } = await import("../src/push.js");
      const sent = await notifyAccounts(env, [data.account.id], { title: "Majority Map", body: "Turn 2 is in. Your move!", url: "https://game.example/?join=ABC123", tag: "mm-ABC123" });
      expect(sent).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen.sort()).toEqual(["https://push.example/send/1 aes128gcm", "https://push.example/send/2 aes128gcm"]);
    const left = await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all<{ endpoint: string }>();
    expect(left.results).toEqual([{ endpoint: "https://push.example/send/1" }]);
  });
});

describe("ranked results", () => {
  it("moves both players' ratings for the map and season, and scores their leaders", async () => {
    const { newQuickRoom, quickSetup } = await import("../src/room.js");
    const { recordRanked } = await import("../src/quick.js");
    const a = (await signIn("a".repeat(43))).data;
    const b = (await signIn("b".repeat(43))).data;
    const people = [
      { accountId: a.account.id, name: "Ali" },
      { accountId: b.account.id, name: "Sam" },
    ];
    const setup = quickSetup("uk", people, true, 3);
    const room = newQuickRoom("RANK01", "m-r", setup, people, 3, T0);
    const result = { ranking: ["p2", "p1"] } as unknown as import("@majority-map/core").ElectionResult;
    const changes = await recordRanked(env, room, result, Date.UTC(2026, 10, 14));
    expect(changes).toEqual({ p2: 16, p1: -16 });
    const rows = await env.DB.prepare("SELECT account_id, season_id, map_pack_id, rating, games, wins FROM ratings ORDER BY rating DESC").all();
    expect(rows.results).toEqual([
      { account_id: b.account.id, season_id: "2026-Q4", map_pack_id: "uk", rating: 1016, games: 1, wins: 1 },
      { account_id: a.account.id, season_id: "2026-Q4", map_pack_id: "uk", rating: 984, games: 1, wins: 0 },
    ]);
    // A second ranked match builds on those ratings.
    await recordRanked(env, room, { ranking: ["p1", "p2"] } as unknown as import("@majority-map/core").ElectionResult, Date.UTC(2026, 10, 15));
    const again = await env.DB.prepare("SELECT rating, games FROM ratings WHERE account_id = ?").bind(a.account.id).first();
    expect(again).toEqual({ rating: 1001, games: 2 });
    const leader = await env.DB.prepare("SELECT candidate_ref, games, wins, score FROM candidate_stats WHERE account_id = ?").bind(b.account.id).first();
    expect(leader).toMatchObject({ candidate_ref: setup.seats[1]!.leaderId, games: 2, wins: 1, score: 1 });
    const me = await call("GET", "/api/ratings/me", { token: a.token, now: Date.UTC(2026, 10, 16) });
    expect(me.data.ratings).toEqual([{ map: "uk", rating: 1001, games: 2, wins: 1 }]);
  });
});

describe("leaderboards", () => {
  it("ranks players by rating for a map and season, marks you, and ranks leaders by score", async () => {
    const a = (await signIn("a".repeat(43), { displayName: "Ali" })).data;
    const b = (await signIn("b".repeat(43), { displayName: "Sam" })).data;
    const now = Date.UTC(2026, 10, 14);
    await env.DB.prepare("INSERT INTO seasons (id, name, starts_at, ends_at) VALUES ('2026-Q4','Season 2026 Q4',0,1)").run();
    for (const [acc, r, w] of [[a.account.id, 1020, 3], [b.account.id, 1050, 5]] as const) {
      await env.DB.prepare("INSERT INTO ratings (account_id, season_id, map_pack_id, rating, games, wins, updated_at) VALUES (?, '2026-Q4', 'uk', ?, 6, ?, 0)").bind(acc, r, w).run();
      await env.DB.prepare("INSERT INTO candidate_stats (account_id, season_id, map_pack_id, candidate_ref, games, wins, score) VALUES (?, '2026-Q4', 'uk', 'keir-starmer', 6, ?, ?)").bind(acc, w, w * 2).run();
    }
    const board = await call("GET", "/api/leaderboard?map=uk", { token: a.token, now });
    expect(board.data.rows).toEqual([
      { rank: 1, name: "Sam", rating: 1050, games: 6, wins: 5, you: false },
      { rank: 2, name: "Ali", rating: 1020, games: 6, wins: 3, you: true },
    ]);
    expect((await call("GET", "/api/leaderboard?map=xx", { now })).status).toBe(400);
    expect((await call("GET", "/api/leaderboard?map=pk", { now })).data.rows).toEqual([]);
    const cands = await call("GET", "/api/leaderboard?map=uk&board=candidates", { now });
    expect(cands.data.rows).toEqual([{ candidate: "keir-starmer", games: 12, wins: 8, score: 16, players: 2 }]);
  });
});

describe("tournaments", () => {
  /** Stand-in match rooms: starting one succeeds, which is all the runner needs from it. */
  const fakeRooms = () => ({ idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response(null, { status: 204 }) }) }) as unknown as DurableObjectNamespace;

  /** Finishes every unfinished table match of the cup's current round, the first-listed person winning each. */
  async function finishRound(id: string) {
    const rows = await env.DB.prepare("SELECT match_id, players FROM tournament_tables WHERE tournament_id = ? AND winner_account_id IS NULL").bind(id).all<{ match_id: string; players: string }>();
    for (const r of rows.results) {
      const ids = JSON.parse(r.players) as string[];
      for (const [i, acc] of ids.entries()) {
        await env.DB.prepare("INSERT INTO match_seats (match_id, seat, account_id, candidate_kind, candidate_ref, party_name, final_rank) VALUES (?, ?, ?, 'roster', 'x', 'P', ?)").bind(r.match_id, i, acc, i + 1).run();
      }
      await env.DB.prepare("UPDATE matches SET status = 'finished' WHERE id = ?").bind(r.match_id).run();
    }
  }

  it("plays a cup from sign-up to champion: sign-up, round one tables, winners into the final, ranks", async () => {
    const { runTournaments } = await import("../src/tournaments-run.js");
    env.MATCHES = fakeRooms();
    const jan = Date.UTC(2027, 0, 3);
    await runTournaments(env, jan);
    const list = await call("GET", "/api/tournaments", { now: jan });
    expect(list.data.tournaments.map((t: { id: string; status: string }) => `${t.id}:${t.status}`).sort()).toEqual(["pk-2027-winter:open", "uk-2027-winter:open", "us-2027-winter:open"]);

    const people = [];
    for (let i = 0; i < 5; i++) people.push((await signIn(String(i).repeat(43), { displayName: `P${i}` })).data);
    for (const p of people) expect((await call("POST", "/api/tournaments/uk-2027-winter/join", { token: p.token, now: jan })).status).toBe(204);
    expect((await call("DELETE", "/api/tournaments/uk-2027-winter/join", { token: people[4]!.token, now: jan })).status).toBe(204);
    expect((await call("POST", "/api/tournaments/uk-2027-winter/join", { token: people[4]!.token, now: jan })).status).toBe(204);
    expect((await call("POST", "/api/tournaments/nope-1/join", { token: people[0]!.token, now: jan })).status).toBe(404);

    // Sign-up closes: five people make two tables.
    const start = Date.UTC(2027, 0, 16);
    await runTournaments(env, start);
    let tables = (await call("GET", "/api/tournaments/uk-2027-winter", { now: start })).data.rounds;
    expect(tables.map((t: { players: string[] }) => t.players.length).sort()).toEqual([2, 3]);
    expect((await call("POST", "/api/tournaments/uk-2027-winter/join", { token: people[0]!.token, now: start })).status).toBe(409);
    // The pk and us cups had nobody: cancelled.
    expect((await env.DB.prepare("SELECT cancelled FROM tournaments WHERE id = 'pk-2027-winter'").first<{ cancelled: number }>())!.cancelled).toBe(1);

    // Round one ends: the two winners go to the final.
    await finishRound("uk-2027-winter");
    await runTournaments(env, start + 86_400_000 * 20);
    tables = (await call("GET", "/api/tournaments/uk-2027-winter", { now: start })).data.rounds;
    expect(tables.filter((t: { round: number }) => t.round === 2)).toHaveLength(1);
    expect(tables.find((t: { round: number }) => t.round === 2).players).toHaveLength(2);

    // The final ends: a champion and ranks.
    await finishRound("uk-2027-winter");
    await runTournaments(env, start + 86_400_000 * 40);
    const done = (await call("GET", "/api/tournaments", { now: start })).data.tournaments.find((t: { id: string }) => t.id === "uk-2027-winter");
    expect(done).toMatchObject({ status: "finished", entrants: 5 });
    expect(done.champion).toMatch(/^P\d$/);
    const ranks = await env.DB.prepare("SELECT rank FROM tournament_entries WHERE tournament_id = 'uk-2027-winter' AND rank IS NOT NULL ORDER BY rank").all<{ rank: number }>();
    expect(ranks.results.map((r) => r.rank)).toEqual([1, 2]);
  });
});
