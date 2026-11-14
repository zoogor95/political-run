/**
 * Online backup of the profile: name, settings, stats and achievements, kept on the game's server so a player keeps
 * them after clearing the browser or on another device. Off until the player turns it on; then every change is sent
 * a moment later, and the online copy is fetched each time the game opens.
 */
import { useSyncExternalStore } from "react";
import { EMPTY_STATS, type Stats } from "./achievements";
import { loadProfile, onProfileChange, replaceProfile } from "./profile";
import { keyForCode, mergeProfile, newRecoveryCode, normalizeCode, type Remote } from "./recovery";
import { getSettings, onSettingsChange, updateSettings, type Settings } from "./settings";

/** Tests point the game at a local server by setting mm.apiUrl to a localhost address. */
function localOverride(): string | null {
  try {
    const v = localStorage.getItem("mm.apiUrl");
    return v && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export const API_URL: string = localOverride() ?? (import.meta.env.VITE_API_URL as string | undefined) ?? "https://majority-map-api.muhammademadk.workers.dev";

/** The session token while backup is on (online play signs in with the same profile). */
export const sessionToken = (): string | null => saved?.token ?? null;

/** The online profile online play needs: backup is turned on first if it's off. */
export async function ensureAccount(): Promise<void> {
  if (!saved) await backUp();
}

const KEY = "mm.cloud.v1";
/** How long after a change the backup is sent, so a burst of changes goes up once. */
const DEBOUNCE_MS = 2000;

interface Saved {
  code: string;
  token: string;
  /** What was last sent, part by part, so only changes go up and a name edited offline wins over the server's. */
  sent: { name?: string; settings?: string; stats?: string; unlocked?: string };
  syncedAt: number | null;
}

export type CloudStatus =
  | { state: "off" }
  | { state: "syncing" | "synced" | "offline"; syncedAt: number | null; code: string };

let saved: Saved | null = readSaved();
let busy = false;
let failed = false;
const listeners = new Set<() => void>();
let status: CloudStatus = computeStatus();

function readSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return v && typeof v.code === "string" && typeof v.token === "string" ? { ...v, sent: v.sent ?? {} } : null;
  } catch {
    return null;
  }
}

function writeSaved(v: Saved | null) {
  saved = v;
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    // Backup then lasts for this visit only.
  }
  changed();
}

function computeStatus(): CloudStatus {
  if (!saved) return { state: "off" };
  return { state: busy ? "syncing" : failed ? "offline" : "synced", syncedAt: saved.syncedAt, code: saved.code };
}

function changed() {
  status = computeStatus();
  listeners.forEach((l) => l());
}

export function useCloud(): CloudStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

/** A problem the player should read, worded for them. */
export class CloudError extends Error {}

async function api<T>(method: string, path: string, body?: unknown, token = saved?.token): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new CloudError("Couldn't reach the game's server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok) {
    if (res.status === 401 && token) {
      // The session ended (signed out elsewhere, or deleted): this device stops backing up.
      writeSaved(null);
      throw new CloudError("This device was signed out of the online backup. Restore with your recovery code to turn it back on.");
    }
    throw new CloudError(data?.error?.code === "no_account" ? "No profile has that recovery code. Check it and try again." : "The game's server had a problem. Try again in a minute.");
  }
  return data as T;
}

interface ServerProfile {
  token?: string;
  account: { displayName: string };
  settings: unknown;
  stats: unknown;
  achievements: { code: string; unlockedAt: number }[];
}

function remoteOf(p: ServerProfile): Remote {
  const stats = p.stats && typeof p.stats === "object" ? ({ ...EMPTY_STATS, ...(p.stats as Partial<Stats>) } as Stats) : null;
  return { name: p.account.displayName, stats, unlocked: Object.fromEntries(p.achievements.map((a) => [a.code, a.unlockedAt])) };
}

const deviceLabel = () => (typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 64) : undefined);

/** Folds the online copy into this device: see mergeProfile. Settings: this device's if changed here, else the server's. */
function applyRemote(p: ServerProfile, preferLocal: boolean) {
  const local = loadProfile();
  const nameChangedHere = preferLocal || (saved?.sent.name !== undefined && saved.sent.name !== local.name);
  replaceProfile(mergeProfile(local, remoteOf(p), nameChangedHere));
  const settingsChangedHere = preferLocal || (saved?.sent.settings !== undefined && saved.sent.settings !== JSON.stringify(getSettings()));
  if (!settingsChangedHere && p.settings && typeof p.settings === "object") updateSettings(p.settings as Partial<Settings>);
}

