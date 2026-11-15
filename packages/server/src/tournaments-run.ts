/**
 * Runs the tournaments from a timer (a cron trigger, every 15 minutes): makes each map's cup for the half-year, opens
 * sign-up, starts round one when sign-up closes (or cancels the cup if too few joined), and as tables finish, seats the
 * winners in the next round until a final decides the champion. Safe to run as often as you like: each step checks
 * the database for what is already done.
 */
import type { Env } from "./api.js";
import { notifyAccounts } from "./push.js";
import { createQuickMatch } from "./quick.js";
import { PACKS } from "./room.js";
import { advancing, cupCanBeCreated, cupFor, isFinal, MIN_ENTRANTS, MAX_ENTRANTS, phaseAt, seatTables, TOURNAMENT_TURN_SECONDS } from "./tournament.js";

interface TournamentRow {
  id: string;
  map_pack_id: string;
  starts_at: number;
  status: "scheduled" | "open" | "running" | "finished";
  cancelled: number;
}
interface TableRow {
  round: number;
  table_no: number;
  match_code: string | null;
  match_id: string | null;
  players: string;
  winner_account_id: string | null;
}

export async function runTournaments(env: Env, now = Date.now()): Promise<void> {
  for (const map of Object.keys(PACKS)) {
    try {
      const cup = cupFor(map, now);
      // The first cups can come after their sign-up window has closed (the feature started mid-season): skip those, the next one opens on schedule.
      if (!cupCanBeCreated(cup, now)) continue;
      await env.DB.prepare("INSERT OR IGNORE INTO tournaments (id, name, map_pack_id, rules, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?, 'scheduled')")
        .bind(cup.id, cup.name, map, JSON.stringify({ turnSeconds: TOURNAMENT_TURN_SECONDS, tableSize: 4, opensAt: cup.opensAt }), cup.startsAt, cup.endsBefore)
        .run();
      if (phaseAt(cup, now) !== "scheduled") await env.DB.prepare("UPDATE tournaments SET status = 'open' WHERE id = ? AND status = 'scheduled'").bind(cup.id).run();
    } catch (e) {
      console.error("tournament create", map, e);
    }
  }
  const live = await env.DB.prepare("SELECT id, map_pack_id, starts_at, status, cancelled FROM tournaments WHERE status IN ('open','running')").all<TournamentRow>();
  for (const t of live.results) {
    try {
      if (t.status === "open" && now >= t.starts_at) await startCup(env, t, now);
      else if (t.status === "running") await advance(env, t, now);
    } catch (e) {
      console.error("tournament", t.id, e);
    }
  }
}

const entrantsOf = async (env: Env, id: string) =>
  (await env.DB.prepare("SELECT e.account_id AS id, a.display_name AS name FROM tournament_entries e JOIN accounts a ON a.id = e.account_id WHERE e.tournament_id = ? ORDER BY e.joined_at").bind(id).all<{ id: string; name: string }>()).results;

async function startCup(env: Env, t: TournamentRow, now: number) {
  const entrants = (await entrantsOf(env, t.id)).slice(0, MAX_ENTRANTS);
  if (entrants.length < MIN_ENTRANTS) {
    await env.DB.prepare("UPDATE tournaments SET status = 'finished', cancelled = 1 WHERE id = ?").bind(t.id).run();
    await notifyAccounts(env, entrants.map((e) => e.id), { title: "Majority Map", body: "The cup was cancelled: not enough players signed up. The next one opens soon.", url: env.SITE_URL ?? "", tag: `cup-${t.id}` });
    return;
  }
  await env.DB.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").bind(t.id).run();
  await seatRound(env, t, 1, entrants, now);
}

