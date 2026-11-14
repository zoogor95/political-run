/**
 * Create your party, after the design's Create your party artboard: your own party's name, colour and emblem, saved to
 * your profile and offered to you first in every Parliamentary match. A preview shows the party's badge, its row among
 * the leaders and its piece on the board.
 */
import { useState } from "react";
import { EmblemIcon } from "./Menu";
import { MAPS } from "./model";
import { textOn } from "./panels";
import { setProfileParty, useProfile, type SavedParty } from "./profile";
import { COLORS, EMBLEMS, EMBLEM_NAME } from "./setup";

const MAX = 24;

/** Every real party the game's maps name, so a party can't pass itself off as one. */
const REAL_PARTIES = [...new Set(Object.values(MAPS).flatMap((m) => m.pack.candidates.map((c) => c.affiliation)))].filter((p) => p.length >= 3 && p !== "Independent");

/** What's wrong with a party name, or null when it's fine. */
export function partyNameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 3) return "Give your party a name of at least 3 letters.";
  const lower = ` ${n.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const real = REAL_PARTIES.find((p) => lower.includes(` ${p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
  return real ? `That's too close to a real party (${real}). Pick a name of your own.` : null;
}

const tint = (hex: string) => `color-mix(in srgb, ${hex} 22%, #fff)`;
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
const FIRST = ["Tea Break", "Zoogor", "Queue Appreciation", "Sunny Side", "Lamp Post", "Big Umbrella", "Fresh Bread", "Quiet Carriage", "Allotment", "Night Bus"];
const LAST = ["Party", "Alliance", "League", "Movement", "Society", "Front", "Club"];

