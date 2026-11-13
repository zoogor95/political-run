/**
 * Achievements and the stats behind them, as pure functions of what happened: a resolved turn, or a finished match.
 * The profile (profile.ts) stores the results. Ids are stable so store achievements (Steam, Google Play) can map to them.
 */
import { controllers, majority, totalSeats, type AiLevel, type ElectionResult, type GameState, type MapPack, type TurnEvent } from "@majority-map/core";

export interface Achievement {
  id: string;
  name: string;
  /** How to earn it, shown while it's locked too. */
  about: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-steps", name: "First steps", about: "Finish Learn to play." },
  { id: "first-win", name: "Elected", about: "Win a match: most seats on election night." },
  { id: "majority", name: "Majority rules", about: "Win with an outright majority." },
  { id: "landslide", name: "Landslide", about: "Win 60% of the seats." },
  { id: "coalition", name: "Coalition builder", about: "Win a hung parliament: most seats, no majority." },
  { id: "photo-finish", name: "Photo finish", about: "Win by 10 seats or fewer." },
  { id: "second-round", name: "Dead heat", about: "Win a match that went to a second round." },
  { id: "beat-hard", name: "Giant killer", about: "Win against a Hard computer party." },
  { id: "full-house", name: "Full house", about: "Win against four computer parties at once." },
  { id: "pass-the-phone", name: "Pass the phone", about: "Finish a pass-and-play match." },
  { id: "two-maps", name: "Well travelled", about: "Win on the United Kingdom and on Pakistan." },
  { id: "reserved", name: "Seats on reserve", about: "On Pakistan, win the most reserved seats." },
  { id: "locked-in", name: "Locked in", about: "Fill a region's meter to lock it for good." },
  { id: "voter-group", name: "Friends in high places", about: "Win control of a voter group." },
  { id: "four-groups", name: "Regional powerhouse", about: "Hold four region groups at once." },
  { id: "clean-campaign", name: "Clean campaign", about: "Win without a single clash." },
  { id: "own-candidate", name: "Self-made", about: "Lead a party with a candidate you created." },
  { id: "veteran", name: "Campaign veteran", about: "Finish 10 matches." },
];

export interface Stats {
  matches: number;
  wins: number;
  majorities: number;
  /** Matches finished and won, by map id. */
  maps: Record<string, { played: number; won: number }>;
  /** Wins against computer parties, by the hardest level in the match. */
  winsVs: Partial<Record<AiLevel, number>>;
  passAndPlay: number;
  /** Largest share of the seats in a win, 0 to 1. */
  bestShare: number;
  regionsLocked: number;
  groupsWon: number;
  clashes: number;
  turns: number;
}

export const EMPTY_STATS: Stats = { matches: 0, wins: 0, majorities: 0, maps: {}, winsVs: {}, passAndPlay: 0, bestShare: 0, regionsLocked: 0, groupsWon: 0, clashes: 0, turns: 0 };

/** Who is playing on this device, and against what. */
export interface Table {
  pack: MapPack;
  /** The people's parties: the solo player, or everyone in pass and play. */
  humans: string[];
  /** Computer parties' levels. */
  ai: AiLevel[];
  passAndPlay: boolean;
  /** A person leads a party with a custom candidate. */
  ownCandidate: boolean;
}

export interface Outcome {
  stats: Stats;
  earned: string[];
}

const LEVELS: AiLevel[] = ["easy", "normal", "hard"];

/** A resolved turn: counts for the stats, and the achievements it earns. */
export function afterTurn(t: Table, after: GameState, events: TurnEvent[], stats: Stats): Outcome {
  const mine = (id: string) => t.humans.includes(id);
  const s: Stats = { ...stats, turns: stats.turns + 1 };
  const earned: string[] = [];
  for (const e of events) {
    if (e.type === "locked" && mine(e.playerId)) {
      s.regionsLocked++;
      earned.push("locked-in");
    }
    if (e.type === "control_gained" && mine(e.playerId)) {
      s.groupsWon++;
      if (t.pack.groups.find((g) => g.id === e.groupId)?.kind === "national") earned.push("voter-group");
    }
    if (e.type === "conflict" && e.playerIds.some(mine)) s.clashes++;
  }
  const ctrl = controllers(t.pack, after);
  for (const h of t.humans) {
    const held = t.pack.groups.filter((g) => g.kind === "state" && ctrl[g.id] === h).length;
    if (held >= 4) earned.push("four-groups");
  }
  if (t.ownCandidate) earned.push("own-candidate");
  return { stats: s, earned: [...new Set(earned)] };
}

/**
 * A finished match (after any second round). `clashed` says whether a person's party clashed at any point in the
 * match; `secondRound` whether it went to one.
 */
export function afterMatch(t: Table, result: ElectionResult, stats: Stats, opts: { clashed: boolean; secondRound: boolean }): Outcome {
  const winner = result.ranking[0]!;
  const won = t.humans.includes(winner);
  const seats = result.seats[winner] ?? 0;
  const total = totalSeats(t.pack);
  const runnerUp = result.seats[result.ranking[1]!] ?? 0;
  const s: Stats = { ...stats, maps: { ...stats.maps }, winsVs: { ...stats.winsVs } };
  s.matches++;
  const map = s.maps[t.pack.id] ?? { played: 0, won: 0 };
  s.maps[t.pack.id] = { played: map.played + 1, won: map.won + (won ? 1 : 0) };
  if (t.passAndPlay) s.passAndPlay++;
  const earned: string[] = [];
  if (t.passAndPlay) earned.push("pass-the-phone");
  if (s.matches >= 10) earned.push("veteran");
  if (won) {
    s.wins++;
    s.bestShare = Math.max(s.bestShare, seats / total);
    const hardest = [...t.ai].sort((a, b) => LEVELS.indexOf(b) - LEVELS.indexOf(a))[0];
    if (hardest) s.winsVs[hardest] = (s.winsVs[hardest] ?? 0) + 1;
    earned.push("first-win");
    if (seats >= majority(t.pack)) {
      s.majorities++;
      earned.push("majority");
    } else earned.push("coalition");
    if (seats >= 0.6 * total) earned.push("landslide");
    if (seats - runnerUp <= 10) earned.push("photo-finish");
    if (opts.secondRound) earned.push("second-round");
    if (t.ai.includes("hard")) earned.push("beat-hard");
    if (t.ai.length >= 4) earned.push("full-house");
    if (!opts.clashed) earned.push("clean-campaign");
    if ((s.maps.uk?.won ?? 0) > 0 && (s.maps.pk?.won ?? 0) > 0) earned.push("two-maps");
  }
  // Most reserved seats: a person's party takes more of them than any other.
  if (Object.keys(result.reserved).length > 0) {
    const reserved = (id: string) => Object.values(result.reserved).reduce((a, set) => a + (set[id] ?? 0), 0);
    const best = Object.keys(result.seats).sort((a, b) => reserved(b) - reserved(a));
    if (best[0] && t.humans.includes(best[0]) && reserved(best[0]) > reserved(best[1] ?? "")) earned.push("reserved");
  }
  return { stats: s, earned };
}
