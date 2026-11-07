/**
 * The news ticker: headlines generated from templates with blanks filled from real game events, so they are always
 * accurate (and translatable: only the templates change). Each map pack has its own template file.
 */
import { nextRandom } from "./rng.js";
import type { TurnSummary } from "./summary.js";

export const HEADLINE_KINDS = [
  "conflict",
  "conflict_you",
  "first_entry",
  "big_move",
  "saving",
  "locked",
  "free_pip",
  "control_gained",
  "control_lost",
  "contention",
  "final_turn",
  "election",
  "second_round",
  "lead_change",
  "race_leader",
  "race_close",
  "member_picked",
  "filler",
] as const;
export type HeadlineKind = (typeof HEADLINE_KINDS)[number];

/** Placeholders a template may use. Each kind gets only the ones that make sense for it. */
export const PLACEHOLDERS: Record<HeadlineKind, string[]> = {
  conflict: ["parties", "region", "amount", "step"],
  conflict_you: ["you", "rivals", "region", "amount", "step"],
  first_entry: ["party", "region"],
  big_move: ["party", "region", "steps"],
  saving: ["party"],
  locked: ["party", "region"],
  free_pip: ["party", "member", "region"],
  control_gained: ["party", "group"],
  control_lost: ["party", "group"],
  contention: ["region"],
  final_turn: [],
  election: [],
  second_round: [],
  lead_change: ["party", "seats"],
  race_leader: ["party", "seats"],
  race_close: ["party", "party2"],
  member_picked: ["party", "member"],
  filler: [],
};

/** Big moments that get a BREAKING card. */
const BREAKING = new Set<HeadlineKind>(["locked", "control_gained", "final_turn", "election", "second_round"]);

const SCORE: Record<HeadlineKind, number> = {
  final_turn: 100,
  election: 100,
  second_round: 100,
  locked: 80,
  control_gained: 70,
  lead_change: 65,
  conflict_you: 60,
  big_move: 40,
  conflict: 35,
  control_lost: 35,
  free_pip: 30,
  race_close: 30,
  race_leader: 28,
  first_entry: 25,
  member_picked: 25,
  saving: 20,
  contention: 20,
  filler: 1,
};

export interface NewsTemplates {
  /** Fictional channel name shown on the ticker, for example "MMN". */
  channel: string;
  templates: Record<HeadlineKind, string[]>;
}

export interface Headline {
  kind: HeadlineKind;
  text: string;
  breaking: boolean;
  /** Higher is more newsworthy; the top one is the headline of the turn. */
  score: number;
  involvesYou: boolean;
}

export interface NewsContext {
  summary: TurnSummary;
  /** The human player, whose campaign the ticker favours. */
  you: string;
  partyName(id: string): string;
  regionName(id: string): string;
  groupName(id: string): string;
  candidateName(id: string): string;
  money(amount: number): string;
  /** Set when the election just ended in a tie and a second round starts. */
  secondRound?: boolean;
}

/** Fills a template's {placeholders}; throws on one the template may not use, so broken templates fail tests. */
export function fillTemplate(template: string, kind: HeadlineKind, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!PLACEHOLDERS[kind].includes(key) || vars[key] === undefined) throw new Error(`Template for ${kind} uses {${key}}: "${template}"`);
    return vars[key]!;
  });
}

