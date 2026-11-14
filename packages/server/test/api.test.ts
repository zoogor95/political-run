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
});
