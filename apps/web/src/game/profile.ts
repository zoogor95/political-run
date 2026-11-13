/** The player's local profile: a name, stats and unlocked achievements, kept in this browser. */
import { useSyncExternalStore } from "react";
import { ACHIEVEMENTS, EMPTY_STATS, type Stats } from "./achievements";

export interface Profile {
  name: string;
  stats: Stats;
  /** Achievement id to the time it was unlocked. */
  unlocked: Record<string, number>;
}

const KEY = "mm.profile.v1";
const listeners = new Set<() => void>();
const unlockListeners = new Set<(ids: string[]) => void>();
let cache: Profile | null = null;

export function loadProfile(): Profile {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Profile> | null;
    cache = { name: typeof v?.name === "string" ? v.name : "", stats: { ...EMPTY_STATS, ...(v?.stats ?? {}) }, unlocked: v?.unlocked ?? {} };
  } catch {
    cache = { name: "", stats: { ...EMPTY_STATS }, unlocked: {} };
  }
  return cache;
}

function write(p: Profile) {
  cache = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}

export function setProfileName(name: string) {
  write({ ...loadProfile(), name: name.slice(0, 28) });
}

/** Saves new stats and unlocks earned achievements; tells the toast about the ones that are new. */
export function record(stats: Stats, earned: string[]) {
  const p = loadProfile();
  const fresh = earned.filter((id) => !(id in p.unlocked) && ACHIEVEMENTS.some((a) => a.id === id));
  const now = Date.now();
  write({ ...p, stats, unlocked: { ...p.unlocked, ...Object.fromEntries(fresh.map((id) => [id, now])) } });
  if (fresh.length) unlockListeners.forEach((l) => l(fresh));
}

export function unlock(id: string) {
  record(loadProfile().stats, [id]);
}

export function onUnlock(l: (ids: string[]) => void): () => void {
  unlockListeners.add(l);
  return () => unlockListeners.delete(l);
}

export function useProfile(): Profile {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    loadProfile,
  );
}
