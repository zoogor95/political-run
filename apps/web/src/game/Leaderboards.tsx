/** Leaderboards: this season's top players by ranked rating on each map, and the leaders who score best. */
import { useEffect, useState } from "react";
import { API_URL, ensureAccount, sessionToken } from "./cloud";
import { candidateName, MAPS, preferredMap, type MapId } from "./model";

interface PlayerRow {
  rank: number;
  name: string;
  rating: number;
  games: number;
  wins: number;
  you: boolean;
}
interface CandidateRow {
  candidate: string;
  games: number;
  wins: number;
  score: number;
  players: number;
}
type Board = { season: string; board: "players"; rows: PlayerRow[] } | { season: string; board: "candidates"; rows: CandidateRow[] };

export function LeaderboardsScreen({ onBack }: { onBack: () => void }) {
  const [mapId, setMapId] = useState<MapId>(preferredMap);
  const [kind, setKind] = useState<"players" | "candidates">("players");
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    void (async () => {
      try {
        await ensureAccount().catch(() => undefined);
        const res = await fetch(`${API_URL}/api/leaderboard?map=${mapId}&board=${kind}`, { headers: sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {} });
        if (!res.ok) throw new Error(String(res.status));
        const board = (await res.json()) as Board;
        if (live) setData(board);
      } catch {
        if (live) setError("Couldn't load the leaderboard. Try again in a moment.");
      }
    })();
    return () => {
      live = false;
    };
  }, [mapId, kind]);
  return (
    <main className="setup online leaderboards" data-testid="leaderboards">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Leaderboards</h1>
        <span className="muted">{data ? `Season ${data.season.replace("-", " ")}` : ""}</span>
      </header>
      <div className="map-pick" role="radiogroup" aria-label="Map">
        {Object.values(MAPS).map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === mapId} className="map-card" onClick={() => setMapId(m.id)} data-testid={`lb-map-${m.id}`}>
            <b>{m.name}</b>
          </button>
        ))}
      </div>
      <div className="kind quick-mode" role="radiogroup" aria-label="Board">
        <button type="button" role="radio" aria-checked={kind === "players"} onClick={() => setKind("players")} data-testid="lb-players">
          Players
        </button>
        <button type="button" role="radio" aria-checked={kind === "candidates"} onClick={() => setKind("candidates")} data-testid="lb-candidates">
          {MAPS[mapId].pack.gameType === "presidential" ? "Candidates" : "Leaders"}
        </button>
      </div>
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      {data && data.rows.length === 0 && <p data-testid="lb-empty">Nobody has played ranked on {MAPS[mapId].name} this season yet. Be the first: Quick match, then Ranked.</p>}
      {data?.board === "players" && data.rows.length > 0 && (
        <table className="list lb-table" data-testid="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Rating</th>
              <th>Won</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.rank} className={r.you ? "you" : ""}>
                <td>{r.rank}</td>
                <td>
                  {r.name}
                  {r.you ? " (you)" : ""}
                </td>
                <td>
                  <b>{r.rating}</b>
                </td>
                <td>
                  {r.wins} of {r.games}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.board === "candidates" && data.rows.length > 0 && (
        <table className="list lb-table" data-testid="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{MAPS[mapId].pack.gameType === "presidential" ? "Candidate" : "Leader"}</th>
              <th>Score</th>
              <th>Won</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={r.candidate}>
                <td>{i + 1}</td>
                <td>{MAPS[mapId].pack.candidates.find((c) => c.id === r.candidate)?.name ?? candidateName(r.candidate)}</td>
                <td>
                  <b>{r.score}</b>
                </td>
                <td>
                  {r.wins} of {r.games}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">Ranked matches only. A leader scores a point for each player they finish above.</p>
    </main>
  );
}
