/**
 * Ranked play: seasons and ratings. A season is a calendar quarter. Ratings start at 1000 and move by a multi-player
 * Elo: every pair of people in a ranked match is scored as a duel won by whoever finished higher, and each person's
 * change is the average of their duels, scaled so a two-player match moves by up to K points.
 */
export const START_RATING = 1000;
export const K = 32;

export interface Season {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
}

/** The season a moment falls in: "2026-Q4", from the first of October to the end of December (UTC). */
export function seasonOf(now: number): Season {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  return { id: `${year}-Q${q + 1}`, name: `Season ${year} Q${q + 1}`, startsAt: Date.UTC(year, q * 3, 1), endsAt: Date.UTC(year, q * 3 + 3, 1) };
}

/** The chance a player rated `a` beats one rated `b`. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Rating changes for a ranked match. `ranking` lists the people from first place to last; `ratings` holds their ratings
 * before the match (missing means new, at 1000). Returns whole-point changes.
 */
export function ratingChanges(ranking: string[], ratings: Record<string, number>, k = K): Record<string, number> {
  const n = ranking.length;
  const out: Record<string, number> = {};
  if (n < 2) return Object.fromEntries(ranking.map((id) => [id, 0]));
  for (let i = 0; i < n; i++) {
    const me = ranking[i]!;
    const r = ratings[me] ?? START_RATING;
    let delta = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const won = i < j ? 1 : 0;
      delta += won - expected(r, ratings[ranking[j]!] ?? START_RATING);
    }
    out[me] = Math.round((k * delta) / (n - 1));
  }
  return out;
}

/** Ranked games a player needs on a map in a season before they appear on its leaderboards. */
export const MIN_RANKED_GAMES = 10;
