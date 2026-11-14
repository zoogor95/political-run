/** Play with friends: create a private match or join one by code, and the lobby where friends gather before it starts. */
import { useEffect, useReducer, useState } from "react";
import { candidateName, MAPS, isMapId, selectMap } from "./model";
import { inviteLink, normalizeInvite, type MatchLink, type RoomView } from "./online";

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

/** The lobby: the invite code, who has taken each seat, and the host's Start button. */
export function LobbyScreen({ link: raw, onBack, onPlay }: { link: MatchLink; onBack: () => void; onPlay: (view: RoomView) => void }) {
  const link = useLink(raw)!;
  const view = link.view;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (view) selectMap(view.setup.map, view.setup.customs ?? []);
    if (view && view.status !== "lobby" && view.you) onPlay(view);
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
        <span className="muted">{mapName}</span>
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
