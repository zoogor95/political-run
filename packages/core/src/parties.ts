/**
 * The parties' looks, shared by the device and the server: the colour palette (first come, first served), the
 * emblems (our own; symbols real parties use on ballots are never offered), and on Presidential maps each real party's
 * family of shades, so every candidate's party follows from the candidate.
 */
import type { MapPack } from "./types.js";

export const PARTY_COLORS: { name: string; hex: string }[] = [
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

export const PARTY_EMBLEMS = ["megaphone", "owl", "lighthouse", "paper-plane", "compass", "balloon", "mountain", "acorn"];

export const PARTY_SHADES: Record<string, string[]> = {
  Republican: ["#c8102e", "#e8604c", "#8b1a1a", "#d9822b", "#5c0f12"],
  Democratic: ["#1f4fb4", "#2f8fd6", "#24408e", "#0f8a7e", "#0b2e6b"],
  Independent: ["#6a3fc8", "#8e2a6b", "#4b5563", "#b58ae0", "#2d3748"],
};

/**
 * Presidential: every seat's party from its candidate. The name is the candidate's, the colour a shade of the
 * candidate's party (Independent for anyone else, custom candidates included), the emblem simply the next one.
 */
export function candidateParties<T extends { leaderId: string; party: { name: string; color: string; emblem: string } }>(
  pack: MapPack,
  seats: T[],
  names: Record<string, string> = {},
): T[] {
  const used: Record<string, number> = {};
  return seats.map((s, i) => {
    const c = pack.candidates.find((x) => x.id === s.leaderId);
    const name = c?.name ?? names[s.leaderId] ?? s.leaderId;
    const family = c && PARTY_SHADES[c.affiliation] ? c.affiliation : "Independent";
    const k = used[family] ?? 0;
    used[family] = k + 1;
    const shades = PARTY_SHADES[family]!;
    return { ...s, party: { name, color: shades[k % shades.length]!, emblem: PARTY_EMBLEMS[i % PARTY_EMBLEMS.length]! } };
  });
}
