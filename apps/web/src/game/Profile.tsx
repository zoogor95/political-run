/** The profile screen (name, stats, achievements) and the toast that announces a new achievement. */
import { useEffect, useState } from "react";
import { ACHIEVEMENTS } from "./achievements";
import { play } from "./audio";
import { MAPS } from "./model";
import { onUnlock, setProfileName, useProfile } from "./profile";

const LEVEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const p = useProfile();
  const s = p.stats;
  const got = ACHIEVEMENTS.filter((a) => a.id in p.unlocked).length;
  const hardest = (["hard", "normal", "easy"] as const).find((l) => (s.winsVs[l] ?? 0) > 0);
  const tiles: [string, string][] = [
    ["Matches", String(s.matches)],
    ["Wins", String(s.wins)],
    ["Majorities", String(s.majorities)],
    ["Best win, share of seats", s.wins ? `${Math.round(s.bestShare * 100)}%` : "–"],
    ["Hardest beaten", hardest ? LEVEL[hardest] : "–"],
    ["Pass and play", String(s.passAndPlay)],
    ["Regions locked", String(s.regionsLocked)],
    ["Groups won", String(s.groupsWon)],
    ["Clashes", String(s.clashes)],
    ["Turns played", String(s.turns)],
  ];
  return (
    <main className="setup profile" data-testid="profile">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Your profile</h1>
        <span className="muted">Kept in this browser</span>
      </header>
      <label className="creator-field profile-name">
        <span>Name</span>
        <input value={p.name} maxLength={28} placeholder="Your name" onChange={(e) => setProfileName(e.target.value)} aria-label="Your name" />
      </label>
      <section className="stat-grid" aria-label="Your stats">
        {tiles.map(([k, v]) => (
          <div key={k} className="stat">
            <b>{v}</b>
            <small>{k}</small>
          </div>
        ))}
      </section>
      <section className="by-map" aria-label="By map">
        {Object.values(MAPS).map((m) => {
          const r = s.maps[m.id] ?? { played: 0, won: 0 };
          return (
            <span key={m.id}>
              <b>{m.name}</b> {r.won} won of {r.played}
            </span>
          );
        })}
      </section>
      <h2 className="ach-title">
        Achievements · {got} of {ACHIEVEMENTS.length}
      </h2>
      <ul className="ach-grid" data-testid="achievements">
        {ACHIEVEMENTS.map((a) => {
          const at = p.unlocked[a.id];
          return (
            <li key={a.id} className={at ? "ach on" : "ach"} data-testid={`ach-${a.id}`} aria-label={`${a.name}: ${at ? "unlocked" : "locked"}`}>
              <span className="ach-badge" aria-hidden="true">
                {at ? "★" : "☆"}
              </span>
              <span>
                <b>{a.name}</b>
                <small>{a.about}</small>
                {at && <small className="ach-date">Unlocked {new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" })}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

/** Shows each newly unlocked achievement for a few seconds, one after another. */
export function AchievementToast() {
  const [queue, setQueue] = useState<string[]>([]);
  useEffect(() => onUnlock((ids) => setQueue((q) => [...q, ...ids])), []);
  const id = queue[0];
  useEffect(() => {
    if (!id) return;
    play("majority");
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [id]);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return null;
  return (
    <div className="ach-toast" role="status" data-testid="achievement-toast">
      <span className="ach-badge" aria-hidden="true">
        ★
      </span>
      <span>
        <small>Achievement unlocked</small>
        <b>{a.name}</b>
      </span>
    </div>
  );
}
