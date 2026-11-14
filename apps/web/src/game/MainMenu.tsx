/**
 * The main menu, after the design's Main menu artboard: the title card and profile pill, five match boxes, a bar with
 * the map, ongoing games, the tutorial and settings, and the MMN ticker. Boxes and buttons for things not built yet
 * (quick match, tournaments, leaderboards, shop) are shown as coming soon so the table looks the way it will.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Headline } from "@majority-map/core";
import { useCloud } from "./cloud";
import { MAPS, isMapId, mapDetail, preferredMap, setPreferredMap, type MapId } from "./model";
import { myMatches } from "./online";
import { useProfile } from "./profile";
import { Ticker } from "./recap";
import { loadMatch } from "./saves";
import type { Mode } from "./setup";
import { tutorialDone } from "./tutorial";

const ink = "#2b2440";

/** The five match boxes, in the design's order. */
const BOXES: { id: string; title: string; about: string; chip: string; color: string; chipBg: string; mode?: Mode | "online"; icon: ReactNode; darkIcon?: boolean }[] = [
  {
    id: "new-solo",
    title: "Solo campaign",
    about: "You against 1 to 4 AI candidates. Easy, Normal and Hard.",
    chip: "OFFLINE OK",
    color: "#2f6fdf",
    chipBg: "#dce8fd",
    mode: "solo",
    icon: (
      <>
        <circle cx="24" cy="22" r="10" />
        <path d="M8 54c2-11 8-16 16-16s14 5 16 16" />
        <rect x="40" y="26" width="18" height="14" rx="3" />
        <path d="M45 33h8" />
      </>
    ),
  },
  {
    id: "new-online",
    title: "Play with friends",
    about: "Private match by invite code. Everyone plays on their own device.",
    chip: "INVITE CODE",
    color: "#7a5af0",
    chipBg: "#e7e0fd",
    mode: "online",
    icon: (
      <>
        <circle cx="21" cy="22" r="9" />
        <circle cx="44" cy="22" r="9" />
        <path d="M5 52c1-9 7-14 16-14s15 5 16 14" />
        <path d="M33 40c3-2 7-2 11-2c9 0 15 5 16 14" />
      </>
    ),
  },
  {
    id: "quick-match",
    title: "Quick match",
    about: "Find opponents online. Casual or ranked, nothing to buy.",
    chip: "CASUAL · RANKED",
    color: "#1c8f7d",
    chipBg: "#d4f1ea",
    icon: (
      <>
        <circle cx="28" cy="28" r="16" />
        <path d="M40 40l14 14" />
        <path d="M22 28h12M28 22v12" />
      </>
    ),
  },
  {
    id: "tournaments",
    title: "Tournaments",
    about: "Scheduled rounds. Free to enter, win titles and badges.",
    chip: "FREE ENTRY",
    color: "#df4338",
    chipBg: "#fbe0dd",
    icon: (
      <>
        <path d="M20 8h24v14a12 12 0 0 1-24 0z" />
        <path d="M20 14h-8c0 8 4 12 9 13M44 14h8c0 8-4 12-9 13" />
        <path d="M32 34v10M22 56h20M25 56l2-12h10l2 12" />
      </>
    ),
  },
  {
    id: "new-hotseat",
    title: "Pass and Play",
    about: "Up to 5 players on one device. Plans stay secret.",
    chip: "ONE DEVICE",
    color: "#f0a020",
    chipBg: "#fde9c4",
    mode: "hotseat",
    darkIcon: true,
    icon: (
      <>
        <rect x="18" y="8" width="28" height="48" rx="5" />
        <path d="M28 48h8" />
        <path d="M6 30h8M50 30h8M10 26l-4 4 4 4M54 26l4 4-4 4" />
      </>
    ),
  },
];

/** A few headlines from the map's campaign-world filler, for the ticker under the menu. */
function menuHeadlines(mapId: MapId): Headline[] {
  const filler = [...(MAPS[mapId].news.templates.filler ?? [])];
  for (let i = filler.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filler[i], filler[j]] = [filler[j]!, filler[i]!];
  }
  return filler.slice(0, 6).map((text) => ({ kind: "filler", text, breaking: false, score: 0, involvesYou: false }) as Headline);
}

