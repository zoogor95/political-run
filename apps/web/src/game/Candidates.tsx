/**
 * Choose your candidate (or leader), after the design's Candidate select artboard: search, a party filter, sorting and
 * favourites over a grid of candidate cards, with the chosen one's strengths and weaknesses in a side panel.
 */
import { useMemo, useState } from "react";
import type { CandidateDef, CustomCandidate } from "@majority-map/core";
import { map } from "./model";
import { Portrait, toAvatar } from "./Portrait";
import { PRODUCTS } from "./store";
import { isPresidential, type MatchConfig, type Seat } from "./setup";

const FAV_KEY = "mm.favCandidates";
type Sort = "bonus" | "name" | "party";

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveFavs(f: Set<string>) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...f]));
  } catch {
    // Favourites are a convenience; without storage they last until the page closes.
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("") || name.slice(0, 1).toUpperCase();

/** One entry in the grid: a roster candidate or one of yours. */
interface Entry {
  id: string;
  name: string;
  affiliation: string;
  modifiers: Record<string, number>;
  notes: Record<string, string>;
  custom?: CustomCandidate;
}

const groupName = (id: string) => map.pack.groups.find((g) => g.id === id)?.name ?? id;
const pct = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)}%`;
const best = (e: Entry) => Math.max(0, ...Object.values(e.modifiers));

export function CandidatePicker({
  seat,
  config,
  customs,
  owned,
  onPick,
  onCreate,
  onClose,
}: {
  seat: Seat;
  config: MatchConfig;
  customs: CustomCandidate[];
  owned: boolean;
  onPick: (leaderId: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const presidential = isPresidential();
  const word = presidential ? "candidate" : "leader";
  const human = seat.kind === "human";
  const takenBy = new Map(config.seats.filter((s) => s.id !== seat.id).map((s) => [s.leaderId, s.party.name || s.label]));
  const entries: Entry[] = useMemo(
    () => [
      ...(human ? customs.map((c) => ({ id: c.id, name: c.name, affiliation: "Your candidate", modifiers: c.modifiers, notes: {}, custom: c })) : []),
      ...map.pack.candidates.map((c: CandidateDef) => ({ id: c.id, name: c.name, affiliation: c.affiliation, modifiers: c.modifiers, notes: c.notes ?? {} })),
    ],
    [customs, human],
  );
  const parties = [...new Set(map.pack.candidates.map((c) => c.affiliation))];
  const [query, setQuery] = useState("");
  const [party, setParty] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("bonus");
  const [favOnly, setFavOnly] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [chosen, setChosen] = useState(seat.leaderId);

  const q = query.trim().toLowerCase();
  const shown = entries
    .filter((e) => !party || e.affiliation === party)
    .filter((e) => !favOnly || favs.has(e.id))
    .filter((e) => !q || e.name.toLowerCase().includes(q) || e.affiliation.toLowerCase().includes(q) || Object.keys(e.modifiers).some((g) => groupName(g).toLowerCase().includes(q)))
    // Candidates another seat has go last; they're shown so you know, but can't be chosen.
    .sort((a, b) =>
      Number(takenBy.has(a.id)) - Number(takenBy.has(b.id)) ||
      (sort === "name" ? a.name.localeCompare(b.name) : sort === "party" ? a.affiliation.localeCompare(b.affiliation) || a.name.localeCompare(b.name) : best(b) - best(a) || a.name.localeCompare(b.name)),
    );
  const pick = entries.find((e) => e.id === chosen) ?? entries[0]!;
  const toggleFav = (id: string) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveFavs(next);
    setFavs(next);
  };
  const strengths = Object.entries(pick.modifiers)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const weaknesses = Object.entries(pick.modifiers)
    .filter(([, n]) => n < 0)
    .sort((a, b) => a[1] - b[1]);
  const pickTaken = takenBy.get(pick.id);

  return (
    <div className="overlay cand-overlay" role="dialog" aria-modal="true" aria-labelledby="cand-title" data-testid="candidate-picker">
      <div className="cand-screen">
        <header className="cand-top">
          <button type="button" className="back" onClick={onClose} data-testid="picker-back">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back
          </button>
          <h2 id="cand-title">Choose your {word}</h2>
          <span className="cand-top-space" />
        </header>

        <div className="cand-tools">
          <label className="cand-search">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5L20 20" />
            </svg>
            <span className="sr-only">Search {word}s</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${word}s or groups`} data-testid="picker-search" />
          </label>
          <div className="cand-parties" role="group" aria-label="Party">
            <button type="button" aria-pressed={party === null} onClick={() => setParty(null)}>
              All
            </button>
            {parties.map((p) => (
              <button key={p} type="button" aria-pressed={party === p} onClick={() => setParty(party === p ? null : p)}>
                {p}
              </button>
            ))}
          </div>
          <label className="cand-sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} data-testid="picker-sort">
              <option value="bonus">Strongest bonus</option>
              <option value="name">Name</option>
              <option value="party">Party</option>
            </select>
          </label>
          <label className="cand-fav-only">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
            Favorites only
          </label>
        </div>

        <div className="cand-body">
          <div className="cand-grid" data-testid="picker-grid">
            {human && (
              <button type="button" className="cand-create" onClick={onCreate} data-testid="picker-create">
                <svg width="56" height="56" viewBox="0 0 52 52" aria-hidden="true">
                  <circle cx="26" cy="26" r="23" fill="#ffd34d" stroke="#2b2440" strokeWidth="3" />
                  <path d="M26 15v22M15 26h22" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" />
                </svg>
                <b>Create your own</b>
                <span>Build an avatar and spend a points budget on bonuses</span>
                {!owned && (
                  <span className="cand-lock">
                    <LockIcon /> One-time unlock · {PRODUCTS["candidate-creator"].price}
                  </span>
                )}
              </button>
            )}
            {shown.map((e) => {
              const by = takenBy.get(e.id);
              const chips = Object.entries(e.modifiers)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
              return (
                <div key={e.id} className={`cand-card${chosen === e.id ? " on" : ""}${by ? " taken" : ""}`}>
                  <button type="button" className="cand-pick" aria-pressed={chosen === e.id} onClick={() => setChosen(e.id)} data-testid={`cand-${e.id}`}>
                    <span className="cand-face" style={{ opacity: by ? 0.55 : 1 }}>
                      {e.custom ? <Portrait avatar={toAvatar(e.custom.avatar)} size={64} label={`Portrait of ${e.name}`} /> : initials(e.name)}
                    </span>
                    <span className="cand-text">
                      <b>{e.name}</b>
                      <small>{e.affiliation}</small>
                      {by ? (
                        <span className="cand-lock">
                          <LockIcon /> Taken by {by}
                        </span>
                      ) : (
                        <span className="cand-chips">
                          {chips.map(([g, n]) => (
                            <span key={g} className={n > 0 ? "plus" : "minus"}>
                              {pct(n)} {groupName(g)}
                            </span>
                          ))}
                          {chips.length === 0 && <span className="even">No bonuses or penalties</span>}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cand-star"
                    aria-pressed={favs.has(e.id)}
                    aria-label={favs.has(e.id) ? `Remove ${e.name} from favorites` : `Add ${e.name} to favorites`}
                    onClick={() => toggleFav(e.id)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={favs.has(e.id) ? "#ffd34d" : "none"} stroke="#2b2440" strokeWidth="2" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
            {shown.length === 0 && <p className="cand-empty">No {word}s match. Try another search or filter.</p>}
          </div>

          <aside className="cand-detail" data-testid="picker-detail">
            <div className="cand-detail-head" style={{ background: seat.party.color }}>
              <span className="cand-face big">{pick.custom ? <Portrait avatar={toAvatar(pick.custom.avatar)} size={78} label={`Portrait of ${pick.name}`} /> : initials(pick.name)}</span>
              <span>
                <b>{pick.name}</b>
                <small>{pick.custom ? "Your candidate" : presidential ? `Runs as ${pick.affiliation === "Independent" ? "an Independent" : `the ${pick.affiliation} candidate`}` : pick.affiliation}</small>
              </span>
            </div>
            <div className="cand-lists">
              <div>
                <small className="good">STRENGTHS</small>
                {strengths.map(([g, n]) => (
                  <span key={g} title={pick.notes[g]}>
                    <b className="good">{pct(n)}</b> {groupName(g)}
                    {pick.notes[g] && <em>{pick.notes[g]}</em>}
                  </span>
                ))}
                {strengths.length === 0 && <span className="muted">None</span>}
              </div>
              <div>
                <small className="bad">WEAKNESSES</small>
                {weaknesses.map(([g, n]) => (
                  <span key={g} title={pick.notes[g]}>
                    <b className="bad">{pct(n)}</b> {groupName(g)}
                    {pick.notes[g] && <em>{pick.notes[g]}</em>}
                  </span>
                ))}
                {weaknesses.length === 0 && <span className="muted">None</span>}
              </div>
            </div>
            <p className="cand-note">Bonuses raise a group's income and lower its step costs; penalties do the opposite.</p>
            <button
              type="button"
              className="primary cand-choose"
              disabled={Boolean(pickTaken)}
              onClick={() => {
                onPick(pick.id);
                onClose();
              }}
              data-testid="choose-candidate"
            >
              {pickTaken ? `Taken by ${pickTaken}` : `Choose ${pick.name}`}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
