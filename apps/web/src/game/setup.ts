/** Match setup: who sits at the table (2 to 5 seats, human or computer), each party's name, colour, emblem and leader. */
import type { AiLevel, PlayerSetup } from "@majority-map/core";
import type { CustomCandidate } from "@majority-map/core";
import { map, type MapId } from "./model";

/** "online" is a private match with friends on their own devices. */
export type Mode = "solo" | "hotseat" | "online";

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
  /** Custom candidates leading a party, carried with the match so saves keep them. */
  customs?: CustomCandidate[];
  /** The Learn to play match: the coach runs over it. */
  tutorial?: boolean;
  /** Luck factor: seats are drawn at random on election night, weighted by pips. */
  luck?: boolean;
  /** Online: seconds each person has to send a plan; none waits for everyone. */
  turnSeconds?: number | null;
}

/** Online turn timers, matching the server's list. */
export const TURN_TIMERS: { seconds: number | null; label: string }[] = [
  { seconds: null, label: "No time limit" },
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 43_200, label: "12 hours" },
  { seconds: 86_400, label: "24 hours" },
];

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
/** Each emblem's drawing (40×40, from the design's emblem set), filled with the party colour and outlined in ink. */
export const EMBLEM_PATH: Record<string, string> = {
  megaphone: "M7 16h6l16-8v24l-16-8H7z M13 24l3 9h5l-2-9",
  owl: "M20 6c-8 0-12 6-12 13v13c0 2 2 3 4 3h16c2 0 4-1 4-3V19c0-7-4-13-12-13z M8 8l5 5 M32 8l-5 5 M15 16a4 4 0 1 0 0.1 0z M25 16a4 4 0 1 0 0.1 0z M18 24l2 3 2-3z",
  lighthouse: "M15 35l2-22h6l2 22z M14 13h12l-2-5h-8z M17 8l3-4 3 4 M17 20h6 M16.5 27h7",
  "paper-plane": "M4 19L36 6 27 34l-8-10z M19 24l17-18 M19 24v9l4-5",
  compass: "M20 4a16 16 0 1 0 0.1 0z M20 9l4 11-4 11-4-11z M20 18a2 2 0 1 0 0.1 0z",
  balloon: "M20 4c-8 0-12 6-12 12 0 7 7 12 10 14h4c3-2 10-7 10-14 0-6-4-12-12-12z M17 30l1 4h4l1-4 M16 34h8v3h-8z",
  mountain: "M3 34l12-20 6 9 5-7 11 18z M12 19l3-5 3 5-3 1z",
  acorn: "M10 17c0-5 4-8 10-8s10 3 10 8z M12 17c0 9 4 15 8 17 4-2 8-8 8-17z M20 9V5",
};

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

/** True on a Presidential map: players run as a real candidate under the candidate's real party. */
export const isPresidential = () => map.pack.gameType === "presidential";

/** Presidential party colours: each party's family, a different shade for each of its candidates at the table. */
export const PARTY_SHADES: Record<string, string[]> = {
  Republican: ["#c8102e", "#e8604c", "#8b1a1a", "#d9822b", "#5c0f12"],
  Democratic: ["#1f4fb4", "#2f8fd6", "#24408e", "#0f8a7e", "#0b2e6b"],
  Independent: ["#6a3fc8", "#8e2a6b", "#4b5563", "#b58ae0", "#2d3748"],
};

/**
 * Presidential: every seat's party follows from its candidate. The name is the candidate's, the colour a shade of the
 * candidate's party (Independent for anyone else, custom candidates included), the emblem simply the next free one.
 */
export function withCandidateParties(seats: Seat[], customs: CustomCandidate[] = []): Seat[] {
  const used: Record<string, number> = {};
  return seats.map((s, i) => {
    const c = map.pack.candidates.find((x) => x.id === s.leaderId);
    const name = c?.name ?? customs.find((x) => x.id === s.leaderId)?.name ?? s.leaderId;
    const family = c && PARTY_SHADES[c.affiliation] ? c.affiliation : "Independent";
    const k = used[family] ?? 0;
    used[family] = k + 1;
    const shades = PARTY_SHADES[family]!;
    return { ...s, party: { name, color: shades[k % shades.length]!, emblem: EMBLEMS[i % EMBLEMS.length]! } };
  });
}

/** A computer seat with the next free made-up party name, colour, emblem and leader. */
export function aiSeat(seats: Seat[], index: number, level: AiLevel = "normal"): Seat {
  // Computer parties default to leaders from real parties not yet at the table, so rivals feel distinct.
  const usedAffiliations = new Set(seats.map((s) => map.pack.candidates.find((c) => c.id === s.leaderId)?.affiliation));
  const leaders = [...map.pack.candidates.filter((c) => !usedAffiliations.has(c.affiliation)), ...map.pack.candidates].map((c) => c.id);
  return {
    id: `ai${index}`,
    kind: "ai",
    label: `Computer ${index}`,
    level,
    party: {
      name: firstFree(map.pack.aiPartyNames, seats.map((s) => s.party.name)) ?? `Computer ${index}`,
      color: firstFree(COLORS.map((c) => c.hex), seats.map((s) => s.party.color)),
      emblem: firstFree(EMBLEMS, seats.map((s) => s.party.emblem)),
    },
    leaderId: firstFree(leaders, seats.map((s) => s.leaderId)),
  };
}

export function humanSeat(seats: Seat[], index: number, online = false): Seat {
  const first = index === 1;
  return {
    id: first ? "you" : `p${index}`,
    kind: "human",
    label: first && online ? "You" : online ? `Friend ${index - 1}` : `Player ${index}`,
    level: "normal",
    party: {
      name: first ? "Zoogor Party" : online ? `Friend ${index - 1} Party` : `Player ${index} Party`,
      color: firstFree(COLORS.map((c) => c.hex), seats.map((s) => s.party.color)),
      emblem: firstFree(EMBLEMS, seats.map((s) => s.party.emblem)),
    },
    leaderId: firstFree(first ? [map.defaultLeader, ...map.pack.candidates.map((c) => c.id)] : map.pack.candidates.map((c) => c.id), seats.map((s) => s.leaderId)),
  };
}

/**
 * The default table on the selected map: solo is you against two Normal computer parties; pass and play and online
 * start with two people and one computer.
 */
export function defaultConfig(mode: Mode, level: AiLevel = "normal"): MatchConfig {
  const seats: Seat[] = [];
  seats.push(humanSeat(seats, 1, mode === "online"));
  if (mode !== "solo") seats.push(humanSeat(seats, 2, mode === "online"));
  while (seats.length < 3) seats.push(aiSeat(seats, seats.length, level));
  return { mode, map: map.id, seats: isPresidential() ? withCandidateParties(seats) : seats };
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
  if (config.mode === "online" && humans < 2) issues.push({ message: "Leave at least one seat for a friend." });
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
