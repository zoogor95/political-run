/** Writes a simulator report as Markdown. */
import { STRATEGIES, type AiLevel, type MapPack, type StrategyId } from "@majority-map/core";
import { edge, rate, type Report } from "./sim.js";

export const LIMIT = 0.6;
/** Difficulty line-ups in the report: each should show the stronger level winning more than its even share. */
export const REPORT_LINEUPS: AiLevel[][] = [
  ["normal", "easy", "easy"],
  ["hard", "easy", "easy"],
  ["hard", "normal", "normal"],
  ["hard", "hard", "normal"],
];
/** Leaders outside this band of wins against an even share are flagged for the next tuning pass. */
export const LEADER_BAND: [number, number] = [0.8, 1.25];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const pairRate = (report: Report, a: string, b: string) => (report.duelMatrix[a]?.[b] ?? 0) / (report.duelGames[a]?.[b] || 1);

/** Strategies that lose most of their duels against every other strategy: no threat, and they flatter everyone else's numbers. */
export function dominated(report: Report): StrategyId[] {
  const ids = Object.keys(report.duels) as StrategyId[];
  return ids.filter((a) => ids.every((b) => a === b || pairRate(report, a, b) < 0.5));
}

/** Each strategy's duel win rate against the strategies that aren't dominated (every pair plays the same number of duels). */
export function fieldRate(report: Report, s: StrategyId): number {
  const out = new Set(dominated(report));
  const rivals = (Object.keys(report.duels) as StrategyId[]).filter((b) => b !== s && !out.has(b));
  return rivals.length ? rivals.reduce((a, b) => a + pairRate(report, s, b), 0) / rivals.length : 0;
}

/** Strategies that win more than the limit of their duels against the strategies that aren't dominated. */
export function overLimit(report: Report): StrategyId[] {
  const out = new Set(dominated(report));
  return (Object.keys(report.duels) as StrategyId[]).filter((s) => !out.has(s) && fieldRate(report, s) > LIMIT);
}

export function markdown(pack: MapPack, report: Report): string {
  const ids = Object.keys(STRATEGIES) as StrategyId[];
  const name = (s: string) => STRATEGIES[s as StrategyId]?.name ?? s;
  const leader = (id: string) => pack.candidates.find((c) => c.id === id)?.name ?? id;
  const over = overLimit(report);
  const weak = dominated(report);
  const lines: string[] = [];
  lines.push(`# Balance report: ${pack.name}`, "");
  lines.push(
    `${report.games.toLocaleString("en-GB")} computer-vs-computer matches, every seat played by the Hard AI with one strategy's changes. ` +
      `Half are two-player duels covering every pair of strategies in both seat orders; half are free-for-alls of 3 to 5 players. Leaders are drawn at random.`,
    "",
  );
  lines.push(
    over.length === 0
      ? `**Pass:** no strategy wins more than ${pct(LIMIT)} of its duels against the competitive strategies.`
      : `**Fail:** ${over.map(name).join(", ")} win more than ${pct(LIMIT)} of their duels against the competitive strategies.`,
    "",
  );
  if (weak.length) {
    const one = weak.length === 1;
    lines.push(
      `${weak.map(name).join(", ")} ${one ? "loses" : "lose"} to every other strategy, so ${one ? "it's" : "they're"} left out of the field the limit is checked against: beating ${one ? "it" : "them"} flatters a strategy's numbers.`,
      "",
    );
  }

  lines.push(
    "## Strategies",
    "",
    "| Strategy | What it does | Duels won vs competitive strategies | Duels won vs all | Free-for-all wins vs even share |",
    "| --- | --- | ---: | ---: | ---: |",
  );
  for (const s of ids) {
    const d = report.duels[s];
    const f = report.field[s];
    const vsField = weak.includes(s) ? "(loses to all)" : pct(fieldRate(report, s));
    lines.push(`| ${name(s)} | ${STRATEGIES[s].about} | ${d ? vsField : "–"} | ${d ? pct(rate(d)) : "–"} | ${f ? `${edge(f).toFixed(2)}×` : "–"} |`);
  }
  lines.push("", "An even share in a free-for-all is 1.00×: a 4-player strategy at 1.00× wins a quarter of its games.", "");

  lines.push("## Head to head", "", "Row strategy's win rate against the column strategy.", "");
  lines.push(`| | ${ids.map(name).join(" | ")} |`, `| --- | ${ids.map(() => "---:").join(" | ")} |`);
  for (const a of ids) {
    const cells = ids.map((b) => {
      if (a === b) return "–";
      const g = report.duelGames[a]?.[b] ?? 0;
      return g ? pct((report.duelMatrix[a]?.[b] ?? 0) / g) : "–";
    });
    lines.push(`| ${name(a)} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const [lo, hi] = LEADER_BAND;
  const outside = Object.entries(report.leaders).filter(([, t]) => edge(t) < lo || edge(t) > hi);
  lines.push("## Leaders", "", `Wins compared with an even share, across every match the leader played. Leaders outside ${lo.toFixed(2)}× to ${hi.toFixed(2)}× are flagged for the next tuning pass.`, "");
  lines.push(outside.length ? `Flagged: ${outside.map(([id]) => leader(id)).join(", ")}.` : "No leader is outside the band.", "");
  lines.push("| Leader | Matches | Wins vs even share |", "| --- | ---: | ---: |");
  for (const [id, t] of Object.entries(report.leaders).sort(([, a], [, b]) => edge(b) - edge(a))) lines.push(`| ${leader(id)} | ${t.games} | ${edge(t).toFixed(2)}× |`);
  lines.push("");

  if (report.lineups?.length) {
    const label = (l: string) => l[0]!.toUpperCase() + l.slice(1);
    lines.push("## Difficulty levels", "", "Each line-up is played in every seat order with random leaders, every party on the plain AI for its level.", "");
    lines.push("| Line-up | Matches | Wins by level (even share) |", "| --- | ---: | --- |");
    for (const r of report.lineups) {
      const levels = [...new Set(r.levels)];
      const cells = levels.map((l) => `${label(l)} ${pct(r.share[l] ?? 0)} (${pct(r.levels.filter((x) => x === l).length / r.levels.length)})`);
      lines.push(`| ${r.levels.map(label).join(", ")} | ${r.games} | ${cells.join(" · ")} |`);
    }
    lines.push("");
  }

  lines.push("## Seat order", "", "Seat 1 is the first player in the list. Plans are secret and resolve together, so seat order should not matter.", "", "| Seat | Matches | Wins vs even share |", "| --- | ---: | ---: |");
  for (const [k, t] of Object.entries(report.seats).sort(([a], [b]) => a.localeCompare(b))) lines.push(`| ${k} | ${t.games} | ${edge(t).toFixed(2)}× |`);
  lines.push("");

  lines.push("## Match shape", "");
  lines.push(`- Length: ${report.turns.mean.toFixed(1)} turns on average (${report.turns.min} to ${report.turns.max}).`);
  lines.push(`- Second rounds after a tie: ${pct(report.secondRounds / report.games)} of matches.`);
  lines.push(`- Matches that hit the ${pack.rules.turnCap}-turn cap: ${pct(report.capped / report.games)}.`);
  lines.push(`- The winner holds ${pct(report.winnerSeatShare)} of the seats on average; ${pct(report.majorityWins / report.games)} of winners have a majority.`);
  lines.push(`- Money lost to clashes (two parties aiming for the same step): ${pct(report.lostShare)} of all spending.`);
  lines.push("");
  return lines.join("\n");
}
