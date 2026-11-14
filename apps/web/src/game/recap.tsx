/** News ticker, BREAKING cards, the animated turn recap and the turn summary. */
import { useEffect } from "react";
import { updateSettings, useSettings } from "./settings";
import { groupModifier, meterOf, type GameState, type Headline, type PartySummary } from "@majority-map/core";
import { textOn } from "./panels";
import { candidateName, groupName, money, pack, playerOf, presidential, trackName, votesWord } from "./model";
import type { GameApi, TurnReport } from "./useGame";

/** The always-visible news bar from the fictional MMN channel. It can be hidden; the choice is remembered. */
export function Ticker({ headlines }: { headlines: Headline[] }) {
  const settings = useSettings();
  const toggle = () => updateSettings({ showTicker: !settings.showTicker });
  if (!settings.showTicker) {
    return (
      <button type="button" className="ticker-show" onClick={toggle} data-testid="ticker-show">
        Show the news
      </button>
    );
  }
  const text = headlines.map((h) => h.text).join("   •   ");
  // Roughly constant reading speed however many headlines there are.
  const seconds = Math.max(20, text.length / 9);
  return (
    <div className="ticker" data-testid="ticker" role="region" aria-label="News headlines">
      <span className="ticker-tag">MMN</span>
      <div className="ticker-track">
        <div className="ticker-text" style={{ animationDuration: `${seconds}s` }}>
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </div>
      </div>
      <button type="button" className="ticker-hide" aria-label="Hide the news ticker" onClick={toggle}>
        ×
      </button>
    </div>
  );
}

export function BreakingCard({ headline, onDone }: { headline: Headline; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <button type="button" className="breaking" onClick={onDone} data-testid="breaking">
      <span className="breaking-tag">BREAKING</span>
      <span className="breaking-text">{headline.text}</span>
      <small>Tap to continue</small>
    </button>
  );
}

const name = (s: GameState, id: string, label?: (id: string) => string) => (label ? label(id) : playerOf(s, id).party.name);
const color = (s: GameState, id: string) => playerOf(s, id).party.color;

/** What happened in one region this turn, party by party. */
function regionLines(report: TurnReport, regionId: string, label: (id: string) => string): { id: string; text: string; bad?: boolean }[] {
  const lines: { id: string; text: string; bad?: boolean }[] = [];
  for (const p of report.summary.parties) {
    for (const m of p.moves.filter((x) => x.regionId === regionId)) lines.push({ id: p.playerId, text: `${m.from} → ${m.to} steps · ${money(m.cost)}${m.firstEntry ? " · first entry" : ""}` });
    for (const c of p.conflicts.filter((x) => x.regionId === regionId)) lines.push({ id: p.playerId, text: `Collided at step ${c.step} with ${c.rivals.map((r) => name(report.after, r, label)).join(", ")} · lost ${money(c.amount)}`, bad: true });
    for (const f of p.freePips.filter((x) => x.regionId === regionId)) lines.push({ id: p.playerId, text: `Free pip from ${candidateName(f.candidateId)} · now ${f.to}` });
    if (p.locked.includes(regionId)) lines.push({ id: p.playerId, text: "Filled the meter: region locked" });
  }
  return lines;
}

export interface RecapControls {
  index: number;
  total: number;
  speed: 1 | 2;
  setSpeed(s: 1 | 2): void;
  replay(): void;
  skip(): void;
}