export function MainMenu({
  onContinue,
  onNew,
  onTutorial,
  onSettings,
  onProfile,
  onOnline,
  onOngoing,
}: {
  onContinue: () => void;
  onNew: (mode: Mode) => void;
  onTutorial: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onOnline: () => void;
  onOngoing: () => void;
}) {
  const save = loadMatch();
  const profile = useProfile();
  const signedIn = useCloud().state !== "off";
  const [mapId, setMapId] = useState<MapId>(preferredMap);
  const headlines = useMemo(() => menuHeadlines(mapId), [mapId]);
  // New players see Learn to play up front; once it's done or skipped it lives in the bar as Tutorial.
  const newcomer = !tutorialDone() && !save;
  // Online matches waiting on this player, for the badge on Ongoing games.
  const [yourMove, setYourMove] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    myMatches()
      .then((m) => live && setYourMove(m.filter((x) => x.yourMove).length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [signedIn]);

  const open = (box: (typeof BOXES)[number]) => {
    if (box.mode === "online") onOnline();
    else if (box.mode) onNew(box.mode);
  };
  const when = save ? new Date(save.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <main className="menu" data-testid="main-menu">
      <header className="menu-top">
        <div className="menu-title">
          <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
            <rect x="4" y="12" width="50" height="40" rx="8" fill="#ffd34d" stroke={ink} strokeWidth="3.5" />
            <path d="M20 30l7 7 13-14" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="18" y="4" width="22" height="10" rx="3" fill="#fff" stroke={ink} strokeWidth="3.5" />
          </svg>
          <div>
            <h1>Majority Map</h1>
            <p className="tagline">Win the map. Win the majority.</p>
          </div>
        </div>
        <button type="button" className="menu-profile" onClick={onProfile} data-testid="open-profile">
          <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
            <circle cx="26" cy="26" r="24" fill="#2f6fdf" stroke={ink} strokeWidth="3" />
            <circle cx="26" cy="22" r="10" fill="#f6c9a0" stroke={ink} strokeWidth="2.5" />
            <path d="M14 44c2-8 7-11 12-11s10 3 12 11" fill="#fff" stroke={ink} strokeWidth="2.5" />
            <path d="M16 19c2-8 18-8 20 0c-5-2-15-2-20 0z" fill={ink} />
          </svg>
          <span>
            <b>{profile.name.trim() || "Your profile"}</b>
            <small>Stats and achievements</small>
          </span>
        </button>
      </header>

      {(save || newcomer) && (
        <div className="menu-callouts">
          {save && (
            <button type="button" className="menu-callout gold" onClick={onContinue} data-testid="continue-match">
              <b>Continue match</b>
              <small>
                {save.result ? "Result" : save.state.phase === "final" ? "Final turn" : `Turn ${save.state.turn}`} ·{" "}
                {MAPS[isMapId(save.state.packId) ? save.state.packId : "uk"].name} · saved {when}
              </small>
            </button>
          )}
          {newcomer && (
            <button type="button" className="menu-callout gold" onClick={onTutorial} data-testid="learn">
              <b>New here? Learn to play</b>
              <small>A guided first match, about 5 minutes</small>
            </button>
          )}
        </div>
      )}

      <section className="menu-choose" aria-labelledby="choose-a-match">
        <h2 id="choose-a-match" className="menu-label">
          Choose a match
        </h2>
        <div className="match-boxes">
          {BOXES.map((b) => {
            const soon = !b.mode;
            return (
              <button key={b.id} type="button" className={`match-box${soon ? " soon" : ""}`} disabled={soon} onClick={() => open(b)} data-testid={b.id}>
                <span className="match-box-art" style={{ background: b.color }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke={b.darkIcon ? ink : "#fff"} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
                    {b.icon}
                  </svg>
                  {soon && <span className="soon-tag">COMING SOON</span>}
                </span>
                <span className="match-box-body">
                  <b>{b.title}</b>
                  <span className="match-box-about">{b.about}</span>
                  <span className="match-chip" style={{ background: b.chipBg }}>
                    {b.chip}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="menu-bar">
        <label className="menu-map">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          <span className="sr-only">Map</span>
          <select
            value={mapId}
            onChange={(e) => {
              const id = e.target.value as MapId;
              setPreferredMap(id);
              setMapId(id);
            }}
            data-testid="menu-map"
          >
            {Object.values(MAPS).map((m) => (
              <option key={m.id} value={m.id}>
                Map: {m.name} · {mapDetail(m).split(" · ")[0]}
              </option>
            ))}
          </select>
        </label>
        <div className="menu-bar-buttons">
          <button type="button" className="gold" onClick={onOngoing} data-testid="open-ongoing">
            Ongoing games
            {yourMove > 0 && (
              <span className="menu-badge" aria-label={`${yourMove} waiting for your move`}>
                {yourMove}
              </span>
            )}
          </button>
          <button type="button" disabled title="Coming soon">
            Leaderboards
          </button>
          <button type="button" disabled title="Coming soon">
            Shop
          </button>
          {!newcomer && (
            <button type="button" onClick={onTutorial} data-testid="learn">
              Tutorial
            </button>
          )}
          <button type="button" className="icon" aria-label="Settings" onClick={onSettings} data-testid="open-settings">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
            </svg>
          </button>
          <a className="lab-link" href="?lab">
            Board lab
          </a>
        </div>
      </div>
      <div className="menu-ticker">
        <Ticker headlines={headlines} />
      </div>
    </main>
  );
}
