/** News ticker, BREAKING cards, the animated turn recap and the turn summary. */
import { useEffect, useState } from "react";
import type { GameState, Headline, PartySummary } from "@majority-map/core";
import { candidateName, groupName, money, pack, playerOf, trackName, YOU } from "./model";
import type { GameApi, TurnReport } from "./useGame";

const HIDE_KEY = "mm.ticker.hidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The always-visible news bar from the fictional MMN channel. It can be hidden; the choice is remembered. */
export function Ticker({ headlines }: { headlines: Headline[] }) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    setHidden((h) => {
      try {
        localStorage.setItem(HIDE_KEY, h ? "0" : "1");
      } catch {
        // Private windows can refuse storage; the ticker still toggles for this visit.
      }
      return !h;
    });
  };
  if (hidden) {
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
    <div className="ticker" data-testid="ticker" aria-label="News headlines">
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

const name = (s: GameState, id: string) => (id === YOU ? "You" : playerOf(s, id).party.name);
const color = (s: GameState, id: string) => playerOf(s, id).party.color;

/** What happened in one region this turn, party by party. */
function regionLines(report: TurnReport, regionId: string): { id: string; text: string; bad?: boolean }[] {
  const lines: { id: string; text: string; bad?: boolean }[] = [];
  for (const p of report.summary.parties) {
    for (const m of p.moves.filter((x) => x.regionId === regionId)) lines.push({ id: p.playerId, text: `${m.from} → ${m.to} steps · ${money(m.cost)}${m.firstEntry ? " · first entry" : ""}` });
    for (const c of p.conflicts.filter((x) => x.regionId === regionId)) lines.push({ id: p.playerId, text: `Collided at step ${c.step} with ${c.rivals.map((r) => name(report.after, r)).join(", ")} · lost ${money(c.amount)}`, bad: true });
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

export function RecapPanel({ report, regionId, controls }: { report: TurnReport; regionId: string | null; controls: RecapControls }) {
  const lines = regionId ? regionLines(report, regionId) : [];
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
          <p className="muted">{region.seats} seats</p>
          <ul>
            {lines.map((l, i) => (
              <li key={i} className={l.bad ? "bad" : ""}>
                <i className="chip" style={{ background: color(report.after, l.id) }} />
                <b>{name(report.after, l.id)}</b> {l.text}
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

function partyRow(s: GameState, p: PartySummary) {
  const change = p.seatsAfter - p.seatsBefore;
  return (
    <tr key={p.playerId} className={p.playerId === YOU ? "you" : ""}>
      <td>
        <i className="chip" style={{ background: color(s, p.playerId) }} />
        {p.playerId === YOU ? "Zoogor Party (you)" : playerOf(s, p.playerId).party.name}
      </td>
      <td>
        <b>{p.seatsAfter}</b> <small className={change > 0 ? "up" : change < 0 ? "down" : ""}>{change > 0 ? `+${change}` : change < 0 ? `${change}` : "±0"}</small>
      </td>
      <td>{money(p.spent)}</td>
      <td className="small">
        {p.conflicts.length === 0 ? "—" : p.conflicts.map((c) => `${trackName(c.regionId)}: lost ${money(c.amount)} (with ${c.rivals.map((r) => playerOf(s, r).party.name).join(", ")})`).join("; ")}
      </td>
      <td className="small">
        {[...p.groupsGained.map((g) => `+ ${groupName(g)}`), ...p.groupsLost.map((g) => `− ${groupName(g)}`)].join(", ") || "—"}
      </td>
    </tr>
  );
}

export function SummaryView({ game }: { game: GameApi }) {
  const report = game.report!;
  const s = report.after;
  const mine = report.summary.parties.find((p) => p.playerId === YOU)!;
  const income = mine.income;
  const top = report.headlines[0];
  return (
    <div className="overlay" data-testid="summary">
      <div className="summary">
        <h2>Turn {report.summary.turn} summary</h2>
        {top && (
          <p className="headline-of-turn">
            <span className="breaking-tag">HEADLINE OF THE TURN</span> {top.text}
          </p>
        )}
        <table className="list summary-table">
          <thead>
            <tr>
              <th>Party</th>
              <th>Seats</th>
              <th>Spent</th>
              <th>Conflicts</th>
              <th>Groups</th>
            </tr>
          </thead>
          <tbody>{report.summary.parties.map((p) => partyRow(s, p))}</tbody>
        </table>
        {income && (
          <div className="income" data-testid="income">
            <b>Your income next turn: {money(income.base + Object.values(income.groups).reduce((a, b) => a + b, 0))}</b>
            <span className="small">
              Base {money(income.base)}
              {Object.entries(income.groups).map(([g, v]) => ` · ${groupName(g)} ${money(v)}`)}
            </span>
          </div>
        )}
        {report.summary.finalTurnNext && <p className="final-note">Every region is now in contention: next turn is the FINAL TURN.</p>}
        <button type="button" className="primary" onClick={game.backToPlanning} data-testid="continue">
          {game.result ? "See the results" : game.state.phase === "final" ? "Play the final turn" : `Plan turn ${game.state.turn}`}
        </button>
      </div>
    </div>
  );
}
