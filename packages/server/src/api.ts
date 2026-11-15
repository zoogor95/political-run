/**
 * The Majority Map API (M4.1: accounts). Anonymous device accounts first: the game makes a random device key, keeps it on
 * the device and shows it as a recovery code; the server stores only its hash. Sign-in through Discord, Steam, Google Play
 * Games and Game Center will link more identities to the same account. No emails, phone numbers, passwords or locations
 * are stored (design document, Database tab).
 */
import { base64url, fromBase64url, hashPassword, PASSWORD_ITERATIONS, randomToken, sameText, sha256, uuidv7 } from "./crypto.js";
import { checkSetup, PACKS, RoomError, type MatchSetup } from "./room.js";
import { checkSubscription, vapidKeys } from "./push.js";
import { seasonOf } from "./ratings.js";
import { MAX_ENTRANTS, MIN_ENTRANTS } from "./tournament.js";

export interface Env {
  DB: D1Database;
  /** Comma-separated web origins allowed to call the API (the game's sites). Localhost is always allowed. */
  ALLOWED_ORIGINS?: string;
  /** One Durable Object per private match, named by its invite code (match.ts). */
  MATCHES?: DurableObjectNamespace;
  /** Matchmaking for quick matches: one Durable Object holding everyone searching (matchmaker.ts). */
  MATCHMAKER?: DurableObjectNamespace;
  /** Push notifications: the game's VAPID public key (a var) and private key (a secret). Without them, no pushes. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  /** The game's web address: links in notifications open it, and push services see it as the sender. */
  SITE_URL?: string;
}

const DAY = 24 * 60 * 60 * 1000;
/** Sessions last 180 days and are extended whenever they're used with less than 90 left. */
const SESSION_DAYS = 180;
const LIMITS = { name: 28, region: 64, json: 16_000, achievements: 100 };

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  // "*" lets any site call the API. Safe enough because sign-in is a bearer token the page holds, never a cookie a
  // browser would attach on its own; list the game's own hosts instead once they're fixed.
  if (!local && !allowed.includes("*") && !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "bad_json", "The request body must be JSON");
  }
}

/** A JSON value kept as text, checked for size. */
function jsonText(value: unknown, field: string): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "bad_field", `${field} must be an object`);
  const text = JSON.stringify(value);
  if (text.length > LIMITS.json) throw new ApiError(413, "too_large", `${field} is too large`);
  return text;
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") throw new ApiError(400, "bad_field", "displayName must be text");
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > LIMITS.name) throw new ApiError(400, "bad_field", `displayName must be 1 to ${LIMITS.name} characters`);
  return n;
}

/** A login name: 3 to 20 letters, digits or underscores. Names are compared ignoring case, so "Ali" and "ali" are the same name. */
function cleanUsername(name: unknown): string {
  if (typeof name !== "string" || !/^[A-Za-z0-9_]{3,20}$/.test(name.trim())) throw new ApiError(400, "bad_username", "A username is 3 to 20 letters, numbers or underscores");
  return name.trim();
}

function cleanPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new ApiError(400, "bad_password", "A password is 8 to 128 characters");
  return password;
}

const LOGIN_TRIES = 5;
const LOCK_MINUTES = 15;

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new ApiError(400, "bad_field", `${field} must be text up to ${max} characters`);
  return value.trim();
}

interface AccountRow {
  id: string;
  display_name: string;
  avatar: string;
  home_country: string | null;
  home_region: string | null;
  locale: string;
  created_at: number;
}

function accountView(a: AccountRow) {
  return {
    id: a.id,
    displayName: a.display_name,
    avatar: JSON.parse(a.avatar) as unknown,
    homeCountry: a.home_country,
    homeRegion: a.home_region,
    locale: a.locale,
    createdAt: a.created_at,
  };
}

async function newSession(env: Env, accountId: string, deviceLabel: string | null, now: number): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, account_id, token_hash, device_label, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuidv7(now), accountId, await sha256(token), deviceLabel, now + SESSION_DAYS * DAY)
    .run();
  return token;
}

