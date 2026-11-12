/**
 * Balance simulator. Plays computer-vs-computer matches on a map pack across worker threads.
 *
 *   pnpm balance                                   10,000 strategy matches plus difficulty line-ups; writes docs/balance/uk.md
 *   pnpm balance --games 2000 --out /tmp/uk.md     a quicker report somewhere else
 *   pnpm balance --rules contentionAt=4            try rule numbers before putting them in the pack
 *   pnpm balance --costs 2 --income 0.5            try every step cost, or every group income, scaled
 *   pnpm balance --versus '{"spend":0.8}'          mirrored duels of AI settings against the plain Hard AI
 *   pnpm balance --lineup hard,normal,normal       one difficulty line-up in every seat order (--tune '{...}' changes the Hard seats)
 *
 * The report run exits with an error when a strategy wins more than the limit of its duels against the competitive field.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { withCustomCandidates, type AiLevel, type MapPack, type Tuning } from "@majority-map/core";
import { REPORT_LINEUPS, markdown, overLimit, strongCustoms } from "./report.js";
import { customBuilds, customResults, customSchedule, lineup, lineupResult, schedule, summarize, versus, versusResult, type MatchRecord, type ScheduledMatch } from "./sim.js";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1] ?? "");
}
const games = Number(args.get("games") ?? 10_000);
const packId = args.get("pack") ?? "uk";
const seed = Number(args.get("seed") ?? 1);
const threads = Number(args.get("workers") ?? availableParallelism());
const root = new URL("../../../", import.meta.url);

const pack = JSON.parse(readFileSync(new URL(`packages/content/packs/${packId}/pack.json`, root), "utf8")) as MapPack;
for (const pair of (args.get("rules") ?? "").split(",").filter(Boolean)) {
  const [key, value] = pair.split("=") as [keyof MapPack["rules"], string];
  if (!(key in pack.rules)) throw new Error(`Unknown rule "${key}"`);
  pack.rules[key] = Number(value);
}

for (const r of pack.regions) r.baseCost = Math.round(r.baseCost * Number(args.get("costs") ?? 1));
for (const g of pack.groups) {
  if (g.baseCost !== undefined) g.baseCost = Math.round(g.baseCost * Number(args.get("costs") ?? 1));
  g.income = Math.round(g.income * Number(args.get("income") ?? 1));
}

/** Plays every match across the worker threads; records come back in schedule order. */
async function playAll(list: ScheduledMatch[], on: MapPack = pack): Promise<MatchRecord[]> {
  const slices: number[][] = Array.from({ length: threads }, () => []);
  list.forEach((_, i) => slices[i % threads]!.push(i));
  const records: MatchRecord[] = new Array<MatchRecord>(list.length);
  let done = 0;
  await Promise.all(
    slices.map(
      (indexes) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL("./worker-boot.mjs", import.meta.url), { workerData: { pack: on, matches: indexes.map((i) => list[i]!) } });
          let k = 0;
          w.on("message", (record: MatchRecord) => {
            records[indexes[k++]!] = record;
            if (++done % 1000 === 0) process.stderr.write(`${done} / ${list.length}\n`);
          });
          w.on("error", reject);
          w.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
        }),
    ),
  );
  return records;
}

const started = performance.now();
const vs = args.get("versus");
const levels = args.get("lineup")?.split(",") as AiLevel[] | undefined;

if (vs) {
  const against = args.get("against") ?? "{}";
  const r = versusResult(await playAll(versus(pack, JSON.parse(vs) as Partial<Tuning>, JSON.parse(against) as Partial<Tuning>, games, seed)));
  console.log(`${vs} vs ${against}: wins ${(r.share * 100).toFixed(1)}% ± ${(r.margin * 100).toFixed(1)} over ${games} games, ${r.turns.toFixed(1)} turns`);
} else if (levels) {
  const tune = args.get("tune");
  const r = lineupResult(levels, await playAll(lineup(pack, levels, games, seed, tune ? (JSON.parse(tune) as Partial<Tuning>) : undefined)));
  const even = (l: AiLevel) => levels.filter((x) => x === l).length / levels.length;
  const parts = (Object.entries(r.share) as [AiLevel, number][]).map(([l, s]) => `${l} ${(s * 100).toFixed(1)}% (even ${(even(l) * 100).toFixed(0)}%)`);
  console.log(`${levels.join(",")}: ${parts.join(", ")} over ${games} games`);
} else {
  const out = new URL(args.get("out") ?? `docs/balance/${packId}.md`, root);
  const list = schedule(pack, games, seed);
  const records = await playAll(list);
  const report = summarize(pack, list.map((match, i) => ({ match, record: records[i]! })));
  // Difficulty line-ups: 800 matches each by default, scaled down with --games for quick runs.
  const lineupGames = Math.max(30, Math.round(games / 12.5));
  report.lineups = [];
  for (const l of REPORT_LINEUPS) report.lineups.push(lineupResult(l, await playAll(lineup(pack, l, lineupGames, seed))));
  // Custom candidates: the strongest legal builds against the pack's own leaders.
  const builds = customBuilds(pack);
  const withBuilds = withCustomCandidates(pack, builds);
  const customList = customSchedule(pack, builds, Math.max(30, Math.round(games / 25)), seed);
  const customRecords = await playAll(customList, withBuilds);
  report.customs = customResults(builds, pack, customList.map((match, i) => ({ match, record: customRecords[i]! })));
  mkdirSync(new URL(".", out), { recursive: true });
  writeFileSync(out, markdown(pack, report));
  writeFileSync(new URL(out.href.replace(/\.md$/, ".json")), JSON.stringify(report, null, 2) + "\n");
  process.stderr.write(`Done in ${((performance.now() - started) / 1000).toFixed(1)}s. Report: ${out.pathname}\n`);
  const over = overLimit(report);
  if (over.length) {
    process.stderr.write(`Over the limit: ${over.join(", ")}\n`);
    process.exitCode = 1;
  }
  const strong = strongCustoms(report);
  if (strong.length) {
    process.stderr.write(`Custom builds stronger than the leader band: ${strong.join(", ")}\n`);
    process.exitCode = 1;
  }
}
