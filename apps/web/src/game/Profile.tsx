/** The profile screen (name, stats, achievements) and the toast that announces a new achievement. */
import { useEffect, useState } from "react";
import { ACHIEVEMENTS } from "./achievements";
import { play } from "./audio";
import { backUp, CloudError, deleteBackup, restore, stopBackup, syncNow, useCloud } from "./cloud";
import { MAPS } from "./model";
import { onUnlock, setProfileName, useProfile } from "./profile";

const LEVEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const p = useProfile();
  const cloud = useCloud();
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
        <span className="muted">{cloud.state === "off" ? "Kept in this browser" : "Backed up online"}</span>
      </header>
      <label className="creator-field profile-name">
        <span>Name</span>
        <input value={p.name} maxLength={28} placeholder="Your name" onChange={(e) => setProfileName(e.target.value)} aria-label="Your name" />
      </label>
      <BackupPanel />
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

function ago(t: number | null): string {
  if (!t) return "not yet";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Online backup: turn it on (and get a recovery code), restore with a code, or see that it's working. While it's on,
 * changes go up by themselves; the buttons here are for the rare things.
 */
function BackupPanel() {
  const cloud = useCloud();
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [typed, setTyped] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = cloud.state === "syncing";

  const attempt = async (step: () => Promise<unknown>) => {
    setError("");
    try {
      await step();
      return true;
    } catch (e) {
      setError(e instanceof CloudError ? e.message : "Something went wrong. Try again.");
      return false;
    }
  };
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowCode(true);
    }
  };

  if (cloud.state === "off") {
    return (
      <section className="backup" data-testid="backup" aria-label="Online backup">
        <h2>Online backup</h2>
        <p>Your profile lives in this browser only. Back it up to keep your stats and achievements if you clear the browser or switch devices.</p>
        {restoring ? (
          <form
            className="backup-restore"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(() => restore(typed)).then((ok) => ok && setRestoring(false));
            }}
          >
            <label className="creator-field">
              <span>Recovery code</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false} aria-label="Recovery code" data-testid="restore-code" />
            </label>
            <small className="muted">Anything you've earned on this device is kept and added to the restored profile.</small>
            <div className="backup-actions">
              <button type="submit" className="primary" disabled={busy || !typed.trim()} data-testid="restore-go">
                {busy ? "Restoring…" : "Restore"}
              </button>
              <button type="button" onClick={() => (setRestoring(false), setError(""))}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="backup-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void attempt(backUp).then((ok) => ok && setFresh(true))} data-testid="backup-on">
              {busy ? "Backing up…" : "Back up my profile online"}
            </button>
            <button type="button" onClick={() => setRestoring(true)} data-testid="restore-open">
              Restore with a recovery code
            </button>
          </div>
        )}
        {error && (
          <p className="backup-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  const line = { syncing: "Syncing…", synced: `Backed up · last synced ${ago(cloud.syncedAt)}`, offline: "Can't reach the server right now. Changes will go up when it's back." }[cloud.state];
  return (
    <section className="backup on" data-testid="backup" aria-label="Online backup">
      <h2>Online backup</h2>
      <p className="backup-status" data-testid="backup-status">
        <span className={`backup-dot ${cloud.state}`} aria-hidden="true" /> {line}
      </p>
      {(fresh || showCode) && (
        <div className="backup-code" data-testid="recovery-code-box">
          {fresh && <b>Write down your recovery code. It's the only way to get this profile back on a new device or after clearing the browser.</b>}
          <code data-testid="recovery-code">{cloud.code}</code>
          <div className="backup-actions">
            <button type="button" onClick={() => void copy(cloud.code)}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={() => (setFresh(false), setShowCode(false))}>
              {fresh ? "I've saved it" : "Hide"}
            </button>
          </div>
        </div>
      )}
      <div className="backup-actions">
        {!fresh && !showCode && (
          <button type="button" onClick={() => setShowCode(true)} data-testid="show-code">
            Show recovery code
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void attempt(syncNow)}>
          Sync now
        </button>
        <button type="button" onClick={() => void attempt(stopBackup)} data-testid="backup-stop">
          Stop backing up here
        </button>
        {confirmDelete ? (
          <>
            <button type="button" className="danger" onClick={() => void attempt(deleteBackup).then(() => setConfirmDelete(false))} data-testid="backup-delete-yes">
              Delete it for good
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} data-testid="backup-delete">
            Delete online backup
          </button>
        )}
      </div>
      {confirmDelete && <small className="muted">This deletes the online copy on every device. This device keeps its own stats and achievements.</small>}
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
    </section>
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
