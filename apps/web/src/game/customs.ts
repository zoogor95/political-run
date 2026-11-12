/** Custom candidates saved in this browser, for every map. Storage calls are guarded: private windows can refuse. */
import { useSyncExternalStore } from "react";
import type { CustomCandidate } from "@majority-map/core";

const KEY = "mm.customs.v1";
const listeners = new Set<() => void>();
let cache: CustomCandidate[] | null = null;

function isCustom(x: unknown): x is CustomCandidate {
  const c = x as CustomCandidate;
  return Boolean(c) && c.custom === true && typeof c.id === "string" && typeof c.name === "string" && typeof c.packId === "string" && typeof c.modifiers === "object";
}

export function loadCustoms(): CustomCandidate[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = Array.isArray(v) ? v.filter(isCustom) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: CustomCandidate[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Kept for this visit only.
  }
  listeners.forEach((l) => l());
}

/** Adds a candidate, or replaces the one with the same id. */
export function saveCustom(c: CustomCandidate) {
  const list = loadCustoms();
  write(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]);
}

export function deleteCustom(id: string) {
  write(loadCustoms().filter((x) => x.id !== id));
}

export function newCustomId(): string {
  return `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function useCustoms(packId: string): CustomCandidate[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    loadCustoms,
  );
  return all.filter((c) => c.packId === packId);
}