export function RecapPanel({ report, regionId, controls, label }: { report: TurnReport; regionId: string | null; controls: RecapControls; label: (id: string) => string }) {
  const lines = regionId ? regionLines(report, regionId, label) : [];
  const region = pack.regions.find((r) => r.id === regionId);
  return (
    <section className="recap" data-testid="recap">
      <div className="recap-head">
        <h3>Turn {report.summary.turn} recap</h3>
        <span className="tag">
          {Math.min(controls.index + 1, controls.total)} / {controls.total}
        </span>
      </div>
      {region && (
        <div className="recap-card" key={region.id} data-testid="recap-card">
          <h2>{region.name}</h2>
          <p className="muted">{region.seats} {votesWord()}</p>
          <ul>
            {lines.map((l, i) => (
              <li key={i} className={l.bad ? "bad" : ""}>
                <i className="chip" style={{ background: color(report.after, l.id) }} />
                <b>{name(report.after, l.id, label)}</b> {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="recap-controls">
        <button type="button" onClick={controls.replay}>
          Replay
        </button>
        <button type="button" aria-pressed={controls.speed === 2} onClick={() => controls.setSpeed(controls.speed === 2 ? 1 : 2)}>
          2× speed
        </button>
        <button type="button" className="primary" onClick={controls.skip} data-testid="skip">
          Skip
        </button>
      </div>
    </section>
  );
}


/**
 * The turn summary (design: Turn summary): "End of turn N", regions in contention, the turn's headline as a BREAKING
 * bar, then a card per party, you first: seats and their change, money spent, money lost in clashes, groups won,
 * lost and paying, and next turn's income.
 */
export function SummaryView({ game }: { game: GameApi }) {
  const report = game.report!;
  const s = report.after;
  const [top, ...rest] = report.headlines;
  const contended = pack.regions.filter((r) => s.players.some((p) => meterOf(s, r.id, p.id).steps >= pack.rules.contentionAt)).length;
  const parties = [...report.summary.parties].sort((a, b) =>
    game.humans.includes(a.playerId) ? -1 : game.humans.includes(b.playerId) ? 1 : b.seatsAfter - a.seatsAfter,
  );
  return (
    <div className="overlay summary-screen" data-testid="summary">
      <div className="summary-v2">
        <header className="summary-head">
          <h2>End of turn {report.summary.turn}</h2>
          <div className="summary-head-right">
            <span className="summary-contention">
              In contention {contended} / {pack.regions.length}
              {report.summary.newlyContended.length > 0 && <small> (+{report.summary.newlyContended.length} this turn)</small>}
            </span>
            <button type="button" className="primary" onClick={game.backToPlanning} data-testid="continue">
              {game.result ? "See the results" : game.state.phase === "final" ? "Play the final turn" : `Plan turn ${game.state.turn}`}
            </button>
          </div>
        </header>
        {top && (
          <div className="summary-news">
            <span className="summary-news-tag">
              <b>{top.breaking ? "BREAKING" : "MMN"}</b>
              <small>HEADLINE OF THE TURN</small>
            </span>
            <span className="summary-news-text">
              <b>{top.text}</b>
              {rest.length > 0 && <small>Also: {rest.slice(0, 2).map((h) => h.text).join(" · ")}</small>}
            </span>
          </div>
        )}
        {report.summary.finalTurnNext && <p className="final-note">Every region is now in contention: next turn is the FINAL TURN.</p>}
        <div className="summary-cards">{parties.map((p) => partyCard(s, p, game))}</div>
      </div>
    </div>
  );
}

function partyCard(s: GameState, p: PartySummary, game: GameApi) {
  const player = playerOf(s, p.playerId);
  const you = game.humans.includes(p.playerId);
  const change = p.seatsAfter - p.seatsBefore;
  const lost = p.conflicts.reduce((a, c) => a + c.amount, 0);
  const band = player.party.color;
  const ink = textOn(band);
  const leader = candidateName(player.leaderId);
  const income = p.income ? p.income.base + Object.values(p.income.groups).reduce((a, b) => a + b, 0) : null;
  return (
    <section key={p.playerId} className={`summary-card${you ? " you" : ""}`}>
      <div className="summary-card-head" style={{ background: band, color: ink }}>
        <span className="summary-face" style={{ background: `color-mix(in srgb, ${band} 22%, #fff)` }} aria-hidden="true">
          {leader
            .split(/\s+/)
            .filter((w) => /^[A-Z]/.test(w))
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </span>
        <span className="summary-who">
          <small>
            {player.party.name}
            {game.solo && you ? " (you)" : ""}
            {presidential() ? "" : ` · ${leader}`}
          </small>
          <b>
            {p.seatsAfter} <em>{votesWord()}</em>
          </b>
        </span>
        <span className={`summary-delta${change > 0 ? " up" : change < 0 ? " down" : ""}`}>{change > 0 ? `+${change}` : change < 0 ? `−${-change}` : "±0"}</span>
      </div>
      <div className="summary-card-body">
        <div className="summary-row">
          <span>Spent this turn</span>
          <b>{money(p.spent)}</b>
        </div>
        {p.conflicts.length > 0 ? (
          <div className="summary-clash">
            <div className="summary-row">
              <span>Lost in clashes</span>
              <b>−{money(lost)}</b>
            </div>
            {p.conflicts.slice(0, 3).map((c) => (
              <small key={c.regionId + c.step}>
                vs {c.rivals.map((r) => playerOf(s, r).party.name).join(", ")} · {trackName(c.regionId)} · both moved to step {c.step}
              </small>
            ))}
            {p.conflicts.length > 3 && (
              <small>
                + {p.conflicts.length - 3} more: {p.conflicts.slice(3).map((c) => trackName(c.regionId)).join(", ")}
              </small>
            )}
          </div>
        ) : (
          <div className="summary-clash none">
            <div className="summary-row">
              <span>Clashes</span>
              <b>None</b>
            </div>
          </div>
        )}
        {(p.groupsGained.length > 0 || p.groupsLost.length > 0 || (p.income && Object.keys(p.income.groups).length > 0)) && (
          <div className="summary-groups">
            <small className="summary-label">GROUPS</small>
            {p.groupsGained.map((g) => (
              <div key={`+${g}`} className="summary-row">
                <span>
                  <b className="gain">+ Gained</b> {groupName(g)}
                </span>
              </div>
            ))}
            {p.groupsLost.map((g) => (
              <div key={`-${g}`} className="summary-row">
                <span>
                  <b className="loss">− Lost</b> {groupName(g)}
                </span>
              </div>
            ))}
            {p.income &&
              Object.entries(p.income.groups).map(([g, v]) => {
                const mod = Math.round(groupModifier(pack, player, g));
                return (
                  <div key={g} className="summary-row">
                    <span>
                      {groupName(g)} {mod !== 0 && <small className={mod > 0 ? "gain" : "loss"}>({mod > 0 ? "+" : ""}{mod}%)</small>}
                    </span>
                    <span>{money(v)}</span>
                  </div>
                );
              })}
          </div>
        )}
        {p.locked.length > 0 && <small className="summary-note">Locked {p.locked.map(trackName).join(", ")} for good</small>}
        {p.picked && <small className="summary-note">Signed up {candidateName(p.picked)}</small>}
        {income !== null && (
          <div className="summary-income" {...(you ? { "data-testid": "income" } : {})}>
            <div className="summary-row">
              <span>Next turn's income</span>
              <b>{money(income)}</b>
            </div>
            {you && (
              <small>
                Base {money(p.income!.base)}
                {Object.entries(p.income!.groups).map(([g, v]) => ` · ${groupName(g)} ${money(v)}`)}
              </small>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