/** Sends whatever differs from what was last sent. */
async function push() {
  if (!saved) return;
  const p = loadProfile();
  const now = {
    name: p.name.trim(),
    settings: JSON.stringify(getSettings()),
    stats: JSON.stringify(p.stats),
    unlocked: JSON.stringify(p.unlocked),
  };
  const sent = { ...saved.sent };
  const token = saved.token;
  const still = () => saved?.token === token;
  if (now.name && now.name !== sent.name) {
    await api("PUT", "/api/me", { displayName: now.name });
    sent.name = now.name;
  }
  if (still() && now.settings !== sent.settings) {
    await api("PUT", "/api/me/settings", { settings: getSettings() });
    sent.settings = now.settings;
  }
  if (still() && now.stats !== sent.stats) {
    await api("PUT", "/api/me/stats", { stats: p.stats });
    sent.stats = now.stats;
  }
  if (still() && now.unlocked !== sent.unlocked) {
    await api("POST", "/api/me/achievements", { achievements: Object.entries(p.unlocked).map(([code, unlockedAt]) => ({ code, unlockedAt })) });
    sent.unlocked = now.unlocked;
  }
  if (saved && still()) writeSaved({ ...saved, sent, syncedAt: Date.now() });
}

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

/**
 * Runs one backup step after any step already running, so a sync never overlaps a restore or a delete, and keeps the
 * status line honest.
 */
function run<T>(step: () => Promise<T>): Promise<T> {
  pending++;
  busy = true;
  changed();
  const out = queue.then(step);
  queue = out.catch(() => undefined);
  return out.then(
    (v) => {
      failed = false;
      return v;
    },
    (e: unknown) => {
      failed = true;
      throw e;
    },
  ).finally(() => {
    busy = --pending > 0;
    changed();
  });
}

/** Turns backup on: a new online profile with everything on this device, and the recovery code to write down. */
export async function backUp(): Promise<string> {
  const code = newRecoveryCode();
  const p = loadProfile();
  return run(async () => {
    const res = await api<ServerProfile>("POST", "/api/accounts/device", { key: await keyForCode(code), deviceLabel: deviceLabel(), ...(p.name.trim() ? { displayName: p.name.trim() } : {}) }, "");
    writeSaved({ code, token: res.token!, sent: p.name.trim() ? { name: p.name.trim() } : {}, syncedAt: null });
    applyRemote(res, true);
    await push();
    return code;
  });
}

/** Signs this device in to the online profile a code belongs to, keeping anything earned here too. */
export async function restore(input: string): Promise<void> {
  const code = normalizeCode(input);
  if (!code) throw new CloudError("That isn't a recovery code. It's 25 letters and numbers, like 7KQ2M-9XH4P-…");
  await run(async () => {
    const res = await api<ServerProfile>("POST", "/api/accounts/device", { key: await keyForCode(code), deviceLabel: deviceLabel(), create: false }, "");
    writeSaved({ code, token: res.token!, sent: {}, syncedAt: null });
    applyRemote(res, false);
    await push();
  });
}

/** Fetches the online copy, merges it in and sends back anything newer here. */
export async function syncNow(): Promise<void> {
  if (!saved) return;
  await run(async () => {
    applyRemote(await api<ServerProfile>("GET", "/api/me"), false);
    await push();
  });
}

/** Stops backing up on this device. The online profile stays; the recovery code brings it back. */
export async function stopBackup(): Promise<void> {
  if (!saved) return;
  await run(async () => {
    await api("POST", "/api/sessions/end").catch(() => undefined);
    writeSaved(null);
  });
}

/** Deletes the online profile for good. This device keeps its own copy. */
export async function deleteBackup(): Promise<void> {
  if (!saved) return;
  await run(async () => {
    await api("DELETE", "/api/me");
    writeSaved(null);
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  if (!saved) return;
  clearTimeout(timer);
  timer = setTimeout(() => void run(push).catch(() => undefined), DEBOUNCE_MS);
}

let started = false;
/** Called once when the game opens: catches up with the online copy, then sends each change as it happens. */
export function startCloud() {
  if (started) return;
  started = true;
  onProfileChange(schedule);
  onSettingsChange(schedule);
  if (typeof window !== "undefined") window.addEventListener("online", () => saved && void syncNow().catch(() => undefined));
  if (saved) void syncNow().catch(() => undefined);
}