/** The signed-in account for a request, or a 401. Keeps the session alive and records when the player was last seen. */
async function authed(req: Request, env: Env, now: number): Promise<{ accountId: string; sessionId: string }> {
  // Browsers can't set headers on a WebSocket, so a match socket carries the token as a subprotocol: "mm.v1, auth.<token>".
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "") ?? /(?:^|,)\s*auth\.([A-Za-z0-9_-]+)/.exec(req.headers.get("sec-websocket-protocol") ?? "");
  if (!m) throw new ApiError(401, "signed_out", "Sign in first");
  const row = await env.DB.prepare(
    "SELECT s.id, s.account_id, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND a.status = 'active'",
  )
    .bind(await sha256(m[1]!))
    .first<{ id: string; account_id: string; expires_at: number }>();
  if (!row || row.expires_at <= now) throw new ApiError(401, "signed_out", "Your session has ended; sign in again");
  const writes = [env.DB.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").bind(now, row.account_id)];
  if (row.expires_at - now < (SESSION_DAYS / 2) * DAY) writes.push(env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(now + SESSION_DAYS * DAY, row.id));
  await env.DB.batch(writes);
  return { accountId: row.account_id, sessionId: row.id };
}

async function profile(env: Env, accountId: string) {
  const [account, settings, party, stats, achievements] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId),
    env.DB.prepare("SELECT settings FROM account_settings WHERE account_id = ?").bind(accountId),
    env.DB.prepare("SELECT name, color, emblem FROM party_profiles WHERE account_id = ?").bind(accountId),
    env.DB.prepare("SELECT stats FROM account_stats WHERE account_id = ?").bind(accountId),
    env.DB.prepare("SELECT achievement_code, unlocked_at FROM account_achievements WHERE account_id = ? ORDER BY unlocked_at").bind(accountId),
  ]);
  const one = <T,>(r: D1Result | undefined) => (r?.results?.[0] as T | undefined) ?? null;
  const s = one<{ settings: string }>(settings);
  const st = one<{ stats: string }>(stats);
  return {
    account: { ...accountView(one<AccountRow>(account)!), username: ((await env.DB.prepare("SELECT username FROM credentials WHERE account_id = ?").bind(accountId).first<string>("username")) ?? null) as string | null },
    settings: s ? (JSON.parse(s.settings) as unknown) : null,
    party: one<{ name: string; color: string; emblem: string }>(party),
    stats: st ? (JSON.parse(st.stats) as unknown) : null,
    achievements: ((achievements?.results ?? []) as { achievement_code: string; unlocked_at: number }[]).map((a) => ({ code: a.achievement_code, unlockedAt: a.unlocked_at })),
  };
}

/** Six characters from Crockford's base 32 (no I, L, O or U): easy to read out to a friend. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function inviteCode(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_ALPHABET[x & 31]).join("");
}

/** Routes one request. `now` is passed in so tests can control time. */
export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const res = await route(req, env, now);
    if (res.status === 101) return res; // a match socket: CORS doesn't apply
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  } catch (e) {
    if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message } }, e.status, cors);
    console.error(e);
    return json({ error: { code: "server_error", message: "Something went wrong" } }, 500, cors);
  }
}

