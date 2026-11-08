/** Match setup: who sits at the table (2 to 5 seats, human or computer), each party's name, colour, emblem and leader. */
import type { AiLevel, PlayerSetup } from "@majority-map/core";
import { map, pack, type MapId } from "./model";

export type Mode = "solo" | "hotseat";

export interface Seat {
  id: string;
  kind: "human" | "ai";
  /** Shown on the hand-off screen in pass and play, for example "Player 2". */
  label: string;
  level: AiLevel;
  party: { name: string; color: string; emblem: string };
  leaderId: string;
}

export interface MatchConfig {
  mode: Mode;
  /** The map; saves from before maps could be chosen are the UK. */
  map?: MapId;
  seats: Seat[];
}

/** The colour palette from the designs: colours are first come, first served. */
export const COLORS: { name: string; hex: string }[] = [
  { name: "Purple", hex: "#6a3fc8" },
  { name: "Teal", hex: "#0f8a7e" },
  { name: "Coral", hex: "#e8604c" },
  { name: "Navy", hex: "#24408e" },
  { name: "Gold", hex: "#d9a21b" },
  { name: "Pink", hex: "#d63f8c" },
  { name: "Olive", hex: "#6b8e23" },
  { name: "Sky", hex: "#2f8fd6" },
  { name: "Brown", hex: "#8d5a33" },
  { name: "Slate", hex: "#4b5563" },
  { name: "Lime", hex: "#7cb518" },
  { name: "Plum", hex: "#8e2a6b" },
];

/** Our own emblems; symbols real parties use on ballots are never offered. */
export const EMBLEMS = ["megaphone", "owl", "lighthouse", "paper-plane", "compass", "balloon", "mountain", "acorn"];
export const EMBLEM_NAME: Record<string, string> = {
  megaphone: "Megaphone",
  owl: "Owl",
  lighthouse: "Lighthouse",
  "paper-plane": "Paper plane",
  compass: "Compass",
  balloon: "Balloon",
  mountain: "Mountain",
  acorn: "Acorn",
};

const firstFree = <T,>(options: T[], used: T[]) => options.find((o) => !used.includes(o)) ?? options[0]!;

/** A computer seat with the next free made-up party name, colour, emblem and leader. */
export function aiSeat(seats: Seat[], index: number, level: AiLevel = "normal"): Seat {
  // Computer parties default to leaders from real parties not yet at the table, so rivals feel distinct.
  const usedAffiliations = new Set(seats.map((s) => pack.candidates.find((c) => c.id === s.leaderId)?.affiliation));
  const leaders = [...pack.candidates.filter((c) => !usedAffiliations.has(c.affiliation)), ...pack.candidates].map((c) => c.id);
  return {
    id: `ai${index}`,
    kind: "ai",
    label: `Computer ${index}`,
    level,
    party: {
      name: firstFree(pack.aiPartyNames, seats.map((s) => s.party.name)),
      color: firstFree(COLORS.map((c) => c.hex), seats.map((s) => s.party.color)),
      emblem: firstFree(EMBLEMS, seats.map((s) => s.party.emblem)),
    },
    leaderId: firstFree(leaders, seats.map((s) => s.leaderId)),
  };
}

export function humanSeat(seats: Seat[], index: number): Seat {
  const first = index === 1;
  return {
    id: first ? "you" : `p${index}`,
    kind: "human",
    label: `Player ${index}`,
    level: "normal",
    party: {
      name: first ? "Zoogor Party" : `Player ${index} Party`,
      color: firstFree(COLORS.map((c) => c.hex), seats.map((s) => s.party.color)),
      emblem: firstFree(EMBLEMS, seats.map((s) => s.party.emblem)),
    },
    leaderId: firstFree(first ? [map.defaultLeader, ...pack.candidates.map((c) => c.id)] : pack.candidates.map((c) => c.id), seats.map((s) => s.leaderId)),
  };
}

/**
 * The default table on the selected map: solo is you against two Normal computer parties; pass and play starts with
 * two people and one computer.
 */
export function defaultConfig(mode: Mode, level: AiLevel = "normal"): MatchConfig {
  const seats: Seat[] = [];
  seats.push(humanSeat(seats, 1));
  if (mode === "hotseat") seats.push(humanSeat(seats, 2));
  while (seats.length < 3) seats.push(aiSeat(seats, seats.length, level));
  return { mode, map: map.id, seats };
}

export interface ConfigIssue {
  seatId?: string;
  message: string;
}

/** Checks a setup before the match starts: seat counts, and each colour, emblem and leader used once. */
export function checkConfig(config: MatchConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const humans = config.seats.filter((s) => s.kind === "human").length;
  if (config.seats.length < 2 || config.seats.length > 5) issues.push({ message: "A match needs 2 to 5 seats." });
  if (config.mode === "solo" && humans !== 1) issues.push({ message: "A solo match has exactly one human player." });
  if (config.mode === "hotseat" && humans < 2) issues.push({ message: "Pass and play needs at least two human players." });
  const dupe = (key: (s: Seat) => string, what: string) => {
    const seen = new Map<string, string>();
    for (const s of config.seats) {
      const k = key(s).trim().toLowerCase();
      if (seen.has(k)) issues.push({ seatId: s.id, message: `${s.party.name || s.label} has the same ${what} as ${seen.get(k)}.` });
      else seen.set(k, s.party.name || s.label);
    }
  };
  dupe((s) => s.party.color, "colour");
  dupe((s) => s.party.emblem, "emblem");
  dupe((s) => s.leaderId, "leader");
  dupe((s) => s.party.name, "party name");
  for (const s of config.seats) if (!s.party.name.trim()) issues.push({ seatId: s.id, message: `${s.label} needs a party name.` });
  return issues;
}

export function playersOf(config: MatchConfig): PlayerSetup[] {
  return config.seats.map((s) => ({ id: s.id, leaderId: s.leaderId, party: { ...s.party, name: s.party.name.trim() } }));
}
