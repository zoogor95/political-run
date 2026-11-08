import { describe, expect, it } from "vitest";
import { STRATEGIES, type MapPack, type StrategyId } from "@majority-map/core";
import ukJson from "@majority-map/content/packs/uk/pack.json" with { type: "json" };
import { dominated, fieldRate, markdown, overLimit } from "../src/report.js";
import { lineup, lineupResult, playMatch, schedule, summarize, versus, versusResult, type MatchRecord, type Report } from "../src/sim.js";

const uk = ukJson as MapPack;
const ids = Object.keys(STRATEGIES) as StrategyId[];

describe("schedule", () => {
  const list = schedule(uk, 600, 3);

  it("is half duels covering every ordered pair of strategies equally, half free-for-alls of 3 to 5", () => {
    const duels = list.filter((m) => m.kind === "duel");
    expect(duels).toHaveLength(300);
    const pairs = new Map<string, number>();
    for (const d of duels) pairs.set(d.entrants.map((e) => e.strategy).join(">"), (pairs.get(d.entrants.map((e) => e.strategy).join(">")) ?? 0) + 1);
    expect(pairs.size).toBe(ids.length * (ids.length - 1));
    expect(new Set(pairs.values())).toEqual(new Set([10]));
    for (const f of list.filter((m) => m.kind === "field")) expect(f.entrants.length).toBeGreaterThanOrEqual(3);
  });

  it("never seats the same leader twice and repeats exactly for a seed", () => {
    for (const m of list) expect(new Set(m.entrants.map((e) => e.leaderId)).size).toBe(m.entrants.length);
    expect(schedule(uk, 600, 3)).toEqual(list);
  });
});

describe("playMatch", () => {
  it("plays a match to a result, the same every time for a seed", () => {
    const entrants = [
      { strategy: "balanced" as const, leaderId: "keir-starmer" },
      { strategy: "rush" as const, leaderId: "kemi-badenoch" },
      { strategy: "hoard" as const, leaderId: "ed-davey", level: "easy" as const },
    ];
    const a = playMatch(uk, entrants, 42);
    expect(a.ranking).toHaveLength(3);
    expect(a.seats.reduce((x, y) => x + y, 0)).toBe(uk.regions.reduce((x, r) => x + r.seats, 0));
    expect(a.turns).toBeGreaterThan(1);
    expect(playMatch(uk, entrants, 42)).toEqual(a);
  });
});

describe("versus and line-ups", () => {
  it("mirrors each versus pair: same seed and seat leaders, sides swapped", () => {
    const list = versus(uk, { spend: 0.5 }, {}, 20, 1);
    for (let i = 0; i < list.length; i += 2) {
      const [x, y] = [list[i]!, list[i + 1]!];
      expect(y.seed).toBe(x.seed);
      expect(y.entrants.map((e) => e.leaderId)).toEqual(x.entrants.map((e) => e.leaderId));
      expect(y.entrants.map((e) => e.tuning)).toEqual([x.entrants[1]!.tuning, x.entrants[0]!.tuning]);
    }
  });

  it("scores side A by the game's parity", () => {
    const win = (first: number) => ({ ranking: [first, 1 - first] }) as MatchRecord;
    // Side A sits first in even games and second in odd games: it wins games 0 and 1 here, loses 2 and 3.
    expect(versusResult([win(0), win(1), win(1), win(0)]).share).toBe(0.5);
    expect(versusResult([win(0), win(1)]).share).toBe(1);
  });

  it("rotates a line-up through every seat and credits wins to levels", () => {
    const list = lineup(uk, ["hard", "easy", "easy"], 6, 1);
    expect(list.map((m) => m.entrants.findIndex((e) => e.level === "hard"))).toEqual([0, 2, 1, 0, 2, 1]);
    const records = list.map((m) => ({ entrants: m.entrants, ranking: [m.entrants.findIndex((e) => e.level === "hard")] }) as MatchRecord);
    expect(lineupResult(["hard", "easy", "easy"], records).share).toEqual({ hard: 1 });
  });
});

describe("report", () => {
  /** A report from a duel matrix alone. */
  function fromMatrix(m: Record<string, Record<string, number>>): Report {
    const duelGames: Report["duelGames"] = {};
    const duels = {} as Report["duels"];
    for (const a of Object.keys(m)) {
      duelGames[a] = Object.fromEntries(Object.keys(m[a]!).map((b) => [b, 100]));
      const wins = Object.values(m[a]!).reduce((x, y) => x + y, 0);
      duels[a as StrategyId] = { games: 100 * Object.keys(m[a]!).length, wins, fair: 50 * Object.keys(m[a]!).length };
    }
    return { games: 0, duels, duelMatrix: m, duelGames, field: {} as Report["field"], leaders: {}, seats: {}, turns: { mean: 0, min: 0, max: 0 }, secondRounds: 0, capped: 0, winnerSeatShare: 0, majorityWins: 0 };
  }

  it("leaves a strategy that loses to everyone out of the field, then checks the limit", () => {
    const r = fromMatrix({
      balanced: { rush: 55, hoard: 99 },
      rush: { balanced: 45, hoard: 98 },
      hoard: { balanced: 1, rush: 2 },
    });
    expect(dominated(r)).toEqual(["hoard"]);
    expect(fieldRate(r, "balanced")).toBeCloseTo(0.55);
    expect(overLimit(r)).toEqual([]);
    const lopsided = fromMatrix({ balanced: { rush: 65, hoard: 99 }, rush: { balanced: 35, hoard: 98 }, hoard: { balanced: 1, rush: 2 } });
    expect(overLimit(lopsided)).toEqual(["balanced"]);
  });

  it("summarizes real matches into a Markdown report", () => {
    const list = schedule(uk, 8, 5);
    const report = summarize(uk, list.map((match) => ({ match, record: playMatch(uk, match.entrants, match.seed) })));
    expect(report.games).toBe(8);
    const text = markdown(uk, report);
    expect(text).toContain("# Balance report: United Kingdom");
    expect(text).toContain("## Head to head");
  });
});