/** Seats these people in tables for a round, starts each table's match, and tells everyone their table is ready. */
async function seatRound(env: Env, t: TournamentRow, round: number, people: { id: string; name: string }[], now: number) {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const tables = seatTables(people.map((p) => p.id), now % 1_000_000);
  for (const [i, ids] of tables.entries()) {
    const { code, matchId } = await createQuickMatch(env, t.map_pack_id, false, ids.map((id) => ({ accountId: id, name: names.get(id) ?? "Player" })), now, { id: t.id, turnSeconds: TOURNAMENT_TURN_SECONDS });
    await env.DB.prepare("INSERT INTO tournament_tables (tournament_id, round, table_no, match_code, match_id, players) VALUES (?, ?, ?, ?, ?, ?)").bind(t.id, round, i + 1, code, matchId, JSON.stringify(ids)).run();
    const final = isFinal(people.length);
    await notifyAccounts(env, ids, { title: "Majority Map", body: final ? "You're in the final! Your table is ready." : `Round ${round}: your table is ready. Your move!`, url: `${env.SITE_URL ?? ""}/?join=${code}`, tag: `cup-${t.id}` });
  }
}

/** Looks at the current round: records the tables that have finished, and when all have, seats the next round or ends the cup. */
async function advance(env: Env, t: TournamentRow, now: number) {
  const rows = (await env.DB.prepare("SELECT round, table_no, match_code, match_id, players, winner_account_id FROM tournament_tables WHERE tournament_id = ? ORDER BY round, table_no").bind(t.id).all<TableRow>()).results;
  const round = Math.max(0, ...rows.map((r) => r.round));
  const current = rows.filter((r) => r.round === round);
  for (const tr of current.filter((r) => !r.winner_account_id)) {
    const done = await env.DB.prepare("SELECT status FROM matches WHERE id = ?").bind(tr.match_id).first<{ status: string }>();
    if (done?.status !== "finished") continue;
    const seats = (await env.DB.prepare("SELECT account_id, final_rank FROM match_seats WHERE match_id = ? ORDER BY final_rank").bind(tr.match_id).all<{ account_id: string | null; final_rank: number }>()).results;
    const winner = advancing(seats.map((s) => s.account_id).filter((x): x is string => Boolean(x)));
    if (!winner) continue;
    tr.winner_account_id = winner;
    await env.DB.prepare("UPDATE tournament_tables SET winner_account_id = ?, finished_at = ? WHERE tournament_id = ? AND round = ? AND table_no = ?").bind(winner, now, t.id, round, tr.table_no).run();
    // Everyone at the table has played this round: their score is the rounds they've played.
    await env.DB.prepare(`UPDATE tournament_entries SET score = ? WHERE tournament_id = ? AND account_id IN (${(JSON.parse(tr.players) as string[]).map(() => "?").join(",")})`).bind(round, t.id, ...(JSON.parse(tr.players) as string[])).run();
  }
  if (current.length === 0 || current.some((r) => !r.winner_account_id)) return;
  const winners = current.map((r) => r.winner_account_id!);
  if (current.length === 1) {
    // The final: the champion is rank 1, the others by how they finished at the table.
    const order = (await env.DB.prepare("SELECT account_id FROM match_seats WHERE match_id = ? ORDER BY final_rank").bind(current[0]!.match_id).all<{ account_id: string }>()).results.map((r) => r.account_id);
    for (const [i, id] of order.entries()) await env.DB.prepare("UPDATE tournament_entries SET rank = ?, reward_granted_at = ? WHERE tournament_id = ? AND account_id = ?").bind(i + 1, now, t.id, id).run();
    await env.DB.prepare("UPDATE tournaments SET status = 'finished' WHERE id = ?").bind(t.id).run();
    await notifyAccounts(env, [winners[0]!], { title: "Majority Map", body: "You won the cup! Champion.", url: env.SITE_URL ?? "", tag: `cup-${t.id}` });
    return;
  }
  const names = new Map((await entrantsOf(env, t.id)).map((e) => [e.id, e.name]));
  await seatRound(env, t, round + 1, winners.map((id) => ({ id, name: names.get(id) ?? "Player" })), now);
}
