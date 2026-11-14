/** Play with friends: create a private match or join one by code, and the lobby where friends gather before it starts. */
import { useEffect, useReducer, useState } from "react";
import { useCloud } from "./cloud";
import { askToNotify, canNotify, notificationsOn, nudge } from "./notify";
import { candidateName, map, MAPS, isMapId, selectMap } from "./model";
import { EmblemIcon } from "./Menu";
import { COLORS, EMBLEMS, EMBLEM_NAME } from "./setup";
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
  // People other than the host who haven't said they're ready (the host starting is their ready).
  const hostSeat = view?.seats.find((s) => s.kind === "human")?.id;
  const notReady = view?.seats.filter((s) => s.kind === "human" && s.playerName && s.id !== hostSeat && !s.ready).length ?? 0;
  const mapName = view && isMapId(view.setup.map) ? MAPS[view.setup.map].name : "";
  return (
    <main className="setup setup-v2 lobby" data-testid="lobby">
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
                  {s.kind === "ai"
                    ? `Computer · ${LEVEL[s.level]}`
                    : s.playerName
                      ? `${s.playerName}${s.id === view.you ? " (you)" : ""} · ${view.seats.length && s.id === view.seats.find((x) => x.kind === "human")?.id ? "host" : s.ready ? "ready" : "choosing"}`
                      : "Waiting for a friend…"}
                </span>
              </li>
            ))}
          </ul>
          {view.you && <LobbyParty link={link} view={view} />}
          {view.youHost ? (
            <button type="button" className="primary start" disabled={open > 0 || notReady > 0 || link.status !== "open"} onClick={() => (link.clearError(), link.start())} data-testid="lobby-start">
              {open > 0
                ? `Waiting for ${open} more ${open === 1 ? "friend" : "friends"}`
                : notReady > 0
                  ? `Waiting for ${notReady} to get ready`
                  : "Start the campaign"}
            </button>
          ) : (
            view.you && <p className="small">{view.seats.find((x) => x.id === view.you)?.ready ? "You're ready. Waiting for the host to start the match." : "Pick your party, then press I'm ready."}</p>
          )}
        </>
      )}
    </main>
  );
}

/** The player's online matches: their move first, then the rest, then recent results. Tapping one opens it. */
export function OngoingScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (code: string) => void }) {
  const signedIn = useCloud().state !== "off";
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    // Nothing to list before the first online match, and no reason to make an online profile just to look.
    if (!signedIn) {
      setMatches([]);
      return;
    }
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
  }, [signedIn]);
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

/**
 * Your party in the lobby (design: Parliamentary online setup, "Your party here"): name, colour and emblem, first come
 * first served with taken ones crossed out, and the leader; Presidential maps pick the candidate only. Friends press
 * I'm ready to lock their picks; the host's Start is their ready.
 */
function LobbyParty({ link, view }: { link: MatchLink; view: RoomView }) {
  const mine = view.seats.find((s) => s.id === view.you)!;
  const others = view.seats.filter((s) => s.id !== mine.id);
  const presidential = map.pack.gameType === "presidential";
  const locked = mine.ready && !view.youHost;
  const [name, setName] = useState(mine.party.name);
  useEffect(() => setName(mine.party.name), [mine.party.name]);
  const takenBy = (pred: (s: RoomView["seats"][number]) => boolean) => others.find(pred)?.party.name;
  const sendName = () => {
    const n = name.trim();
    if (n && n !== mine.party.name) link.pick({ name: n });
  };
  return (
    <section className="backup lobby-party" data-testid="lobby-party" style={{ borderTopColor: mine.party.color }}>
      <div className="setup-card-head">
        <h2>{presidential ? "Your candidate" : "Your party here"}</h2>
        {!view.youHost && (
          <button type="button" className={mine.ready ? "" : "primary"} onClick={() => link.setReady(!mine.ready)} data-testid="lobby-ready">
            {mine.ready ? "Change my pick" : "I'm ready"}
          </button>
        )}
      </div>
      <fieldset disabled={locked} className="lobby-party-fields">
        {!presidential && (
          <>
            <label className="party-name">
              <span className="field-label">PARTY NAME</span>
              <span className="party-name-box">
                <span className="party-name-emblem" style={{ background: mine.party.color }}>
                  <EmblemIcon emblem={mine.party.emblem} color="#fff7e2" size={26} />
                </span>
                <input
                  value={name}
                  maxLength={28}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={sendName}
                  onKeyDown={(e) => e.key === "Enter" && sendName()}
                  aria-label="Your party name"
                  data-testid="lobby-name"
                />
              </span>
            </label>
            <div className="field">
              <span className="field-label">COLOUR</span>
              <div className="swatches" role="radiogroup" aria-label="Your colour">
                {COLORS.map((c) => {
                  const by = takenBy((s) => s.party.color.toLowerCase() === c.hex);
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      role="radio"
                      aria-checked={mine.party.color.toLowerCase() === c.hex}
                      aria-label={by ? `${c.name}, taken by ${by}` : c.name}
                      disabled={Boolean(by)}
                      className="swatch"
                      style={{ background: c.hex }}
                      onClick={() => link.pick({ color: c.hex })}
                    >
                      {by && (
                        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                          <path d="M6 26L26 6" stroke="#fff7e2" strokeWidth="7" strokeLinecap="round" />
                          <path d="M6 26L26 6" stroke="#2b2440" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <span className="field-label">EMBLEM</span>
              <div className="emblems" role="radiogroup" aria-label="Your emblem">
                {EMBLEMS.map((e) => {
                  const by = takenBy((s) => s.party.emblem === e);
                  const on = mine.party.emblem === e;
                  return (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={by ? `${EMBLEM_NAME[e]}, taken by ${by}` : EMBLEM_NAME[e]}
                      disabled={Boolean(by)}
                      className="emblem-pick"
                      style={on ? { boxShadow: `0 0 0 3px ${mine.party.color}, 0 4px 0 3px #2b2440` } : undefined}
                      onClick={() => link.pick({ emblem: e })}
                    >
                      <EmblemIcon emblem={e} color={on ? mine.party.color : by ? "#dcdce2" : "#fff7e2"} size={30} />
                      <span>{by ? "TAKEN" : EMBLEM_NAME[e]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
        <label className="field">
          <span className="field-label">{presidential ? "CANDIDATE" : "LEADER"}</span>
          <select value={mine.leaderId} onChange={(e) => link.pick({ leaderId: e.target.value })} aria-label="Your leader" data-testid="lobby-leader">
            {map.pack.candidates.map((c) => (
              <option key={c.id} value={c.id} disabled={others.some((s) => s.leaderId === c.id)}>
                {c.name} · {c.affiliation}
              </option>
            ))}
          </select>
        </label>
        <small className="muted">Crossed out: someone in this lobby picked it first. {view.youHost ? "" : "Picks lock when you're ready."}</small>
      </fieldset>
    </section>
  );
}