async function route(req: Request, env: Env, now: number): Promise<Response> {
  const { pathname } = new URL(req.url);
  const at = (method: string, path: string) => req.method === method && pathname === path;

  if (at("GET", "/api/health")) return json({ ok: true });

  // Push notifications: the key a browser subscribes with, and its subscription stored (or removed) for this account.
  if (at("GET", "/api/push/key")) {
    const keys = vapidKeys(env);
    if (!keys) throw new ApiError(404, "no_push", "Push notifications aren't set up here");
    return json({ publicKey: keys.publicKey });
  }
  if (at("POST", "/api/push")) {
    const { accountId } = await authed(req, env, now);
    const sub = checkSubscription(await body<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(req));
    if (!sub) throw new ApiError(400, "bad_subscription", "That isn't a push subscription");
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, account_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth",
    )
      .bind(sub.endpoint, accountId, sub.p256dh, sub.auth, now)
      .run();
    return new Response(null, { status: 204 });
  }
  if (at("DELETE", "/api/push")) {
    const { accountId } = await authed(req, env, now);
    const b = await body<{ endpoint?: unknown }>(req);
    if (typeof b.endpoint !== "string") throw new ApiError(400, "bad_field", "endpoint must be text");
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND account_id = ?").bind(b.endpoint, accountId).run();
    return new Response(null, { status: 204 });
  }

  // Private matches: the host opens a lobby from a setup and gets an invite code; friends join it over a WebSocket.
  if (at("POST", "/api/matches")) {
    const { accountId } = await authed(req, env, now);
    if (!env.MATCHES) throw new ApiError(503, "no_matches", "Online matches aren't available here");
    const b = await body<{ setup?: MatchSetup }>(req);
    try {
      checkSetup(b.setup!);
    } catch (e) {
      throw new ApiError(400, "bad_setup", e instanceof RoomError ? e.message : "That setup can't start");
    }
    const setup = b.setup!;
    const name = (await env.DB.prepare("SELECT display_name FROM accounts WHERE id = ?").bind(accountId).first<string>("display_name")) ?? "Player";
    const seed = Math.floor(Math.random() * 1_000_000);
    const matchId = uuidv7(now);
    let code = "";
    for (let tries = 0; tries < 5 && !code; tries++) {
      const candidate = inviteCode();
      try {
        await env.DB.prepare(
          "INSERT INTO matches (id, mode, game_type, map_pack_id, content_version, engine_version, seed, status, invite_code, created_by, created_at) VALUES (?, 'private', ?, ?, ?, ?, ?, 'lobby', ?, ?, ?)",
        )
          .bind(matchId, PACKS[setup.map]!.gameType, setup.map, "1", "1", seed, candidate, accountId, now)
          .run();
        code = candidate;
      } catch (e) {
        if (!String(e).includes("UNIQUE")) throw e;
      }
    }
    if (!code) throw new ApiError(503, "busy", "Couldn't make an invite code; try again");
    const stub = env.MATCHES.get(env.MATCHES.idFromName(code));
    await stub.fetch("https://room/create", { method: "POST", body: JSON.stringify({ code, matchId, setup, host: { accountId, name }, seed }) });
    return json({ code }, 201);
  }

  // The player's ongoing matches: lobbies they opened, matches they sit in (with whether it's their move), and
  // matches that finished in the last three days.
  if (at("GET", "/api/matches/mine")) {
    const { accountId } = await authed(req, env, now);
    const rows = await env.DB.prepare(
      `SELECT m.invite_code AS code, m.status, m.map_pack_id AS map, m.current_turn AS turn, m.turn_deadline AS deadline, m.created_at AS createdAt,
              m.finished_at AS finishedAt, s.waiting AS waiting, s.party_name AS party,
              (SELECT COUNT(*) FROM match_seats x WHERE x.match_id = m.id AND x.account_id IS NOT NULL) AS people
       FROM matches m LEFT JOIN match_seats s ON s.match_id = m.id AND s.account_id = ?1
       WHERE m.mode = 'private' AND (s.account_id IS NOT NULL OR (m.created_by = ?1 AND m.status = 'lobby'))
         AND (m.status IN ('lobby', 'active') OR m.finished_at > ?2)
       ORDER BY IFNULL(s.waiting, 0) DESC, m.status = 'finished', m.created_at DESC LIMIT 20`,
    )
      .bind(accountId, now - 3 * DAY)
      .all<{ code: string; status: string; map: string; turn: number; deadline: number | null; createdAt: number; finishedAt: number | null; waiting: number | null; party: string | null; people: number }>();
    return json({ matches: rows.results.map((r) => ({ ...r, yourMove: r.waiting === 1 })), now });
  }

  const ws = /^\/api\/matches\/([0-9A-Za-z]{6})\/ws$/.exec(pathname);
  if (ws && req.method === "GET") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new ApiError(426, "upgrade", "This is a WebSocket");
    const { accountId } = await authed(req, env, now);
    if (!env.MATCHES) throw new ApiError(503, "no_matches", "Online matches aren't available here");
    const code = ws[1]!.toUpperCase();
    const name = (await env.DB.prepare("SELECT display_name FROM accounts WHERE id = ?").bind(accountId).first<string>("display_name")) ?? "Player";
    const headers = new Headers(req.headers);
    headers.set("x-account-id", accountId);
    headers.set("x-account-name", name);
    // ?watch=1: a spectator, watching without taking a seat.
    const watch = new URL(req.url).searchParams.get("watch") === "1" ? "?watch=1" : "";
    return env.MATCHES.get(env.MATCHES.idFromName(code)).fetch(new Request(`https://room/ws${watch}`, { headers }));
  }

  // Quick match: a WebSocket to the matchmaker, searching on one map, casual or ranked (?map=uk&ranked=1).
  if (at("GET", "/api/quick/ws")) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new ApiError(426, "upgrade", "This is a WebSocket");
    const { accountId } = await authed(req, env, now);
    if (!env.MATCHMAKER || !env.MATCHES) throw new ApiError(503, "no_matches", "Online matches aren't available here");
    const q = new URL(req.url).searchParams;
    const map = q.get("map") ?? "";
    if (!PACKS[map]) throw new ApiError(400, "bad_map", "Unknown map");
    const name = (await env.DB.prepare("SELECT display_name FROM accounts WHERE id = ?").bind(accountId).first<string>("display_name")) ?? "Player";
    const headers = new Headers(req.headers);
    headers.set("x-account-id", accountId);
    headers.set("x-account-name", name);
    return env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global")).fetch(new Request(`https://matchmaker/ws?map=${map}&ranked=${q.get("ranked") === "1" ? 1 : 0}`, { headers }));
  }

  // Tournaments: the cups (one per map, twice a year), joining and leaving while sign-up is open, and the bracket.
  if (at("GET", "/api/tournaments")) {
    const me = await authed(req, env, now).then((a) => a.accountId).catch(() => null);
    const rows = await env.DB.prepare(
      `SELECT t.id, t.name, t.map_pack_id AS map, t.status, t.cancelled, t.starts_at AS startsAt, t.ends_at AS endsBefore, json_extract(t.rules, '$.opensAt') AS opensAt,
              (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrants,
              (SELECT a.display_name FROM tournament_entries e JOIN accounts a ON a.id = e.account_id WHERE e.tournament_id = t.id AND e.rank = 1) AS champion,
              (SELECT MAX(round) FROM tournament_tables x WHERE x.tournament_id = t.id) AS round,
              (SELECT e.rank FROM tournament_entries e WHERE e.tournament_id = t.id AND e.account_id = ?1) AS yourRank,
              (SELECT 1 FROM tournament_entries e WHERE e.tournament_id = t.id AND e.account_id = ?1) AS entered,
              (SELECT x.match_code FROM tournament_tables x WHERE x.tournament_id = t.id AND x.players LIKE '%' || ?1 || '%' AND x.winner_account_id IS NULL ORDER BY x.round DESC LIMIT 1) AS yourTable
         FROM tournaments t ORDER BY t.starts_at DESC, t.map_pack_id LIMIT 30`,
    ).bind(me ?? "").all();
    return json({ now, tournaments: rows.results.map((r) => ({ ...r, entered: r.entered === 1, cancelled: r.cancelled === 1 })), maxEntrants: MAX_ENTRANTS, minEntrants: MIN_ENTRANTS });
  }
  const cup = /^\/api\/tournaments\/([a-z0-9-]{3,40})(\/join)?$/.exec(pathname);
  if (cup && req.method === "POST" && cup[2]) {
    const { accountId } = await authed(req, env, now);
    const t = await env.DB.prepare("SELECT status, starts_at FROM tournaments WHERE id = ?").bind(cup[1]).first<{ status: string; starts_at: number }>();
    if (!t) throw new ApiError(404, "no_cup", "No such tournament");
    if (t.status !== "open" || now >= t.starts_at) throw new ApiError(409, "closed", "Sign-up for this cup isn't open");
    const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?").bind(cup[1]).first<{ n: number }>())!.n;
    if (count >= MAX_ENTRANTS) throw new ApiError(409, "full", "This cup is full");
    await env.DB.prepare("INSERT OR IGNORE INTO tournament_entries (tournament_id, account_id, joined_at) VALUES (?, ?, ?)").bind(cup[1], accountId, now).run();
    return new Response(null, { status: 204 });
  }
  if (cup && req.method === "DELETE" && cup[2]) {
    const { accountId } = await authed(req, env, now);
    const t = await env.DB.prepare("SELECT status, starts_at FROM tournaments WHERE id = ?").bind(cup[1]).first<{ status: string; starts_at: number }>();
    if (!t || t.status !== "open" || now >= t.starts_at) throw new ApiError(409, "closed", "You can only withdraw while sign-up is open");
    await env.DB.prepare("DELETE FROM tournament_entries WHERE tournament_id = ? AND account_id = ?").bind(cup[1], accountId).run();
    return new Response(null, { status: 204 });
  }
  if (cup && req.method === "GET" && !cup[2]) {
    const tables = await env.DB.prepare(
      `SELECT x.round, x.table_no AS tableNo, x.match_code AS code, x.players, x.winner_account_id AS winner FROM tournament_tables x WHERE x.tournament_id = ? ORDER BY x.round, x.table_no`,
    ).bind(cup[1]).all<{ round: number; tableNo: number; code: string; players: string; winner: string | null }>();
    const names = new Map((await env.DB.prepare("SELECT a.id, a.display_name AS name FROM tournament_entries e JOIN accounts a ON a.id = e.account_id WHERE e.tournament_id = ?").bind(cup[1]).all<{ id: string; name: string }>()).results.map((r) => [r.id, r.name]));
    return json({ rounds: tables.results.map((r) => ({ round: r.round, tableNo: r.tableNo, code: r.code, players: (JSON.parse(r.players) as string[]).map((id) => names.get(id) ?? "Player"), winner: r.winner ? (names.get(r.winner) ?? "Player") : null })) });
  }

  // Leaderboards: the top 50 players by rating on a map, or the top leaders by season score. ?season= defaults to now.
  if (at("GET", "/api/leaderboard")) {
    const q = new URL(req.url).searchParams;
    const map = q.get("map") ?? "";
    if (!PACKS[map]) throw new ApiError(400, "bad_map", "Unknown map");
    const season = /^\d{4}-Q[1-4]$/.test(q.get("season") ?? "") ? q.get("season")! : seasonOf(now).id;
    const me = await authed(req, env, now).then((a) => a.accountId).catch(() => null);
    if (q.get("board") === "candidates") {
      const rows = await env.DB.prepare(
        "SELECT candidate_ref AS candidate, SUM(games) AS games, SUM(wins) AS wins, SUM(score) AS score, COUNT(*) AS players FROM candidate_stats WHERE season_id = ? AND map_pack_id = ? GROUP BY candidate_ref ORDER BY score DESC, wins DESC LIMIT 50",
      ).bind(season, map).all();
      return json({ season, map, board: "candidates", rows: rows.results });
    }
    // ?region= keeps only the players whose home region on this map is that one.
    const region = q.get("region");
    if (region && !PACKS[map]!.regions.some((r) => r.id === region)) throw new ApiError(400, "bad_region", "That isn't a region on this map");
    const rows = await env.DB.prepare(
      `SELECT a.id AS id, a.display_name AS name, r.rating AS rating, r.games AS games, r.wins AS wins FROM ratings r JOIN accounts a ON a.id = r.account_id
         ${region ? "JOIN home_regions h ON h.account_id = r.account_id AND h.map_pack_id = r.map_pack_id AND h.region_id = ?3" : ""}
        WHERE r.season_id = ?1 AND r.map_pack_id = ?2 AND a.status = 'active' ORDER BY r.rating DESC, r.games DESC LIMIT 50`,
    ).bind(...(region ? [season, map, region] : [season, map])).all<{ id: string; name: string; rating: number; games: number; wins: number }>();
    return json({ season, map, board: "players", ...(region ? { region } : {}), rows: rows.results.map(({ id, ...r }, i) => ({ rank: i + 1, ...r, you: id === me })) });
  }

  // This season's ratings for the signed-in player, by map.
  if (at("GET", "/api/ratings/me")) {
    const { accountId } = await authed(req, env, now);
    const season = seasonOf(now);
    const rows = await env.DB.prepare("SELECT map_pack_id AS map, rating, games, wins FROM ratings WHERE account_id = ? AND season_id = ?").bind(accountId, season.id).all();
    // Cup titles: the cups this player won (rank 1) or reached the final of (rank 2), newest first. Cancelled cups have none.
    const titles = await env.DB.prepare(
      "SELECT t.id, t.name, t.map_pack_id AS map, e.rank FROM tournament_entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.account_id = ? AND e.rank IN (1, 2) AND t.cancelled = 0 ORDER BY t.starts_at DESC",
    ).bind(accountId).all();
    const home = await env.DB.prepare("SELECT map_pack_id AS map, region_id AS region FROM home_regions WHERE account_id = ?").bind(accountId).all<{ map: string; region: string }>();
    return json({ season, ratings: rows.results, titles: titles.results, home: Object.fromEntries(home.results.map((h) => [h.map, h.region])) });
  }

  // Sign in with a device key: a new account the first time, the same account every time after (on any device, which is
  // how a recovery code restores a profile after a reinstall).
  if (at("POST", "/api/accounts/device")) {
    const b = await body<{ key?: unknown; displayName?: unknown; deviceLabel?: unknown; create?: unknown }>(req);
    if (typeof b.key !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(b.key)) throw new ApiError(400, "bad_key", "The device key must be at least 32 random bytes, base64url");
    const keyHash = await sha256(`device:${b.key}`);
    const label = optionalText(b.deviceLabel, "deviceLabel", 64);
    const found = await env.DB.prepare(
      "SELECT a.id FROM identities i JOIN accounts a ON a.id = i.account_id WHERE i.provider = 'device' AND i.provider_user_id = ? AND a.status = 'active'",
    )
      .bind(keyHash)
      .first<{ id: string }>();
    let accountId = found?.id;
    // Restoring with a recovery code passes create: false, so a mistyped code is an error rather than a new account.
    if (!accountId && b.create === false) throw new ApiError(404, "no_account", "No profile has that recovery code");
    const created = !accountId;
    if (!accountId) {
      accountId = uuidv7(now);
      const name = b.displayName === undefined ? `Player ${1000 + Math.floor(Math.random() * 9000)}` : cleanName(b.displayName);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO accounts (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)").bind(accountId, name, now, now),
        env.DB.prepare("INSERT INTO identities (id, account_id, provider, provider_user_id, created_at) VALUES (?, ?, 'device', ?, ?)").bind(uuidv7(now), accountId, keyHash, now),
      ]);
    }
    const token = await newSession(env, accountId, label, now);
    return json({ token, created, ...(await profile(env, accountId)) }, created ? 201 : 200);
  }

  // Username and password accounts. Registering while signed in (a guest profile with progress) adds a username and password to
  // that profile; registering signed out makes a new one. Usernames are unique, ignoring case.
  if (at("GET", "/api/accounts/username")) {
    const name = new URL(req.url).searchParams.get("name") ?? "";
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name.trim())) return json({ valid: false, available: false });
    const taken = await env.DB.prepare("SELECT 1 FROM credentials WHERE username_key = ?").bind(name.trim().toLowerCase()).first();
    return json({ valid: true, available: !taken });
  }

  if (at("POST", "/api/accounts/register")) {
    const b = await body<{ username?: unknown; password?: unknown; deviceLabel?: unknown }>(req);
    const username = cleanUsername(b.username);
    const password = cleanPassword(b.password);
    const key = username.toLowerCase();
    const label = optionalText(b.deviceLabel, "deviceLabel", 64);
    const me = req.headers.get("authorization") ? await authed(req, env, now).catch(() => null) : null;
    if (me && (await env.DB.prepare("SELECT 1 FROM credentials WHERE account_id = ?").bind(me.accountId).first())) throw new ApiError(409, "already_registered", "This profile already has a username");
    if (await env.DB.prepare("SELECT 1 FROM credentials WHERE username_key = ?").bind(key).first()) throw new ApiError(409, "username_taken", "That username is taken. Pick another");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);
    const accountId = me?.accountId ?? uuidv7(now);
    const credentials = env.DB.prepare("INSERT INTO credentials (account_id, username, username_key, password_hash, salt, iterations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      accountId,
      username,
      key,
      hash,
      base64url(salt),
      PASSWORD_ITERATIONS,
      now,
    );
    try {
      if (me) await credentials.run();
      else await env.DB.batch([env.DB.prepare("INSERT INTO accounts (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)").bind(accountId, username, now, now), credentials]);
    } catch (e) {
      // Someone registered the same name between the check and the insert: the unique index caught it.
      if (await env.DB.prepare("SELECT 1 FROM credentials WHERE username_key = ?").bind(key).first()) throw new ApiError(409, "username_taken", "That username is taken. Pick another");
      throw e;
    }
    const token = me ? null : await newSession(env, accountId, label, now);
    return json({ ...(token ? { token } : {}), created: !me, ...(await profile(env, accountId)) }, me ? 200 : 201);
  }

  if (at("POST", "/api/accounts/login")) {
    const b = await body<{ username?: unknown; password?: unknown; deviceLabel?: unknown }>(req);
    const username = typeof b.username === "string" ? b.username.trim() : "";
    const password = typeof b.password === "string" ? b.password : "";
    const label = optionalText(b.deviceLabel, "deviceLabel", 64);
    const row = await env.DB.prepare(
      "SELECT c.account_id, c.password_hash, c.salt, c.iterations, c.failed_attempts, c.locked_until FROM credentials c JOIN accounts a ON a.id = c.account_id WHERE c.username_key = ? AND a.status = 'active'",
    )
      .bind(username.toLowerCase())
      .first<{ account_id: string; password_hash: string; salt: string; iterations: number; failed_attempts: number; locked_until: number }>();
    if (row && row.locked_until > now) throw new ApiError(429, "locked", `Too many wrong passwords. Try again in ${Math.ceil((row.locked_until - now) / 60_000)} minutes`);
    // Hash even for a name that doesn't exist, so the answer takes the same time either way.
    const attempt = await hashPassword(password, row ? fromBase64url(row.salt) : new Uint8Array(16), row?.iterations ?? PASSWORD_ITERATIONS);
    if (!row || !sameText(attempt, row.password_hash)) {
      if (row) {
        const fails = row.failed_attempts + 1;
        await env.DB.prepare("UPDATE credentials SET failed_attempts = ?, locked_until = ? WHERE account_id = ?")
          .bind(fails >= LOGIN_TRIES ? 0 : fails, fails >= LOGIN_TRIES ? now + LOCK_MINUTES * 60_000 : 0, row.account_id)
          .run();
      }
      throw new ApiError(401, "bad_login", "Wrong username or password");
    }
    if (row.failed_attempts > 0) await env.DB.prepare("UPDATE credentials SET failed_attempts = 0, locked_until = 0 WHERE account_id = ?").bind(row.account_id).run();
    const token = await newSession(env, row.account_id, label, now);
    return json({ token, created: false, ...(await profile(env, row.account_id)) });
  }

  if (at("GET", "/api/me")) {
    const { accountId } = await authed(req, env, now);
    return json(await profile(env, accountId));
  }

  if (at("PUT", "/api/me")) {
    const { accountId } = await authed(req, env, now);
    const b = await body<Record<string, unknown>>(req);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      vals.push(value);
    };
    if ("displayName" in b) set("display_name", cleanName(b.displayName));
    if ("avatar" in b) set("avatar", jsonText(b.avatar, "avatar"));
    if ("homeCountry" in b) set("home_country", optionalText(b.homeCountry, "homeCountry", 2)?.toUpperCase() ?? null);
    if ("homeRegion" in b) set("home_region", optionalText(b.homeRegion, "homeRegion", LIMITS.region));
    if ("locale" in b) set("locale", optionalText(b.locale, "locale", 16) ?? "en");
    if (sets.length > 0) await env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, accountId).run();
    return json(await profile(env, accountId));
  }

  if (at("PUT", "/api/me/settings") || at("PUT", "/api/me/stats")) {
    const { accountId } = await authed(req, env, now);
    const stats = pathname.endsWith("/stats");
    const b = await body<{ settings?: unknown; stats?: unknown }>(req);
    const text = jsonText(stats ? b.stats : b.settings, stats ? "stats" : "settings");
    const table = stats ? "account_stats" : "account_settings";
    const col = stats ? "stats" : "settings";
    await env.DB.prepare(`INSERT INTO ${table} (account_id, ${col}, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET ${col} = excluded.${col}, updated_at = excluded.updated_at`)
      .bind(accountId, text, now)
      .run();
    return json({ ok: true });
  }

  // A home region on a map (or none, to clear it): where the player is from, for the regional leaderboards.
  if (at("PUT", "/api/me/home")) {
    const { accountId } = await authed(req, env, now);
    const b = await body<{ map?: unknown; region?: unknown }>(req);
    const pack = typeof b.map === "string" ? PACKS[b.map] : undefined;
    if (!pack) throw new ApiError(400, "bad_map", "Unknown map");
    if (b.region === null || b.region === undefined) {
      await env.DB.prepare("DELETE FROM home_regions WHERE account_id = ? AND map_pack_id = ?").bind(accountId, b.map).run();
      return json({ ok: true });
    }
    if (typeof b.region !== "string" || !pack.regions.some((r) => r.id === b.region)) throw new ApiError(400, "bad_region", "That isn't a region on this map");
    await env.DB.prepare(
      "INSERT INTO home_regions (account_id, map_pack_id, region_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, map_pack_id) DO UPDATE SET region_id = excluded.region_id, updated_at = excluded.updated_at",
    )
      .bind(accountId, b.map, b.region, now)
      .run();
    return json({ ok: true });
  }

  if (at("PUT", "/api/me/party")) {
    const { accountId } = await authed(req, env, now);
    const b = await body<{ name?: unknown; color?: unknown; emblem?: unknown }>(req);
    const name = cleanName(b.name);
    if (typeof b.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(b.color)) throw new ApiError(400, "bad_field", "color must be like #6a3fc8");
    if (typeof b.emblem !== "string" || !/^[a-z0-9-]{1,32}$/.test(b.emblem)) throw new ApiError(400, "bad_field", "emblem must be an emblem id");
    await env.DB.prepare(
      "INSERT INTO party_profiles (account_id, name, color, emblem, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, color = excluded.color, emblem = excluded.emblem, updated_at = excluded.updated_at",
    )
      .bind(accountId, name, b.color.toLowerCase(), b.emblem, now)
      .run();
    return json({ ok: true });
  }

  // Achievements only ever add up: an unlock is kept with its earliest time.
  if (at("POST", "/api/me/achievements")) {
    const { accountId } = await authed(req, env, now);
    const b = await body<{ achievements?: unknown }>(req);
    const list = b.achievements;
    if (!Array.isArray(list) || list.length > LIMITS.achievements) throw new ApiError(400, "bad_field", `achievements must be a list of up to ${LIMITS.achievements}`);
    const rows = list.map((a: { code?: unknown; unlockedAt?: unknown }) => {
      if (typeof a?.code !== "string" || !/^[a-z0-9-]{1,40}$/.test(a.code)) throw new ApiError(400, "bad_field", "Each achievement needs a code");
      const t = typeof a.unlockedAt === "number" && Number.isInteger(a.unlockedAt) && a.unlockedAt > 0 && a.unlockedAt <= now ? a.unlockedAt : now;
      return env.DB.prepare(
        "INSERT INTO account_achievements (account_id, achievement_code, unlocked_at) VALUES (?, ?, ?) ON CONFLICT(account_id, achievement_code) DO UPDATE SET unlocked_at = MIN(unlocked_at, excluded.unlocked_at)",
      ).bind(accountId, a.code, t);
    });
    if (rows.length > 0) await env.DB.batch(rows);
    return json({ ok: true, achievements: (await profile(env, accountId)).achievements });
  }

  if (at("POST", "/api/sessions/end")) {
    const { sessionId } = await authed(req, env, now);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now, sessionId).run();
    return json({ ok: true });
  }

  // Deleting an account (design document): profile, identities, sessions, push tokens, settings, saves, stats and custom
  // candidates go; purchase records stay for tax and refunds with the account anonymized; match seats show a deleted player.
  if (at("DELETE", "/api/me")) {
    const { accountId } = await authed(req, env, now);
    const del = (table: string, col = "account_id") => env.DB.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).bind(accountId);
    await env.DB.batch([
      del("identities"),
      del("sessions"),
      del("push_tokens"),
      del("account_settings"),
      del("party_profiles"),
      del("account_stats"),
      del("account_achievements"),
      del("cloud_saves"),
      del("credentials"),
      del("home_regions"),
      del("custom_candidates", "owner_account_id"),
      env.DB.prepare("UPDATE accounts SET display_name = 'Deleted player', avatar = '{}', home_country = NULL, home_region = NULL, status = 'deleted', deleted_at = ? WHERE id = ?").bind(now, accountId),
    ]);
    return json({ ok: true });
  }

  throw new ApiError(404, "not_found", "No such endpoint");
}
