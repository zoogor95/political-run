/**
 * Custom candidates: a player-made leader whose bonuses and penalties are bought from a points budget, so a custom
 * candidate is never stronger than the pack's own leaders (the balance simulator checks this for every pack).
 *
 * Prices are per 5% step. A state group costs points by its share of the parliament (its regions' seats, counting the
 * reserved seats they decide): a fifteenth of the seats is 1 point, a third of them 5. A national group costs points by
 * its income against the base income a turn: a fifteenth of it is 1 point. A penalty gives back half a step's price,
 * rounded down, so penalties on small groups give nothing back. The balance simulator checks the strongest builds
 * against the pack's own leaders.
 */
import { seatWeight, totalSeats } from "./standing.js";
import type { CandidateDef, MapPack } from "./types.js";

export const CUSTOM_RULES = {
  /** Modifiers move in steps of this many percent. */
  step: 5,
  /** Largest bonus or penalty on one group, in percent. */
  maxPct: 15,
  maxModifiers: 4,
  maxName: 28,
  maxBio: 140,
  /** Budget when the pack doesn't set its own. */
  defaultBudget: 8,
} as const;

/** A custom candidate: the pack's candidate shape plus a short bio. The avatar is the game's business, kept as data. */
export interface CustomCandidate extends CandidateDef {
  custom: true;
  /** The pack it was built for: its bonuses name that pack's groups. */
  packId: string;
  bio: string;
  avatar: Record<string, string | boolean>;
}

/** Points for each 5% bonus on a group. */
export function customPrice(pack: MapPack, groupId: string): number {
  const group = pack.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Unknown group "${groupId}"`);
  if (group.kind === "national") return Math.max(1, Math.round((15 * group.income) / pack.rules.baseIncome));
  const seats = pack.regions.filter((r) => group.regions.includes(r.id)).reduce((a, r) => a + r.seats * seatWeight(pack, r.id), 0);
  return Math.max(1, Math.round((15 * seats) / totalSeats(pack)));
}

/** Points back for each 5% penalty on a group. */
export function customRefund(pack: MapPack, groupId: string): number {
  return Math.floor(customPrice(pack, groupId) / 2);
}

/** Points a set of modifiers costs: bonuses minus what penalties give back. */
export function customCost(pack: MapPack, modifiers: Record<string, number>): number {
  let points = 0;
  for (const [g, pct] of Object.entries(modifiers)) {
    const steps = Math.abs(pct) / CUSTOM_RULES.step;
    points += pct > 0 ? steps * customPrice(pack, g) : -steps * customRefund(pack, g);
  }
  return points;
}

export function customBudget(pack: MapPack): number {
  return pack.customBudget ?? CUSTOM_RULES.defaultBudget;
}

export interface CustomIssue {
  field: "name" | "bio" | "modifiers" | "packId";
  message: string;
}

/** Checks a custom candidate against a pack. An empty list means it can be saved and played. */
export function validateCustom(pack: MapPack, c: CustomCandidate): CustomIssue[] {
  const issues: CustomIssue[] = [];
  const add = (field: CustomIssue["field"], message: string) => issues.push({ field, message });
  if (c.packId !== pack.id) add("packId", `Built for another map (${c.packId})`);
  const name = c.name.trim();
  if (!name) add("name", "Give your candidate a name");
  if (name.length > CUSTOM_RULES.maxName) add("name", `A name has at most ${CUSTOM_RULES.maxName} characters`);
  if (pack.candidates.some((x) => x.name.toLowerCase() === name.toLowerCase())) add("name", "That's the name of one of the map's own leaders");
  if (c.bio.length > CUSTOM_RULES.maxBio) add("bio", `A bio has at most ${CUSTOM_RULES.maxBio} characters`);
  const entries = Object.entries(c.modifiers);
  if (entries.length > CUSTOM_RULES.maxModifiers) add("modifiers", `At most ${CUSTOM_RULES.maxModifiers} bonuses and penalties`);
  for (const [g, pct] of entries) {
    if (!pack.groups.some((x) => x.id === g)) add("modifiers", `Unknown group "${g}"`);
    else if (!Number.isInteger(pct / CUSTOM_RULES.step) || pct === 0 || Math.abs(pct) > CUSTOM_RULES.maxPct) {
      add("modifiers", `Bonuses and penalties go in steps of ${CUSTOM_RULES.step}%, up to ${CUSTOM_RULES.maxPct}%`);
    }
  }
  if (issues.every((i) => i.field !== "modifiers") && customCost(pack, c.modifiers) > customBudget(pack)) {
    add("modifiers", `Costs ${customCost(pack, c.modifiers)} points; the budget is ${customBudget(pack)}`);
  }
  return issues;
}

/** The pack with custom candidates added, so they can lead a party in a match on it. */
export function withCustomCandidates(pack: MapPack, customs: CustomCandidate[]): MapPack {
  const mine = customs.filter((c) => c.packId === pack.id && !pack.candidates.some((x) => x.id === c.id));
  if (mine.length === 0) return pack;
  return { ...pack, candidates: [...pack.candidates, ...mine] };
}