export function CreatePartyScreen({ onBack }: { onBack: () => void }) {
  const profile = useProfile();
  const username = profile.name.trim();
  const start: SavedParty = profile.party ?? { name: username ? `${username} Party`.slice(0, MAX) : "Zoogor Party", color: COLORS[0]!.hex, emblem: EMBLEMS[0]! };
  const [party, setParty] = useState<SavedParty>(start);
  const [saved, setSaved] = useState(false);
  const problem = partyNameProblem(party.name);
  const set = (patch: Partial<SavedParty>) => {
    setSaved(false);
    setParty((p) => ({ ...p, ...patch }));
  };
  const short = party.name.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  return (
    <main className="create-party" data-testid="create-party">
      <header className="cp-top">
        <button type="button" className="back" onClick={onBack} aria-label="Back" data-testid="party-back">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="cp-title">
          <h1>Create your party</h1>
          <span>Parliamentary matches · you lead your own party, not a real one</span>
        </div>
      </header>

      <div className="cp-body">
        <div className="cp-form">
          <section className="cp-step">
            <span className="cp-label">1 · PARTY NAME</span>
            <div className="cp-name-row">
              <label className="cp-name">
                <span className="sr-only">Party name</span>
                <input value={party.name} maxLength={MAX} onChange={(e) => set({ name: e.target.value })} data-testid="party-name" />
                <small aria-live="polite">
                  {party.name.length} / {MAX}
                </small>
              </label>
              <button type="button" disabled={!username} onClick={() => set({ name: `${username} Party`.slice(0, MAX) })} data-testid="party-username">
                Use my username
              </button>
            </div>
            {problem ? (
              <span className="cp-problem" role="alert" data-testid="party-problem">
                {problem}
              </span>
            ) : (
              <span className="cp-hint">{username ? "Starts as your username." : "Set your name on the profile to use it here."} Names can't copy a real party's name.</span>
            )}
          </section>

          <section className="cp-step">
            <span className="cp-label" id="cp-colour">
              2 · PARTY COLOUR
            </span>
            <div className="swatches cp-swatches" role="radiogroup" aria-labelledby="cp-colour">
              {COLORS.map((c) => (
                <button key={c.hex} type="button" role="radio" aria-checked={party.color === c.hex} aria-label={c.name} className="swatch" style={{ background: c.hex }} onClick={() => set({ color: c.hex })} />
              ))}
            </div>
            <span className="cp-hint">In a match, whoever picks a colour first gets it, so your usual one may already be taken. Computer parties always choose last.</span>
          </section>

          <section className="cp-step">
            <span className="cp-label" id="cp-emblem">
              3 · EMBLEM
            </span>
            <div className="emblems cp-emblems" role="radiogroup" aria-labelledby="cp-emblem">
              {EMBLEMS.map((e) => {
                const on = party.emblem === e;
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={EMBLEM_NAME[e]}
                    className="emblem-pick"
                    style={on ? { boxShadow: `0 0 0 3px ${party.color}, 0 4px 0 3px #2b2440` } : undefined}
                    onClick={() => set({ emblem: e })}
                  >
                    <EmblemIcon emblem={e} color={on ? tint(party.color) : "#fff7e2"} size={30} />
                    <span>{EMBLEM_NAME[e]}</span>
                  </button>
                );
              })}
            </div>
            <span className="cp-hint">Same for emblems. Symbols real parties use on ballots (bat, tiger, arrow, kite, lotus, hand, rose and others) aren't offered.</span>
          </section>
        </div>

        <aside className="cp-side">
          <section className="cp-preview" data-testid="party-preview">
            <small className="cp-label">PREVIEW</small>
            <div className="cp-badge-row">
              <span className="cp-badge" style={{ background: party.color }}>
                <EmblemIcon emblem={party.emblem} color="#fff7e2" size={44} />
              </span>
              <span>
                <b>{party.name.trim() || "Your party"}</b>
                <small>
                  {username ? `Founded by ${username} · ` : ""}
                  {EMBLEM_NAME[party.emblem]} emblem
                </small>
              </span>
            </div>
            <div className="cp-leader-row">
              <span className="leader-initials" style={{ background: tint(party.color), borderColor: party.color }} aria-hidden="true">
                ?
              </span>
              <span>
                <small>
                  <i className="chip" style={{ background: party.color }} /> YOU · {(party.name.trim() || "Your party").toUpperCase()}
                </small>
                <b>Your leader</b>
                <small className="muted">You pick the leader each match</small>
              </span>
              <b className="cp-seats">0</b>
            </div>
            <small className="cp-label">ON THE BOARD</small>
            <div className="cp-board">
              <div className="cp-tally" aria-hidden="true">
                <div style={{ background: party.color, color: textOn(party.color), width: "38%" }}>{short.slice(0, 9)}</div>
                <div style={{ background: "#0f8a7e", width: "26%" }} />
                <div style={{ background: "#e8604c", width: "20%" }} />
              </div>
              <svg width="96" height="80" viewBox="0 0 96 80" aria-hidden="true">
                <path d="M10 22l26-14 28 6 22 18-6 30-30 12-30-8-12-22z" fill={party.color} stroke="#2b2440" strokeWidth="3" strokeLinejoin="round" />
                <circle cx="48" cy="42" r="13" fill="#fff7e2" stroke="#2b2440" strokeWidth="3" />
                <text x="48" y="47" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize="14" fill="#2b2440">
                  57
                </text>
              </svg>
            </div>
            <small className="cp-hint">Rivals are computer parties with made-up names, like the Tea Break Party, each led by a real politician.</small>
          </section>
          <section className="cp-saved-note">
            <b>Saved to your profile</b>
            <span>
              Name, colour and emblem carry over to every Parliamentary match. In a match they're offered to you first, but if someone else picked them before you, you choose another for
              that match. You pick the leader each match.
            </span>
          </section>
          <div className="cp-actions">
            <button
              type="button"
              onClick={() => set({ name: `${pick(FIRST)} ${pick(LAST)}`.slice(0, MAX), color: pick(COLORS).hex, emblem: pick(EMBLEMS) })}
              data-testid="party-random"
            >
              Randomise
            </button>
            <button
              type="button"
              className="primary"
              disabled={Boolean(problem)}
              onClick={() => {
                setProfileParty(party);
                setSaved(true);
              }}
              data-testid="party-save"
            >
              {saved ? "Saved!" : "Save my party"}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
