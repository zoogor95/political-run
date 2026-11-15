/** The profile screen (name, stats, achievements) and the toast that announces a new achievement. */
import { useEffect, useState } from "react";
import { ACHIEVEMENTS } from "./achievements";
import { play } from "./audio";
import { backUp, CloudError, deleteBackup, restore, sessionToken, stopBackup, syncNow, useCloud } from "./cloud";
import { HOME_COUNTRIES, myRatings, setHome } from "./quick";
import { MAPS } from "./model";
import { onUnlock, setProfileName, useProfile } from "./profile";

const LEVEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

export function ProfileScreen({ onBack, onParty, onLogin }: { onBack: () => void; onParty?: () => void; onLogin?: () => void }) {
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
      {onParty && (
        <section className="backup your-party" data-testid="your-party">
          <h2>Your party</h2>
          {p.party ? (
            <p className="your-party-row">
              <span className="chip big" style={{ background: p.party.color }} aria-hidden="true" />
              <span>
                <b>{p.party.name}</b>
                <small> · offered to you first in every Parliamentary match</small>
              </span>
            </p>
          ) : (
            <p>Make a party of your own: a name, colour and emblem that carry over to every Parliamentary match.</p>
          )}
          <div className="backup-actions">
            <button type="button" className="primary" onClick={onParty} data-testid="edit-party">
              {p.party ? "Edit your party" : "Create your party"}
            </button>
          </div>
        </section>
      )}
      {onLogin && <AccountSection onLogin={onLogin} />}
      <BackupPanel />
      <CupTitles />
      <HomeRegions />
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
        {!fresh && !showCode && cloud.code !== "" && (
          <button type="button" onClick={() => setShowCode(true)} data-testid="show-code">
            Show recovery code
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void attempt(syncNow)}>
          Sync now
        </button>
        <button type="button" onClick={() => void attempt(stopBackup)} data-testid="backup-stop">
          {cloud.username ? "Sign out of this device" : "Stop backing up here"}
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

/** Tournament titles: a crown for each cup won and a medal for each final reached. Nothing is shown (or asked of the server) until the player has an online account. */
function CupTitles() {
  const [titles, setTitles] = useState<{ id: string; name: string; rank: 1 | 2 }[]>([]);
  useEffect(() => {
    if (!sessionToken()) return;
    let live = true;
    myRatings()
      .then((r) => live && setTitles(r.titles ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (titles.length === 0) return null;
  return (
    <section className="backup cup-titles" data-testid="cup-titles" aria-label="Tournament titles">
      <h2>Tournament titles</h2>
      <ul>
        {titles.map((t) => (
          <li key={t.id} data-testid={`title-${t.id}`}>
            <span aria-hidden="true">{t.rank === 1 ? "🏆" : "🥈"}</span> {t.name} <small className="muted">{t.rank === 1 ? "Champion" : "Finalist"}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where you live: a country and a region of it. It puts you on that region's leaderboard. Saved to the online account. */
function HomeRegions() {
  const [home, setHomeState] = useState<{ country: string | null; region: string | null }>({ country: null, region: null });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sessionToken()) return;
    let live = true;
    myRatings()
      .then((r) => live && setHomeState(r.home ?? { country: null, region: null }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const save = async (country: string | null, region: string | null) => {
    setError("");
    try {
      await setHome(country, region);
      setHomeState({ country, region });
    } catch {
      setError("Couldn't save your home region. Try again in a moment.");
    }
  };
  const entry = HOME_COUNTRIES.find((c) => c.code === home.country);
  const map = entry ? MAPS[entry.map] : undefined;
  return (
    <section className="backup home-regions" data-testid="home-regions" aria-label="Home region">
      <h2>Where you live</h2>
      <p className="small">Pick your country and region to appear on that region's leaderboard. It is only used as a leaderboard filter and is never shown next to your name.</p>
      <label className="find">
        <span>Country</span>
        <select value={home.country ?? ""} onChange={(e) => void save(e.target.value || null, null)} data-testid="home-country">
          <option value="">Not set</option>
          {HOME_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {MAPS[c.map].name}
            </option>
          ))}
        </select>
      </label>
      {map && (
        <label className="find">
          <span>Region</span>
          <select value={home.region ?? ""} onChange={(e) => void save(home.country, e.target.value || null)} data-testid="home-region">
            <option value="">Not set</option>
            {map.pack.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
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
    </section>
  );
}

/** Username and password: sign in on any device, or add a login to this profile. */
function AccountSection({ onLogin }: { onLogin: () => void }) {
  const cloud = useCloud();
  const username = cloud.state !== "off" ? cloud.username : null;
  return (
    <section className="backup account" data-testid="account-section" aria-label="Account">
      <h2>Account</h2>
      {username ? (
        <p data-testid="account-name">
          Signed in as <b>{username}</b>.
        </p>
      ) : (
        <p>Make a username and password to get your profile back on any device, or sign in to one you already have.</p>
      )}
      <div className="backup-actions">
        <button type="button" className={username ? "" : "primary"} onClick={onLogin} data-testid="open-login">
          {username ? "Account details" : "Sign in or create an account"}
        </button>
      </div>
    </section>
  );
}
