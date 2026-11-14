/**
 * Recovery codes and merging, the parts of online backup that need no network. A recovery code is the profile's key:
 * typing it on another device (or after clearing the browser) signs the same online profile in.
 */
import type { Stats } from "./achievements";
import type { Profile } from "./profile";

/** Crockford's base 32: no I, L, O or U, so a code read aloud or copied by hand stays unambiguous. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 5;
const GROUP = 5;

/** A fresh code: 25 characters (125 random bits) in groups of five, like 7KQ2M-9XH4P-... */
export function newRecoveryCode(): string {
  const b = new Uint8Array(GROUPS * GROUP);
  crypto.getRandomValues(b);
  const chars = Array.from(b, (x) => ALPHABET[x & 31]);
  return Array.from({ length: GROUPS }, (_, i) => chars.slice(i * GROUP, (i + 1) * GROUP).join("")).join("-");
}

/** Tidies a typed code (any case, spaces or dashes, O for 0, I or L for 1); null if it can't be a code. */
export function normalizeCode(input: string): string | null {
  const raw = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (raw.length !== GROUPS * GROUP || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return Array.from({ length: GROUPS }, (_, i) => raw.slice(i * GROUP, (i + 1) * GROUP)).join("-");
}

/** The device key the API is given for a code: a hash, so the code itself never leaves the device. */
export async function keyForCode(code: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`majority-map-recovery:${code}`)));
  let s = "";
  for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Stats only ever grow, so the copy with more play behind it is the newer one. */
export function newerStats(a: Stats, b: Stats): Stats {
  const played = (s: Stats) => s.matches * 1000 + s.turns;
  return played(b) > played(a) ? b : a;
}

/** Every achievement either copy has, each with its earliest unlock time. */
export function mergeUnlocked(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [id, at] of Object.entries(b)) out[id] = id in out ? Math.min(out[id]!, at) : at;
  return out;
}

/** What the server keeps for a profile, in the game's own shapes. */
export interface Remote {
  name: string;
  stats: Stats | null;
  unlocked: Record<string, number>;
}

/**
 * The profile after meeting the online copy. Achievements combine and the busier stats win, so nothing earned on
 * either side is lost. The name: the local one if it was changed here since the last sync (or the server has none).
 */
export function mergeProfile(local: Profile, remote: Remote, nameChangedHere: boolean): Profile {
  return {
    name: nameChangedHere && local.name ? local.name : remote.name || local.name,
    stats: remote.stats ? newerStats(local.stats, remote.stats) : local.stats,
    unlocked: mergeUnlocked(local.unlocked, remote.unlocked),
  };
}
