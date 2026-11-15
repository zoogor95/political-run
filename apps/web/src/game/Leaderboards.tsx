/** Leaderboards: this season's top players by ranked rating on each map, and the leaders who score best. */
import { useEffect, useState } from "react";
import { API_URL, ensureAccount, sessionToken } from "./cloud";
import { HOME_COUNTRIES, myRatings } from "./quick";
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
  const [region, setRegion] = useState("");
  const [home, setHome] = useState<{ country: string | null; region: string | null }>({ country: null, region: null });
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sessionToken()) return;
    myRatings()
      .then((r) => setHome(r.home ?? { country: null, region: null }))
      .catch(() => undefined);
  }, []);
  // A region belongs to one map: changing maps goes back to everywhere.
  useEffect(() => setRegion(""), [mapId]);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    void (async () => {
      try {
        await ensureAccount().catch(() => undefined);
        const res = await fetch(`${API_URL}/api/leaderboard?map=${mapId}&board=${kind}${kind === "players" && region ? `&region=${region}` : ""}`, { headers: sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {} });
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
  }, [mapId, kind, region]);
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
      {kind === "players" && (
        <label className="find">
          <span>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} data-testid="lb-region">
            <option value="">Everywhere</option>
            {MAPS[mapId].pack.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {home.region === r.id && HOME_COUNTRIES.find((c) => c.code === home.country)?.map === mapId ? " (your region)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      {data && data.rows.length === 0 && <p data-testid="lb-empty">{region && kind === "players" ? `Nobody from ${MAPS[mapId].pack.regions.find((r) => r.id === region)?.name ?? "that region"} has played ranked on ${MAPS[mapId].name} this season yet. Set your home region on your profile to appear here.` : `Nobody has played ranked on ${MAPS[mapId].name} this season yet. Be the first: Quick match, then Ranked.`}</p>}
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