const joinNames = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Headlines for one turn, most newsworthy first. Deterministic for the same random state. */
export function headlinesForTurn(news: NewsTemplates, ctx: NewsContext, rng: number, max = 8): { headlines: Headline[]; rng: number } {
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const used = new Set<string>();
  const out: Headline[] = [];
  const add = (kind: HeadlineKind, vars: Record<string, string>, involvesYou: boolean, bonus = 0) => {
    const options = news.templates[kind].filter((t) => !used.has(t));
    const pool = options.length > 0 ? options : news.templates[kind];
    if (pool.length === 0) return;
    const template = pool[Math.floor(rand() * pool.length)]!;
    used.add(template);
    out.push({ kind, text: fillTemplate(template, kind, vars), breaking: BREAKING.has(kind), score: SCORE[kind] + (involvesYou ? 30 : 0) + bonus, involvesYou });
  };
  const { summary, you } = ctx;
  const name = ctx.partyName;

  if (ctx.secondRound) add("second_round", {}, true);
  if (summary.electionNext) add("election", {}, true);
  if (summary.finalTurnNext) add("final_turn", {}, true);

  // Conflicts: one headline per collision, told from your side when you were in it.
  const seen = new Set<string>();
  for (const p of summary.parties) {
    for (const c of p.conflicts) {
      const key = `${c.regionId}:${c.step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const everyone = [p.playerId, ...c.rivals];
      const amount = ctx.money(Math.max(c.amount, ...summary.parties.flatMap((q) => q.conflicts.filter((x) => `${x.regionId}:${x.step}` === key).map((x) => x.amount))));
      const vars = { region: ctx.regionName(c.regionId), amount, step: String(c.step) };
      if (everyone.includes(you)) add("conflict_you", { ...vars, you: name(you), rivals: joinNames(everyone.filter((x) => x !== you).map(name)) }, true);
      else add("conflict", { ...vars, parties: joinNames(everyone.map(name)) }, false);
    }
  }

  for (const p of summary.parties) {
    const mine = p.playerId === you;
    for (const r of p.locked) add("locked", { party: name(p.playerId), region: ctx.regionName(r) }, mine);
    for (const g of p.groupsGained) add("control_gained", { party: name(p.playerId), group: ctx.groupName(g) }, mine);
    for (const g of p.groupsLost) add("control_lost", { party: name(p.playerId), group: ctx.groupName(g) }, mine);
    const big = p.moves.filter((m) => m.to - m.from >= 4).sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    if (big) add("big_move", { party: name(p.playerId), region: ctx.regionName(big.regionId), steps: String(big.to - big.from) }, mine);
    const entry = p.moves.find((m) => m.firstEntry);
    if (entry) add("first_entry", { party: name(p.playerId), region: ctx.regionName(entry.regionId) }, mine);
    const pip = p.freePips[0];
    if (pip) add("free_pip", { party: name(p.playerId), member: ctx.candidateName(pip.candidateId), region: ctx.regionName(pip.regionId) }, mine);
    if (p.picked) add("member_picked", { party: name(p.playerId), member: ctx.candidateName(p.picked) }, mine);
    if (p.spent === 0 && !summary.electionNext) add("saving", { party: name(p.playerId) }, mine);
  }
  const contended = summary.newlyContended[0];
  if (contended) add("contention", { region: ctx.regionName(contended) }, false);

  // The overall race.
  const byBefore = [...summary.parties].sort((a, b) => b.seatsBefore - a.seatsBefore);
  const byAfter = [...summary.parties].sort((a, b) => b.seatsAfter - a.seatsAfter);
  const leader = byAfter[0];
  const second = byAfter[1];
  if (leader && leader.seatsAfter > 0) {
    if (byBefore[0]!.playerId !== leader.playerId && byBefore[0]!.seatsBefore > 0) add("lead_change", { party: name(leader.playerId), seats: String(leader.seatsAfter) }, leader.playerId === you);
    else if (second && leader.seatsAfter - second.seatsAfter <= Math.max(5, leader.seatsAfter * 0.05)) add("race_close", { party: name(leader.playerId), party2: name(second.playerId) }, [leader.playerId, second.playerId].includes(you));
    else add("race_leader", { party: name(leader.playerId), seats: String(leader.seatsAfter) }, leader.playerId === you);
  }

  // Keep the ticker full with campaign-world filler.
  while (out.length < 4) add("filler", {}, false);
  out.sort((a, b) => b.score - a.score);
  return { headlines: out.slice(0, max), rng };
}
