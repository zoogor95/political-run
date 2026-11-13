/**
 * Plays computer-vs-computer matches and tallies how each way of playing, each leader and each seat does.
 * Every match is seeded, so a schedule always gives the same results.
 */
import { CUSTOM_RULES, customBudget, customCost, customPrice, customRefund, type CustomCandidate } from "@majority-map/core";
import { STRATEGIES, personality, totalSeats, createMatch, finishElection, nextRandom, planEasy, planSmart, resolveTurn, seedRng, type AiLevel, type GameState, type MapPack, type Plan, type StrategyId, type Tuning } from "@majority-map/core";

export interface Entrant {
  strategy: StrategyId;
  leaderId: string;
  /** Extra AI settings on top of the strategy's, for trying AI changes (see the versus mode). */
  tuning?: Partial<Tuning>;
  /** Difficulty level; Hard unless set. Strategies only change Normal and Hard. */
  level?: AiLevel;
  /** Plays to a per-match personality (as computer players do in the game) instead of the strategy. */
  personality?: boolean;
}

export interface MatchRecord {
  entrants: Entrant[];
  /** Entrant indexes from first to last. */
  ranking: number[];
  /** Seats by entrant index. */
  seats: number[];
  /** Turns played, counting a second round. */
  turns: number;
  secondRound: boolean;
  /** The match hit the pack's turn cap instead of every region reaching contention. */
  capped: boolean;
  /** Money each entrant had left unspent when the election was counted. */
  unspent: number[];
  /** Money each entrant spent, and the part of it lost to clashes (two parties aiming for the same step). */
  spent: number[];
  lost: number[];
}

/** Plays one match to its result, every seat played by the Hard AI with its strategy's changes. */
export function playMatch(pack: MapPack, entrants: Entrant[], seed: number): MatchRecord {
  let state: GameState = createMatch(pack, {
    seed,
    players: entrants.map((e, i) => ({ id: `p${i}`, leaderId: e.leaderId, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })),
  });
  let rng = seedRng(seed * 7919 + 1);
  let secondRound = false;
  let capped = false;
  const spent = entrants.map(() => 0);
  const lost = entrants.map(() => 0);
  for (let guard = 0; guard < 4 * pack.rules.turnCap; guard++) {
    if (state.phase === "election") {
      capped ||= state.turn > pack.rules.turnCap;
      const unspent = state.players.map((p) => Object.values(p.wallets).reduce((a, b) => a + b, p.money));
      const done = finishElection(pack, state);
      if (done.state.phase === "finished") {
        const r = done.result;
        return {
          entrants,
          ranking: r.ranking.map((id) => Number(id.slice(1))),
          seats: state.players.map((p) => r.seats[p.id] ?? 0),
          turns: state.turn - 1,
          secondRound,
          capped,
          unspent,
          spent,
          lost,
        };
      }
      secondRound = true;
      state = done.state;
      continue;
    }
    const plans: Record<string, Plan> = {};
    state.players.forEach((p, i) => {
      const e = entrants[i]!;
      const level = e.level ?? "hard";
      const base = e.personality ? personality(pack, state, p.id).tuning : STRATEGIES[e.strategy].tuning;
      const r = level === "easy" ? planEasy(pack, state, p.id, rng) : planSmart(pack, state, p.id, level, rng, { ...base, ...e.tuning });
      rng = r.rng;
      plans[p.id] = r.plan;
    });
    const turn = resolveTurn(pack, state, plans);
    for (const e of turn.events) {
      if (e.type === "moved") spent[Number(e.playerId.slice(1))]! += e.cost;
      if (e.type === "conflict") {
        for (const [id, cost] of Object.entries(e.costs)) {
          spent[Number(id.slice(1))]! += cost;
          lost[Number(id.slice(1))]! += cost;
        }
      }
    }
    state = turn.state;
  }
  throw new Error(`Match ${seed} did not finish`);
}

export interface ScheduledMatch {
  seed: number;
  entrants: Entrant[];
  /** "duel" for two-player head-to-heads, "field" for three to five players. */
  kind: "duel" | "field";
}

/**
 * The match list: half head-to-head duels covering every pair of strategies in both seat orders, half free-for-alls of
 * three to five players with random strategies. Leaders are drawn at random from the pack, never twice in one match.
 */
