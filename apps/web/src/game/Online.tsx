/** Play with friends: create a private match or join one by code, and the lobby where friends gather before it starts. */
import { useEffect, useReducer, useState } from "react";
import { askToNotify, canNotify, notificationsOn, nudge } from "./notify";
import { candidateName, MAPS, isMapId, selectMap } from "./model";
import { inviteLink, myMatches, normalizeInvite, type MatchLink, type MatchSummary, type RoomView } from "./online";

/** Re-renders whenever the link changes (a new view, the connection, an error). */
export function useLink(link: MatchLink | null): MatchLink | null {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => link?.subscribe(bump), [link]);
  return link;
}

export function OnlineHub({ onBack, onCreate, onJoin }: { onBack: () => void; onCreate: () => void; onJoin: (code: string) => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const join = () => {
    const code = normalizeInvite(typed);
    if (!code) return setError("Invite codes are 6 letters and numbers, like K7Q2MX.");
    onJoin(code);
  };
  return (
    <main className="setup online" data-testid="online-hub">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Play with friends</h1>
      </header>
      <p className="small">A private match online: each friend plays on their own device, and every turn resolves when everyone has sent their plan.</p>
      <section className="backup">
        <h2>Start a match</h2>
        <p>Choose the map and set up every seat, then share the invite code.</p>
        <div className="backup-actions">
          <button type="button" className="primary" onClick={onCreate} data-testid="online-create">
            Create a private match
          </button>
        </div>
      </section>
      <section className="backup">
        <h2>Join a friend</h2>
        <form
          className="backup-restore"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <label className="creator-field">
            <span>Invite code</span>
            <input value={typed} onChange={(e) => (setTyped(e.target.value), setError(""))} placeholder="K7Q2MX" maxLength={9} autoComplete="off" spellCheck={false} aria-label="Invite code" data-testid="join-code" />
          </label>
          <div className="backup-actions">
            <button type="submit" className="primary" disabled={!typed.trim()} data-testid="join-go">
              Join
            </button>
          </div>
        </form>
        {error && (
          <p className="backup-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <p className="small muted">Playing online turns on your profile's online backup, which signs you in.</p>
    </main>
  );
}

const LEVEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

/** "4:59", "1h 20m", "23h": the time left, rounded the way a player reads it. */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h >= 10 || m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Re-renders every second while a deadline is running and shows the time left. */
export function Countdown({ deadline }: { deadline: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return <b className="countdown">{timeLeft(deadline - Date.now())}</b>;
}

/** Offers browser notifications once, for when the game is in another tab. */
export function NotifyButton() {
  const [on, setOn] = useState(notificationsOn());
  if (!canNotify() || on || Notification.permission === "denied") return null;
  return (
    <button type="button" onClick={() => void askToNotify().then(setOn)} data-testid="notify-me">
      Notify me when it's my move
    </button>
  );
}

/** The lobby: the invite code, who has taken each seat, and the host's Start button. */
export function LobbyScreen({ link: raw, onBack, onPlay }: { link: MatchLink; onBack: () => void; onPlay: (view: RoomView) => void }) {
  const link = useLink(raw)!;
  const view = link.view;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (view) selectMap(view.setup.map, view.setup.customs ?? []);
    if (view && view.status !== "lobby" && view.you) {
      if (view.status === "active") nudge("The match has started. Your move!");
      onPlay(view);
    }
  }, [view, onPlay]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(link.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen to copy by hand.
    }
  };
  const open = view?.seats.filter((s) => s.kind === "human" && !s.playerName).length ?? 0;
  const mapName = view && isMapId(view.setup.map) ? MAPS[view.setup.map].name : "";
  return (
    <main className="setup lobby" data-testid="lobby">
      <header className="setup-head">
        <button
          type="button"
          onClick={() => {
            link.leave();
            onBack();
          }}
          data-testid="lobby-leave"
        >
          Leave
        </button>
        <h1>Lobby</h1>
        <span className="muted">
          {mapName}
          {view?.setup.turnSeconds ? ` · ${timeLeft(view.setup.turnSeconds * 1000)} per turn` : ""}
        </span>
      </header>
      <section className="backup lobby-code">
        <h2>Invite code</h2>
        <code data-testid="invite-code">{link.code}</code>
        <p className="small">
          Friends choose Play with friends, then Join, and type this code. Or send them the link:{" "}
          <a href={inviteLink(link.code)} data-testid="invite-link">
            {inviteLink(link.code)}
          </a>
        </p>
        <div className="backup-actions">
          <button type="button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <NotifyButton />
        </div>
      </section>
      {link.status !== "open" && link.status !== "closed" && <p className="small" data-testid="lobby-connecting">{link.status === "connecting" ? "Connecting…" : "Connection lost. Reconnecting…"}</p>}
      {link.error && (
        <p className="backup-error" role="alert" data-testid="lobby-error">
          {link.error}
        </p>
      )}
      {view && (
        <>
          <ul className="lobby-seats" data-testid="lobby-seats">
            {view.seats.map((s) => (
              <li key={s.id} style={{ borderLeftColor: s.party.color }} data-testid={`lobby-seat-${s.id}`}>
                <b>{s.party.name}</b>
                <small>{candidateName(s.leaderId)}</small>
                <span className={s.kind === "human" && !s.playerName ? "muted" : ""}>
                  {s.kind === "ai" ? `Computer · ${LEVEL[s.level]}` : s.playerName ? `${s.playerName}${s.id === view.you ? " (you)" : ""}` : "Waiting for a friend…"}
                </span>
              </li>
            ))}
          </ul>
          {view.youHost ? (
            <button type="button" className="primary start" disabled={open > 0 || link.status !== "open"} onClick={() => (link.clearError(), link.start())} data-testid="lobby-start">
              {open > 0 ? `Waiting for ${open} more ${open === 1 ? "friend" : "friends"}` : "Start the campaign"}
            </button>
          ) : (
            view.you && <p className="small">Waiting for the host to start the match.</p>
          )}
        </>
      )}
    </main>
  );
}

/** The player's online matches: their move first, then the rest, then recent results. Tapping one opens it. */
export function OngoingScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (code: string) => void }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let live = true;
    const load = () =>
      myMatches()
        .then((m) => live && (setMatches(m), setError("")))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn't load your matches."));
    void load();
    // Refreshes while open, so a friend's move shows up; the clock ticks the timers.
    const refresh = setInterval(load, 30_000);
    const clock = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, []);
  const line = (m: MatchSummary) => {
    if (m.status === "lobby") return "In the lobby";
    if (m.status === "finished") return "Finished · see the results";
    const left = m.deadline ? ` · ${timeLeft(m.deadline - Date.now())} left` : "";
    return `Turn ${m.turn}${m.yourMove ? " · Your move!" : " · Waiting for friends"}${left}`;
  };
  return (
    <main className="setup online" data-testid="ongoing">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>Ongoing matches</h1>
      </header>
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      {matches === null && !error && <p className="small">Loading…</p>}
      {matches?.length === 0 && <p className="small">No online matches yet. Start one from Play with friends.</p>}
      {matches && matches.length > 0 && (
        <ul className="lobby-seats ongoing-list">
          {matches.map((m) => (
            <li key={m.code} className={m.yourMove ? "your-move" : ""} data-testid={`ongoing-${m.code}`}>
              <button type="button" onClick={() => onOpen(m.code)}>
                <b>
                  {isMapId(m.map) ? MAPS[m.map].name : m.map}
                  {m.party ? ` · ${m.party}` : ""}
                </b>
                <small>
                  Code {m.code} · {m.people} {m.people === 1 ? "player" : "players"}
                </small>
                <span>{line(m)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <NotifyButton />
    </main>
  );
}
