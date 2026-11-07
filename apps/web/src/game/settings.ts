/** Player settings, remembered in this browser: separate music and sound volume, the ticker, recap speed, text size, motion. */
import { useEffect, useState } from "react";

export interface Settings {
  /** 0 to 1. */
  music: number;
  /** 0 to 1. */
  sound: number;
  showTicker: boolean;
  recapSpeed: 1 | 2;
  /** Scales the panels' text: 1, 1.15 or 1.3. */
  textScale: number;
  /** "system" follows the device's reduced-motion setting. */
  motion: "system" | "reduced" | "full";
}

const KEY = "mm.settings.v1";
export const DEFAULT_SETTINGS: Settings = { music: 0.3, sound: 0.7, showTicker: true, recapSpeed: 1, textScale: 1, motion: "system" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function storeSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Settings still apply for this visit.
  }
}

export function prefersReducedMotion(s: Settings): boolean {
  if (s.motion === "reduced") return true;
  if (s.motion === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const listeners = new Set<(s: Settings) => void>();
let current = loadSettings();

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  storeSettings(current);
  listeners.forEach((l) => l(current));
}

/** Current settings, re-rendering when they change; also applies text size and motion to the page. */
export function useSettings(): Settings {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(s.textScale));
    document.documentElement.classList.toggle("reduce-motion", prefersReducedMotion(s));
  }, [s]);
  return s;
}

export function getSettings(): Settings {
  return current;
}
