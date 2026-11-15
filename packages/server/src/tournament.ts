/**
 * Tournaments (M4.5): one cup per map, twice a year (the Winter Cup opens on 1 January, the Summer Cup on 1 July), all
 * running at once. Free entry, a fixed setup (24 hours a turn). Entrants play in tables of up to four and the winner of
 * each table goes through, round after round, until one final table decides the champion. This file is the schedule and
 * the bracket; tournaments-run.ts drives them from a timer.
 */
import { nextRandom, seedRng } from "@majority-map/core";

export const SIGNUP_DAYS = 14;
export const MIN_ENTRANTS = 4;
export const MAX_ENTRANTS = 256;
export const TABLE_SIZE = 4;
/** Turn time in a tournament: a day, so a round takes about three weeks. */
export const TOURNAMENT_TURN_SECONDS = 86_400;
const DAY = 86_400_000;

export interface Cup {
  /** "uk-2027-summer". */
  id: string;
  name: string;
  map: string;
  /** Sign-up opens, then closes and round one starts SIGNUP_DAYS later. */
  opensAt: number;
  startsAt: number;
  /** The cup after this one opens: the whole tournament must be over by then. */
  endsBefore: number;
}

const MAP_NAME: Record<string, string> = { uk: "UK", pk: "Pakistan", us: "US" };

/** The cup a map has in a given half-year, from the moment: Winter (Jan to Jun) or Summer (Jul to Dec). */
export function cupFor(map: string, now: number): Cup {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const summer = d.getUTCMonth() >= 6;
  const opensAt = Date.UTC(year, summer ? 6 : 0, 1);
  const endsBefore = Date.UTC(summer ? year + 1 : year, summer ? 0 : 6, 1);
  const season = summer ? "summer" : "winter";
  return { id: `${map}-${year}-${season}`, name: `${MAP_NAME[map] ?? map} ${season === "summer" ? "Summer" : "Winter"} Cup ${year}`, map, opensAt, startsAt: opensAt + SIGNUP_DAYS * DAY, endsBefore };
}

/** Where a cup is in its life, by the clock alone: not yet open, taking sign-ups, or started. */
/** A cup is only made while people can still sign up for it: one whose window has already closed would just be cancelled. */
export const cupCanBeCreated = (cup: Cup, now: number): boolean => phaseAt(cup, now) !== "started";

export const phaseAt = (cup: Cup, now: number): "scheduled" | "open" | "started" => (now < cup.opensAt ? "scheduled" : now < cup.startsAt ? "open" : "started");

/**
 * Seats entrants into tables for a round: as few tables as hold them (four at most), sizes as even as can be (never
 * fewer than two at a table), and the order drawn by the seed. Returns each table's account ids.
 */
export function seatTables(entrants: string[], seed: number): string[][] {
  let r = seedRng(seed);
  const order = [...entrants];
  for (let i = order.length - 1; i > 0; i--) {
    const [v, next] = nextRandom(r);
    r = next;
    const j = Math.floor(v * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const n = Math.ceil(order.length / TABLE_SIZE);
  const tables: string[][] = Array.from({ length: n }, () => []);
  order.forEach((id, i) => tables[i % n]!.push(id));
  return tables;
}

/** Whether this round is the final: one table decides it. */
export const isFinal = (entrants: number) => entrants <= TABLE_SIZE;

/** Rounds a field of this size needs, final included. */
export function roundsFor(entrants: number): number {
  let n = entrants;
  let rounds = 1;
  while (n > TABLE_SIZE) {
    n = Math.ceil(n / TABLE_SIZE);
    rounds++;
  }
  return rounds;
}

/** Who goes through from a finished table: the player who finished first. `ranking` lists the table's people best first. */
export const advancing = (ranking: string[]): string | null => ranking[0] ?? null;