export function schedule(pack: MapPack, games: number, seed = 1): ScheduledMatch[] {
  let rng = seedRng(seed);
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const ids = Object.keys(STRATEGIES) as StrategyId[];
  const leaders = (n: number) => {
    const pool = pack.candidates.map((c) => c.id);
    const out: string[] = [];
    while (out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
    return out;
  };
  const pairs: [StrategyId, StrategyId][] = [];
  for (const a of ids) for (const b of ids) if (a !== b) pairs.push([a, b]);
  const out: ScheduledMatch[] = [];
  const duels = Math.floor(games / 2);
  for (let i = 0; i < games; i++) {
    if (i < duels) {
      const [a, b] = pairs[i % pairs.length]!;
      const [la, lb] = leaders(2);
      out.push({ seed: seed * 100_000 + i, kind: "duel", entrants: [{ strategy: a, leaderId: la! }, { strategy: b, leaderId: lb! }] });
    } else {
      const n = 3 + Math.floor(rand() * 3);
      const ls = leaders(n);
      out.push({ seed: seed * 100_000 + i, kind: "field", entrants: ls.map((leaderId) => ({ leaderId, strategy: ids[Math.floor(rand() * ids.length)]! })) });
    }
  }
  return out;
}

/**
 * Mirrored duels between two AI settings: each pair of games uses the same seed and seat leaders with the sides
 * swapped, so leader strength and seat order cancel out. Entrant 0 of every game is side A when its index is even.
 */
export function versus(pack: MapPack, a: Partial<Tuning>, b: Partial<Tuning>, games: number, seed = 1): ScheduledMatch[] {
  let rng = seedRng(seed);
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const out: ScheduledMatch[] = [];
  for (let g = 0; g < games / 2; g++) {
    const pool = pack.candidates.map((c) => c.id);
    const la = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
    const lb = pool[Math.floor(rand() * pool.length)]!;
    const s = seed * 100_000 + g;
    out.push({ seed: s, kind: "duel", entrants: [{ strategy: "balanced", leaderId: la, tuning: a }, { strategy: "balanced", leaderId: lb, tuning: b }] });
    out.push({ seed: s, kind: "duel", entrants: [{ strategy: "balanced", leaderId: la, tuning: b }, { strategy: "balanced", leaderId: lb, tuning: a }] });
  }
  return out;
}

/**
 * A difficulty line-up, e.g. hard, normal, normal, rotated through every seat, with random leaders. Normal and Hard play
 * to their personalities, as in the game, unless `personalities` is false.
 */
export function lineup(pack: MapPack, levels: AiLevel[], games: number, seed = 1, hardTuning?: Partial<Tuning>, personalities = true): ScheduledMatch[] {
  let rng = seedRng(seed);
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  return Array.from({ length: games }, (_, g) => {
    const rot = g % levels.length;
    const order = [...levels.slice(rot), ...levels.slice(0, rot)];
    const pool = pack.candidates.map((c) => c.id);
    const entrants: Entrant[] = order.map((level) => ({
      strategy: "balanced" as const,
      level,
      leaderId: pool.splice(Math.floor(rand() * pool.length), 1)[0]!,
      ...(personalities && level !== "easy" ? { personality: true } : {}),
    }));
    if (hardTuning) for (const e of entrants) if (e.level === "hard") e.tuning = hardTuning;
    return { seed: seed * 100_000 + g, kind: "field" as const, entrants };
  });
}

export interface LineupResult {
  levels: AiLevel[];
  games: number;
  /** Share of matches won by each level. */
  share: Partial<Record<AiLevel, number>>;
  /** Share of all money spent that was lost to clashes. */
  lost: number;
}

export function lineupResult(levels: AiLevel[], records: MatchRecord[]): LineupResult {
  const wins: Partial<Record<AiLevel, number>> = {};
  for (const r of records) {
    const level = r.entrants[r.ranking[0]!]!.level ?? "hard";
    wins[level] = (wins[level] ?? 0) + 1;
  }
  const share = Object.fromEntries(Object.entries(wins).map(([l, n]) => [l, n / records.length]));
  return { levels, games: records.length, share, lost: lostShare(records) };
}

/** Side A's share of wins in a versus schedule, with a 95% margin of error. */
export function versusResult(records: MatchRecord[]): { share: number; margin: number; turns: number; lost: number } {
  const wins = records.filter((r, i) => r.ranking[0] === (i % 2 === 0 ? 0 : 1)).length;
  const share = wins / records.length;
  return { share, margin: 1.96 * Math.sqrt((share * (1 - share)) / records.length), turns: records.reduce((a, r) => a + r.turns, 0) / records.length, lost: lostShare(records) };
}

/** Share of all money spent in these matches that was lost to clashes. */
export function lostShare(records: MatchRecord[]): number {
  const spent = records.reduce((a, r) => a + r.spent.reduce((x, y) => x + y, 0), 0);
  const lost = records.reduce((a, r) => a + r.lost.reduce((x, y) => x + y, 0), 0);
  return spent ? lost / spent : 0;
}

/**
 * The strongest custom candidates a player could build on a pack: each group's bonus at its most, the rest of the
 * budget spent on the biggest groups that still fit; and the same after taking the penalties that give the most points
 * back. If none of these beats the pack's own leaders, no legal build does by much.
 */
export function customBuilds(pack: MapPack): CustomCandidate[] {
  const budget = customBudget(pack);
  const { step, maxPct, maxModifiers } = CUSTOM_RULES;
  const groups = [...pack.groups].sort((a, b) => customPrice(pack, b.id) - customPrice(pack, a.id));
  const fill = (mods: Record<string, number>) => {
    for (const g of groups) {
      if (Object.keys(mods).length >= maxModifiers) break;
      if (mods[g.id] !== undefined) continue;
      let pct = 0;
      while (pct < maxPct && customCost(pack, { ...mods, [g.id]: pct + step }) <= budget) pct += step;
      if (pct > 0) mods[g.id] = pct;
    }
    return mods;
  };
  const builds: { name: string; mods: Record<string, number> }[] = [];
  for (const g of pack.groups) {
    let pct = 0;
    while (pct < maxPct && customCost(pack, { [g.id]: pct + step }) <= budget) pct += step;
    if (pct > 0) builds.push({ name: `max-${g.id}`, mods: fill({ [g.id]: pct }) });
  }
  const refunders = pack.groups.filter((g) => customRefund(pack, g.id) > 0).sort((a, b) => customRefund(pack, b.id) - customRefund(pack, a.id));
  for (const n of [1, 2]) {
    if (refunders.length < n) break;
    builds.push({ name: `penalties-${n}`, mods: fill(Object.fromEntries(refunders.slice(0, n).map((g) => [g.id, -maxPct]))) });
  }
  const seen = new Set<string>();
  return builds
    .filter((b) => {
      const key = JSON.stringify(Object.entries(b.mods).sort());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((b) => ({ id: `custom-${b.name}`, name: b.name, affiliation: "Custom", modifiers: b.mods, custom: true, packId: pack.id, bio: "", avatar: {} }));
}

/**
 * Matches for custom builds: each build leads one party against two or three of the pack's own leaders, every party on
 * the plain Hard AI, the build's seat rotating.
 */
export function customSchedule(pack: MapPack, builds: CustomCandidate[], perBuild: number, seed = 1): ScheduledMatch[] {
  let rng = seedRng(seed * 31 + 7);
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const out: ScheduledMatch[] = [];
  builds.forEach((b, k) => {
    for (let i = 0; i < perBuild; i++) {
      const n = 2 + (i % 3);
      // Opponents are the pack's own leaders only, never another build.
      const pool = pack.candidates.filter((c) => !builds.some((x) => x.id === c.id)).map((c) => c.id);
      const leaders = Array.from({ length: n - 1 }, () => pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
      leaders.splice(i % n, 0, b.id);
      out.push({ seed: seed * 1_000_000 + k * 10_000 + i, kind: "field", entrants: leaders.map((leaderId) => ({ strategy: "balanced" as const, leaderId })) });
    }
  });
  return out;
}

export interface CustomResult {
  id: string;
  modifiers: Record<string, number>;
  points: number;
  tally: Tally;
}

export function customResults(builds: CustomCandidate[], pack: MapPack, matches: { match: ScheduledMatch; record: MatchRecord }[]): CustomResult[] {
  return builds.map((b) => {
    const t: Tally = { games: 0, wins: 0, fair: 0 };
    for (const { match, record } of matches) {
      const seat = match.entrants.findIndex((e) => e.leaderId === b.id);
      if (seat < 0) continue;
      t.games++;
      t.fair += 1 / match.entrants.length;
      if (record.ranking[0] === seat) t.wins++;
    }
    return { id: b.id, modifiers: b.modifiers, points: customCost(pack, b.modifiers), tally: t };
  });
}

export interface Tally {
  games: number;
  wins: number;
  /** Sum of 1/players over the games played: the wins an even share would give. */
  fair: number;
}

export interface Report {
  games: number;
  duels: Record<StrategyId, Tally>;
  /** Head-to-head wins: duelMatrix[a][b] is a's wins against b, out of duelGames[a][b]. */
  duelMatrix: Record<string, Record<string, number>>;
  duelGames: Record<string, Record<string, number>>;
  field: Record<StrategyId, Tally>;
  leaders: Record<string, Tally>;
  /** Win tallies by seat position (first to plan, second, ...) and number of players. */
  seats: Record<string, Tally>;
  turns: { mean: number; min: number; max: number };
  secondRounds: number;
  capped: number;
  /** Average share of the winner's seats in the parliament. */
  winnerSeatShare: number;
  majorityWins: number;
  /** Share of all money spent that was lost to clashes. */
  lostShare: number;
  /** Difficulty line-ups, when the run included them. */
  lineups?: LineupResult[];
  /** The strongest custom builds against the pack's own leaders, when the run included them. */
  customs?: CustomResult[];
}

const tally = (): Tally => ({ games: 0, wins: 0, fair: 0 });
const add = (t: Record<string, Tally>, key: string, won: boolean, players: number) => {
  const x = (t[key] ??= tally());
  x.games++;
  x.fair += 1 / players;
  if (won) x.wins++;
};

export function summarize(pack: MapPack, matches: { match: ScheduledMatch; record: MatchRecord }[]): Report {
  const total = totalSeats(pack);
  const report: Report = {
    games: matches.length,
    duels: {} as Report["duels"],
    duelMatrix: {},
    duelGames: {},
    field: {} as Report["field"],
    leaders: {},
    seats: {},
    turns: { mean: 0, min: Infinity, max: 0 },
    secondRounds: 0,
    capped: 0,
    winnerSeatShare: 0,
    majorityWins: 0,
    lostShare: 0,
  };
  let spentAll = 0;
  let lostAll = 0;
  for (const { match, record } of matches) {
    const n = record.entrants.length;
    const winner = record.ranking[0]!;
    record.entrants.forEach((e, i) => {
      const won = i === winner;
      add(match.kind === "duel" ? report.duels : report.field, e.strategy, won, n);
      add(report.leaders, e.leaderId, won, n);
      add(report.seats, `${n}p seat ${i + 1}`, won, n);
    });
    if (match.kind === "duel") {
      const [a, b] = record.entrants.map((e) => e.strategy) as [string, string];
      for (const [x, y, i] of [[a, b, 0], [b, a, 1]] as const) {
        (report.duelGames[x] ??= {})[y] = (report.duelGames[x]![y] ?? 0) + 1;
        (report.duelMatrix[x] ??= {})[y] = (report.duelMatrix[x]![y] ?? 0) + (winner === i ? 1 : 0);
      }
    }
    report.turns.mean += record.turns / matches.length;
    report.turns.min = Math.min(report.turns.min, record.turns);
    report.turns.max = Math.max(report.turns.max, record.turns);
    if (record.secondRound) report.secondRounds++;
    if (record.capped) report.capped++;
    const top = record.seats[winner]!;
    report.winnerSeatShare += top / total / matches.length;
    if (top > total / 2) report.majorityWins++;
    spentAll += record.spent.reduce((a, b) => a + b, 0);
    lostAll += record.lost.reduce((a, b) => a + b, 0);
  }
  report.lostShare = spentAll ? lostAll / spentAll : 0;
  return report;
}

export const rate = (t: Tally) => (t.games ? t.wins / t.games : 0);
/** Wins compared with an even share: 1 is exactly fair, 1.5 is half again as many wins as fair. */
export const edge = (t: Tally) => (t.fair ? t.wins / t.fair : 0);
