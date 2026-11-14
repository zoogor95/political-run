/**
 * The Majority Map API (M4.1: accounts). Anonymous device accounts first: the game makes a random device key, keeps it on
 * the device and shows it as a recovery code; the server stores only its hash. Sign-in through Discord, Steam, Google Play
 * Games and Game Center will link more identities to the same account. No emails, phone numbers, passwords or locations
 * are stored (design document, Database tab).
 */
import { randomToken, sha256, uuidv7 } from "./crypto.js";

export interface Env {
  DB: D1Database;
  /** Comma-separated web origins allowed to call the API (the game's sites). Localhost is always allowed. */
  ALLOWED_ORIGINS?: string;
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
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") ?? "");
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
    account: accountView(one<AccountRow>(account)!),
    settings: s ? (JSON.parse(s.settings) as unknown) : null,
    party: one<{ name: string; color: string; emblem: string }>(party),
    stats: st ? (JSON.parse(st.stats) as unknown) : null,
    achievements: ((achievements?.results ?? []) as { achievement_code: string; unlocked_at: number }[]).map((a) => ({ code: a.achievement_code, unlockedAt: a.unlocked_at })),
  };
}

/** Routes one request. `now` is passed in so tests can control time. */
export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const res = await route(req, env, now);
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
      del("custom_candidates", "owner_account_id"),
      env.DB.prepare("UPDATE accounts SET display_name = 'Deleted player', avatar = '{}', home_country = NULL, home_region = NULL, status = 'deleted', deleted_at = ? WHERE id = ?").bind(now, accountId),
    ]);
    return json({ ok: true });
  }

  throw new ApiError(404, "not_found", "No such endpoint");
}
