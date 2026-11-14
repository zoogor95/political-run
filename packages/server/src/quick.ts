/** Quick matches: starting one for the people matchmaking found, and moving ratings when a ranked one ends. */
import type { ElectionResult } from "@majority-map/core";
import { inviteCode, type Env } from "./api.js";
import { uuidv7 } from "./crypto.js";
import { ratingChanges, seasonOf, START_RATING } from "./ratings.js";
import { PACKS, quickSetup, type QuickPlayer, type RoomData } from "./room.js";

/** Starts a quick match for these people (2 to 4) and returns its invite code: the match row, then its room. */
export async function createQuickMatch(env: Env, map: string, ranked: boolean, people: { accountId: string; name: string }[], now = Date.now()): Promise<string> {
  if (!env.MATCHES) throw new Error("Online matches aren't available here");
  // Their saved parties (Create your party), where they've backed one up.
  const saved = await env.DB.prepare(`SELECT account_id, name, color, emblem FROM party_profiles WHERE account_id IN (${people.map(() => "?").join(",")})`)
    .bind(...people.map((p) => p.accountId))
    .all<{ account_id: string; name: string; color: string; emblem: string }>();
  const players: QuickPlayer[] = people.map((p) => {
    const party = saved.results.find((r) => r.account_id === p.accountId);
    return { ...p, party: party ? { name: party.name, color: party.color, emblem: party.emblem } : null };
  });
  const seed = Math.floor(Math.random() * 1_000_000);
  const setup = quickSetup(map, players, ranked, seed);
  const matchId = uuidv7(now);
  let code = "";
  for (let tries = 0; tries < 5 && !code; tries++) {
    const candidate = inviteCode();
    try {
      await env.DB.prepare(
        "INSERT INTO matches (id, mode, game_type, map_pack_id, content_version, engine_version, seed, status, turn_timer_seconds, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, '1', '1', ?, 'lobby', ?, ?, ?, ?)",
      )
        .bind(matchId, ranked ? "ranked" : "quick", PACKS[map]!.gameType, map, seed, setup.turnSeconds, candidate, people[0]!.accountId, now)
        .run();
      code = candidate;
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
  if (!code) throw new Error("Couldn't make an invite code");
  const res = await env.MATCHES.get(env.MATCHES.idFromName(code)).fetch("https://room/create-quick", { method: "POST", body: JSON.stringify({ code, matchId, setup, players, seed }) });
  if (!res.ok) throw new Error(`room ${res.status}`);
  return code;
}

/**
 * A ranked match has ended: each person's rating on this map for this season moves by their placing against the
 * others (computer seats don't count; anyone who resigned keeps the place the computer finished in), and their
 * leader's season stats go up. Returns the changes by seat.
 */
export async function recordRanked(env: Env, room: RoomData, result: ElectionResult, now = Date.now()): Promise<Record<string, number>> {
  const season = seasonOf(now);
  const map = room.setup.map;
  const people = room.seats.filter((s) => s.kind === "human" && s.accountId);
  const ranking = result.ranking.filter((id) => people.some((s) => s.id === id));
  const rows = await env.DB.prepare(`SELECT account_id, rating FROM ratings WHERE season_id = ? AND map_pack_id = ? AND account_id IN (${people.map(() => "?").join(",")})`)
    .bind(season.id, map, ...people.map((s) => s.accountId!))
    .all<{ account_id: string; rating: number }>();
  const before = Object.fromEntries(people.map((s) => [s.id, rows.results.find((r) => r.account_id === s.accountId)?.rating ?? START_RATING]));
  const changes = ratingChanges(ranking, before);
  const writes = [env.DB.prepare("INSERT OR IGNORE INTO seasons (id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)").bind(season.id, season.name, season.startsAt, season.endsAt)];
  for (const s of people) {
    const won = ranking[0] === s.id ? 1 : 0;
    const place = ranking.indexOf(s.id);
    writes.push(
      env.DB.prepare(
        "INSERT INTO ratings (account_id, season_id, map_pack_id, rating, games, wins, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(account_id, season_id, map_pack_id) DO UPDATE SET rating = excluded.rating, games = games + 1, wins = wins + excluded.wins, updated_at = excluded.updated_at",
      ).bind(s.accountId!, season.id, map, before[s.id]! + (changes[s.id] ?? 0), won, now),
      // A leader's season score: a point for each person finished above.
      env.DB.prepare(
        "INSERT INTO candidate_stats (account_id, season_id, map_pack_id, candidate_ref, games, wins, score) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(account_id, season_id, map_pack_id, candidate_ref) DO UPDATE SET games = games + 1, wins = wins + excluded.wins, score = score + excluded.score",
      ).bind(s.accountId!, season.id, map, s.leaderId, won, ranking.length - 1 - place),
      env.DB.prepare("UPDATE match_seats SET rating_change = ? WHERE match_id = ? AND seat = ?").bind(changes[s.id] ?? 0, room.matchId, room.seats.indexOf(s)),
    );
  }
  await env.DB.batch(writes);
  return changes;
}
