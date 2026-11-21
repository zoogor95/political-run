/** Leaderboards: this season's top players by ranked rating on each map, and the leaders who score best. */
import { useEffect, useState } from "react";
import { API_URL, ensureAccount, sessionToken } from "./cloud";
import { countryName, HOME_COUNTRIES, myRatings } from "./quick";
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
interface Standing {
  rank: number;
  of: number;
  rating: number;
  games: number;
  wins: number;
}
type Board = { season: string; board: "players"; rows: PlayerRow[]; standing?: Standing | null; minGames?: number; provisional?: { games: number } | null } | { season: string; board: "candidates"; rows: CandidateRow[] };

export function LeaderboardsScreen({ onBack }: { onBack: () => void }) {
  const [mapId, setMapId] = useState<MapId>(preferredMap);
  const [kind, setKind] = useState<"players" | "candidates">("players");
  const [scope, setScope] = useState<"world" | "country" | "region">("world");
  const [region, setRegion] = useState("");
  const [find, setFind] = useState("");
  const [home, setHome] = useState<{ country: string | null; region: string | null }>({ country: null, region: null });
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sessionToken()) return;
    myRatings()
      .then((r) => setHome(r.home ?? { country: null, region: null }))
      .catch(() => undefined);
  }, []);
  // A region belongs to one map: changing maps drops it (a region board falls back to the whole country).
  useEffect(() => setRegion(""), [mapId]);
  const homeOnThisMap = HOME_COUNTRIES.find((c) => c.code === home.country)?.map === mapId;
  // The region board is for the map's own country: your home region first, or any other one picked.
  const regionId = scope === "region" ? region || (homeOnThisMap ? (home.region ?? "") : "") : "";
  const query = kind === "players" ? (scope === "country" && home.country ? `&country=${home.country}` : scope === "region" && regionId ? `&region=${regionId}` : "") : "";
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    void (async () => {
      try {
        await ensureAccount().catch(() => undefined);
        const res = await fetch(`${API_URL}/api/leaderboard?map=${mapId}&board=${kind}${query}`, { headers: sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {} });
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
  }, [mapId, kind, query]);
  const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  const mapFlag = (m: MapId) => flag(HOME_COUNTRIES.find((c) => c.map === m)?.code ?? "UN");
  const hue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const Avatar = ({ name }: { name: string }) => (
    <span className="lb-avatar" style={{ background: `hsl(${hue(name)} 55% 48%)` }} aria-hidden="true">
      {name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase()}
    </span>
  );
  const players = data?.board === "players" ? data : null;
  const shown = players ? players.rows.filter((r) => r.name.toLowerCase().includes(find.trim().toLowerCase())) : [];
  const podium = players && !find.trim() ? players.rows.slice(0, 3) : [];
  const medals = ["🥇", "🥈", "🥉"];
  const youListed = players?.rows.some((r) => r.you) ?? false;
  return (
    <main className="setup online leaderboards" data-testid="leaderboards">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Leaderboards</h1>
        <span className="muted">{data ? `Season ${data.season.replace("-", " ")}` : ""}</span>
      </header>
      <div className="lb-layout">
        <div className="lb-main">
          <div className="lb-controls">
            <div className="kind quick-mode" role="radiogroup" aria-label="Board">
              <button type="button" role="radio" aria-checked={kind === "players"} onClick={() => setKind("players")} data-testid="lb-players">
                Players
              </button>
              <button type="button" role="radio" aria-checked={kind === "candidates"} onClick={() => setKind("candidates")} data-testid="lb-candidates">
                {MAPS[mapId].pack.gameType === "presidential" ? "Candidates" : "Leaders"}
              </button>
            </div>
            {kind === "players" && (
              <>
                <div className="kind quick-mode" role="radiogroup" aria-label="Whose ranking">
                  <button type="button" role="radio" aria-checked={scope === "world"} onClick={() => setScope("world")} data-testid="lb-scope-world">
                    Worldwide
                  </button>
                  <button type="button" role="radio" aria-checked={scope === "country"} disabled={!home.country} onClick={() => setScope("country")} data-testid="lb-scope-country">
                    {home.country ? `${flag(home.country)} ${countryName(home.country)}` : "Your country"}
                  </button>
                  <button type="button" role="radio" aria-checked={scope === "region"} onClick={() => setScope("region")} data-testid="lb-scope-region">
                    Region
                  </button>
                </div>
                {scope === "region" && (
                  <select aria-label="Region" value={regionId} onChange={(e) => setRegion(e.target.value)} data-testid="lb-region">
                    <option value="">Pick a region of {MAPS[mapId].name}</option>
                    {MAPS[mapId].pack.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {homeOnThisMap && home.region === r.id ? " (your region)" : ""}
                      </option>
                    ))}
                  </select>
                )}
                <input className="lb-find" type="search" placeholder="Find a player" aria-label="Find a player" value={find} onChange={(e) => setFind(e.target.value)} data-testid="lb-find" />
              </>
            )}
          </div>
          {kind === "players" && !home.country && (
            <p className="small muted" data-testid="lb-home-hint">
              Set where you live on your profile to see your ranking among players in your country.
            </p>
          )}
          {error && (
            <p className="backup-error" role="alert">
              {error}
            </p>
          )}
          {players?.standing && (
            <p className="lb-standing" data-testid="lb-standing">
              You are <b>#{players.standing.rank}</b> of {players.standing.of} here · rating {players.standing.rating}
            </p>
          )}
          {players?.provisional && (
            <p className="lb-standing" data-testid="lb-provisional">
              Play {players.minGames ?? 10} ranked games on {MAPS[mapId].name} to be ranked. You have played {players.provisional.games}.
            </p>
          )}
          {data && data.rows.length === 0 && <p data-testid="lb-empty">{kind === "players" && scope === "country" && home.country ? `Nobody from ${countryName(home.country)} has played ten ranked games on ${MAPS[mapId].name} this season yet. Be the first: Quick match, then Ranked.` : kind === "players" && regionId ? `Nobody from ${MAPS[mapId].pack.regions.find((r) => r.id === regionId)?.name ?? "that region"} has played ten ranked games on ${MAPS[mapId].name} this season yet. Set your home region on your profile to appear here.` : `Nobody has played ten ranked games on ${MAPS[mapId].name} this season yet. Be the first: Quick match, then Ranked.`}</p>}
          {podium.length > 0 && (
            <ol className="lb-podium" data-testid="lb-podium">
              {podium.map((r, i) => (
                <li key={r.rank} className={r.you ? "you" : ""}>
                  <Avatar name={r.name} />
                  <span>
                    <b>
                      {medals[i]} {r.name}
                      {r.you ? " (you)" : ""}
                    </b>
                    <small>
                      {r.rating} · {r.games ? Math.round((100 * r.wins) / r.games) : 0}% won
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {players && shown.length > 0 && (
            <table className="list lb-table" data-testid="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Rating</th>
                  <th>Games</th>
                  <th>Win rate</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.rank} className={r.you ? "you" : ""}>
                    <td>{r.rank}</td>
                    <td className="lb-name">
                      <Avatar name={r.name} />
                      {r.name}
                      {r.you ? " (you)" : ""}
                    </td>
                    <td>
                      <b>{r.rating}</b>
                    </td>
                    <td>{r.games}</td>
                    <td>{r.games ? Math.round((100 * r.wins) / r.games) : 0}%</td>
                  </tr>
                ))}
                {players.standing && !youListed && !find.trim() && (
                  <tr className="you pinned" data-testid="lb-you-row">
                    <td>{players.standing.rank}</td>
                    <td className="lb-name">You</td>
                    <td>
                      <b>{players.standing.rating}</b>
                    </td>
                    <td>{players.standing.games}</td>
                    <td>{players.standing.games ? Math.round((100 * players.standing.wins) / players.standing.games) : 0}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {players && players.rows.length > 0 && shown.length === 0 && <p data-testid="lb-no-match">No player here matches "{find}".</p>}
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
          <p className="small muted">Ranked matches only. Players are ranked after 10 ranked games on the map. A leader scores a point for each player they finish above.</p>
        </div>
        <div className="lb-maps" role="radiogroup" aria-label="Map">
          <span className="lb-maps-title">Map</span>
          {Object.values(MAPS).map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === mapId} className="lb-map" onClick={() => setMapId(m.id)} data-testid={`lb-map-${m.id}`}>
              <span aria-hidden="true">{mapFlag(m.id)}</span>
              <b>{m.name}</b>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
