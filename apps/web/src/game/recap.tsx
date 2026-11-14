/** News ticker, BREAKING cards, the animated turn recap and the turn summary. */
import { useEffect } from "react";
import { updateSettings, useSettings } from "./settings";
import type { GameState, Headline, PartySummary } from "@majority-map/core";
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

function partyRow(s: GameState, p: PartySummary, game: GameApi) {
  const change = p.seatsAfter - p.seatsBefore;
  return (
    <tr key={p.playerId} className={game.humans.includes(p.playerId) ? "you" : ""}>
      <td>
        <i className="chip" style={{ background: color(s, p.playerId) }} />
        {playerOf(s, p.playerId).party.name}
        {game.solo && p.playerId === game.humans[0] ? " (you)" : ""}
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
  const incomes = report.summary.parties.filter((p) => game.humans.includes(p.playerId) && p.income);
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
              <th>{presidential() ? "EV" : "Seats"}</th>
              <th>Spent</th>
              <th>Conflicts</th>
              <th>Groups</th>
            </tr>
          </thead>
          <tbody>{report.summary.parties.map((p) => partyRow(s, p, game))}</tbody>
        </table>
        {incomes.map((p) => (
          <div className="income" data-testid="income" key={p.playerId}>
            <b>
              {game.solo ? "Your" : `${playerOf(s, p.playerId).party.name}:`} income next turn: {money(p.income!.base + Object.values(p.income!.groups).reduce((a, b) => a + b, 0))}
            </b>
            <span className="small">
              Base {money(p.income!.base)}
              {Object.entries(p.income!.groups).map(([g, v]) => ` · ${groupName(g)} ${money(v)}`)}
            </span>
          </div>
        ))}
        {report.summary.finalTurnNext && <p className="final-note">Every region is now in contention: next turn is the FINAL TURN.</p>}
        <button type="button" className="primary" onClick={game.backToPlanning} data-testid="continue">
          {game.result ? "See the results" : game.state.phase === "final" ? "Play the final turn" : `Plan turn ${game.state.turn}`}
        </button>
      </div>
    </div>
  );
}
