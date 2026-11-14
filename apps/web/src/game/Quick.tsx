/**
 * Quick match: pick a map and casual or ranked, then search. Only real people are matched (never computers): two to
 * four players, five minutes a turn, leaders drawn at random. Ranked matches move your rating for the map this season.
 */
import { useEffect, useState } from "react";
import { MAPS, mapDetail, preferredMap, type MapId } from "./model";
import { NotifyButton, timeLeft } from "./Online";
import { myRatings, QuickSearch, type SearchState } from "./quick";

export function QuickMatchScreen({ onBack, onMatched }: { onBack: () => void; onMatched: (code: string) => void }) {
  const [mapId, setMapId] = useState<MapId>(preferredMap);
  const [ranked, setRanked] = useState(false);
  const [search, setSearch] = useState<QuickSearch | null>(null);
  const [state, setState] = useState<SearchState | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [ratings, setRatings] = useState<Awaited<ReturnType<typeof myRatings>> | null>(null);

  useEffect(() => {
    let live = true;
    myRatings()
      .then((r) => live && setRatings(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!search) return;
    const off = search.onChange(setState);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [search]);
  useEffect(() => {
    if (state?.status === "matched") onMatched(state.code);
  }, [state, onMatched]);
  // Leaving the screen stops the search.
  useEffect(() => () => search?.cancel(), [search]);

  const find = () => {
    const s = new QuickSearch(mapId, ranked);
    setStarted(Date.now());
    setNow(Date.now());
    setState(s.state);
    setSearch(s);
  };
  const cancel = () => {
    search?.cancel();
    setSearch(null);
    setState(null);
  };
  const mine = ratings?.ratings.find((r) => r.map === mapId);
  const searching = search !== null && state?.status !== "error";
  return (
    <main className="setup online quick" data-testid="quick-match">
      <header className="setup-head">
        <button type="button" onClick={searching ? cancel : onBack}>
          {searching ? "Cancel" : "Back"}
        </button>
        <h1>Quick match</h1>
      </header>
      <p className="small">Play real people online: two to four players, five minutes a turn. Leaders are drawn at random. You're only matched with people, never computers.</p>

      <section className="backup">
        <h2 id="quick-map">Map</h2>
        <div className="map-pick" role="radiogroup" aria-labelledby="quick-map">
          {Object.values(MAPS).map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === mapId} className="map-card" disabled={searching} onClick={() => setMapId(m.id)} data-testid={`quick-map-${m.id}`}>
              <b>{m.name}</b>
              <small>{mapDetail(m)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="backup">
        <h2 id="quick-mode">Casual or ranked</h2>
        <div className="kind quick-mode" role="radiogroup" aria-labelledby="quick-mode">
          <button type="button" role="radio" aria-checked={!ranked} disabled={searching} onClick={() => setRanked(false)} data-testid="quick-casual">
            Casual
          </button>
          <button type="button" role="radio" aria-checked={ranked} disabled={searching} onClick={() => setRanked(true)} data-testid="quick-ranked">
            Ranked
          </button>
        </div>
        <p className="small" data-testid="quick-rating">
          {ranked
            ? `Ranked matches move your rating on this map for ${ratings?.season.name ?? "this season"}. Yours: ${mine ? `${mine.rating} (${mine.games} played, ${mine.wins} won)` : "1000, until your first ranked match"}.`
            : "Casual matches don't change your rating."}
        </p>
      </section>

      {!searching ? (
        <div className="backup-actions">
          <button type="button" className="primary" onClick={find} data-testid="quick-find">
            Find a {ranked ? "ranked" : "casual"} match
          </button>
        </div>
      ) : (
        <section className="backup quick-searching" data-testid="quick-searching" role="status">
          <h2>
            <span className="quick-spinner" aria-hidden="true" /> {state?.status === "connecting" ? "Connecting…" : "Searching for players…"}
          </h2>
          <p>
            {timeLeft(now - started)} ·{" "}
            {state?.status === "searching"
              ? state.waiting > 1
                ? `${state.waiting} people found. Starting in a moment, in case more join.`
                : `You're the only one looking for a ${ranked ? "ranked" : "casual"} ${MAPS[mapId].name} match right now. Keep this open, or turn on notifications and we'll tell you.`
              : ""}
          </p>
          <div className="backup-actions">
            <NotifyButton />
            <button type="button" onClick={cancel} data-testid="quick-cancel">
              Stop searching
            </button>
          </div>
        </section>
      )}
      {state?.status === "error" && (
        <p className="backup-error" role="alert" data-testid="quick-error">
          {state.message}
        </p>
      )}
    </main>
  );
}
