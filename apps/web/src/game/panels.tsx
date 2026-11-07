import {
  canPick,
  controllers,
  eligibleWallets,
  groupModifier,
  majority,
  meterOf,
  moveCost,
  pickPool,
  projectedSeats,
  totalMoney,
  type AiLevel,
  type GameState,
  type Plan,
} from "@majority-map/core";
import type { GameApi } from "./useGame";
import { candidate, candidateName, groupName, money, pack, planLines, plannedPlayer, playerOf, trackName } from "./model";

const LEVEL_NAME: Record<AiLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
const partyName = (s: GameState, id: string) => playerOf(s, id).party.name;
const partyColor = (s: GameState, id: string) => playerOf(s, id).party.color;

function Chip({ color }: { color: string }) {
  return <i className="chip" style={{ background: color }} />;
}

export function TopBar({ game, onMenu, onSettings }: { game: GameApi; onMenu?: () => void; onSettings?: () => void }) {
  // During the recap the bar shows the board as it was before the turn, so the reveal isn't given away.
  const state = game.stage === "recap" && game.report ? game.report.before : game.state;
  const { issues } = game;
  const seats = projectedSeats(pack, state);
  const total = pack.regions.reduce((a, r) => a + r.seats, 0);
  const contention = pack.regions.filter((r) => state.players.some((p) => meterOf(state, r.id, p.id).steps >= pack.rules.contentionAt)).length;
  const order = [...state.players].sort((a, b) => (a.id === game.viewer ? -1 : b.id === game.viewer ? 1 : (seats[b.id] ?? 0) - (seats[a.id] ?? 0)));
  const final = state.phase === "final";
  return (
    <header className="topbar">
      {(onMenu || onSettings) && (
        <div className="game-menu">
          {onMenu && (
            <button type="button" onClick={onMenu} aria-label="Main menu" data-testid="menu-button">
              ☰
            </button>
          )}
          {onSettings && (
            <button type="button" onClick={onSettings} aria-label="Settings" data-testid="settings-button">
              ⚙
            </button>
          )}
        </div>
      )}
      <div className={`turn${final ? " final" : ""}`} data-testid="turn">
        <b>{game.stage === "results" ? "Result" : final ? "FINAL TURN" : `Turn ${state.turn}`}</b>
        <span>{state.round > 1 ? "Second round · " : ""}United Kingdom</span>
      </div>
      <div className="tally-wrap">
        <div className="tally" role="img" aria-label={`Projected seats: ${order.map((p) => `${p.party.name} ${seats[p.id] ?? 0}`).join(", ")}`}>
          {order.map((p) => (
            <div key={p.id} style={{ width: `${(100 * (seats[p.id] ?? 0)) / total}%`, background: p.party.color, paddingLeft: seats[p.id] ? 8 : 0 }}>
              <span>{seats[p.id] ? seats[p.id] : ""}</span>
            </div>
          ))}
          <em style={{ left: `${(100 * majority(pack)) / total}%` }} />
        </div>
        <div className="tally-note">
          <span>Projected seats if the election were today</span>
          <span>{majority(pack)} FOR A MAJORITY</span>
        </div>
      </div>
      <div className="contention">
        <span>IN CONTENTION</span>
        <b>
          {contention} / {pack.regions.length}
        </b>
      </div>
      {game.stage !== "results" && (
        <button type="button" className="submit" disabled={issues.length > 0 || state.phase === "finished" || game.stage !== "planning"} onClick={game.submit} data-testid="submit">
          Submit turn
        </button>
      )}
    </header>
  );
}

function Meter({ state, trackId, playerId, plannedTo }: { state: GameState; trackId: string; playerId: string; plannedTo?: number | undefined }) {
  const steps = meterOf(state, trackId, playerId).steps;
  const color = partyColor(state, playerId);
  return (
    <div className="meter" role="img" aria-label={`${partyName(state, playerId)}: ${steps} of ${pack.rules.steps} steps`}>
      {Array.from({ length: pack.rules.steps }, (_, i) => {
        const n = i + 1;
        const filled = n <= steps;
        const planned = !filled && plannedTo !== undefined && n <= plannedTo;
        return (
          <span
            key={n}
            className={`cell${planned ? " planned" : ""}${n === pack.rules.contentionAt ? " notch" : ""}`}
            style={filled ? { background: color } : planned ? { borderColor: color } : undefined}
          />
        );
      })}
    </div>
  );
}

export function TrackCard({ game, trackId, onClose }: { game: GameApi; trackId: string; onClose: () => void }) {
  const { state, plan } = game;
  const region = pack.regions.find((r) => r.id === trackId);
  const mine = meterOf(state, trackId, game.viewer);
  const planned = plan.steps?.[trackId];
  const locked = state.locked[trackId] !== undefined;
  const max = mine.entered ? pack.rules.steps : Math.min(pack.rules.steps, pack.rules.firstEntryMax);
  const target = planned ?? Math.min(max, mine.steps + 1);
  const you = plannedPlayer(state, plan, game.viewer);
  const cost = target > mine.steps ? moveCost(pack, you, trackId, mine.steps, target) : 0;
  const canAdd = !locked && mine.steps < max && state.phase !== "finished";
  const wallets = eligibleWallets(pack, trackId).filter((w) => (you.wallets[w] ?? 0) > 0);
  const ranking = [...state.players].sort((a, b) => meterOf(state, trackId, b.id).steps - meterOf(state, trackId, a.id).steps);
  return (
    <section className="card" data-testid="region-card">
      <div className="card-head">
        <h2>{trackName(trackId)}</h2>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted">
        {region ? `${region.seats} seats` : "National group · its own meter"}
        {locked ? ` · locked by ${partyName(state, state.locked[trackId]!)}` : ""}
      </p>
      <div className="meters">
        {ranking.map((p) => (
          <div key={p.id} className="meter-row">
            <span className="who">
              <Chip color={p.party.color} />
              {game.label(p.id)}
            </span>
            <Meter state={state} trackId={trackId} playerId={p.id} plannedTo={p.id === game.viewer ? planned : undefined} />
            <b>{meterOf(state, trackId, p.id).steps}</b>
          </div>
        ))}
      </div>
      {canAdd ? (
        <div className="planner">
          <div className="stepper">
            <button type="button" aria-label="One step less" disabled={target <= mine.steps + 1} onClick={() => game.setTarget(trackId, target - 1)}>
              −
            </button>
            <div>
              <small>TARGET</small>
              <b data-testid="target">Step {target}</b>
            </div>
            <button type="button" aria-label="One step more" disabled={target >= max} onClick={() => game.setTarget(trackId, target + 1)}>
              +
            </button>
          </div>
          <div className="cost">
            <b>{money(cost)}</b>
            <small>
              for {target - mine.steps} step{target - mine.steps === 1 ? "" : "s"}
              {!mine.entered ? ` · first entry: up to ${pack.rules.firstEntryMax}` : ""}
            </small>
          </div>
          {planned === undefined ? (
            <button type="button" className="primary" onClick={() => game.setTarget(trackId, target)} data-testid="add-to-plan">
              Add to plan
            </button>
          ) : (
            <button type="button" onClick={() => game.setTarget(trackId, null)}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <p className="muted">{locked ? "Nobody can invest here any more." : mine.steps >= pack.rules.steps ? "Your meter is full." : ""}</p>
      )}
      {wallets.length > 0 && <p className="small">Group money you can spend here: {wallets.map((w) => `${groupName(w)} ${money(you.wallets[w] ?? 0)}`).join(" · ")}</p>}
    </section>
  );
}

export function PlanPanel({ game, onOpen }: { game: GameApi; onOpen: (id: string) => void }) {
  const { state, plan, issues } = game;
  const lines = planLines(state, plan, game.viewer);
  const total = lines.reduce((a, l) => a + l.cost, 0);
  const you = playerOf(state, game.viewer);
  return (
    <section>
      <h3>Your plan</h3>
      {lines.length === 0 ? (
        <p className="muted">Tap a region to plan steps there.</p>
      ) : (
        <table className="list" data-testid="plan-list">
          <tbody>
            {lines.map((l) => (
              <tr key={l.trackId} onClick={() => onOpen(l.trackId)}>
                <td>{trackName(l.trackId)}</td>
                <td>
                  {l.from} → {l.to}
                </td>
                <td className={l.paidFrom ? "" : "bad"}>{money(l.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="sums">
        <span>Plan total</span>
        <b>{money(total)}</b>
        <span>Your money</span>
        <b data-testid="money">{money(totalMoney(you))}</b>
      </div>
      {issues.length > 0 && (
        <ul className="issues" data-testid="issues">
          {issues.map((i) => (
            <li key={i.code + i.message}>{i.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PartyPanel({ game }: { game: GameApi }) {
  const { state, plan } = game;
  const you = playerOf(state, game.viewer);
  const every = pack.rules.memberPickEvery;
  const nextPick = Math.ceil((state.turn + (canPick(pack, state, game.viewer) ? 0 : 1)) / every) * every;
  const members = [...you.members, ...(plan.pick ? [{ candidateId: plan.pick, regionId: null, assignedTurn: null }] : [])];
  const usedRegions = new Set([...you.members.map((m) => m.regionId), ...Object.values(plan.assign ?? {})]);
  const open = pack.regions.filter((r) => meterOf(state, r.id, game.viewer).entered && !usedRegions.has(r.id) && state.locked[r.id] === undefined);
  const leader = candidate(you.leaderId);
  return (
    <section data-testid="party-panel">
      <h3>{you.party.name}</h3>
      <p className="muted">
        Leader {leader.name} ({leader.affiliation}) · picks every {every} turns, next on turn {nextPick}
      </p>
      {canPick(pack, state, game.viewer) && (
        <div className="pick">
          <label htmlFor="pick">Pick a party member (from any party)</label>
          <select id="pick" value={plan.pick ?? ""} onChange={(e) => game.setPick(e.target.value || null)} data-testid="pick">
            <option value="">Choose…</option>
            {pickPool(pack, state, game.viewer).map((id) => (
              <option key={id} value={id}>
                {candidateName(id)} · {candidate(id).affiliation}
              </option>
            ))}
          </select>
        </div>
      )}
      {members.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <ul className="members">
          {members.map((m) => {
            const c = candidate(m.candidateId);
            const planned = plan.assign?.[m.candidateId];
            const since = m.assignedTurn === null ? 0 : state.turn - m.assignedTurn;
            // Free pips land at the end of the turns 3, 6, 9... after assignment; this counts the current turn.
            const every = pack.rules.freePipEvery;
            const nextPip = ((every - (since % every)) % every) + 1;
            return (
              <li key={m.candidateId}>
                <div>
                  <b>{c.name}</b> <small>{c.affiliation}</small>
                  <div className="small">
                    {Object.entries(c.modifiers)
                      .map(([g, v]) => `${groupName(g)} ${pct((v * pack.rules.memberSharePct) / 100)}`)
                      .join(" · ")}
                  </div>
                </div>
                {m.regionId ? (
                  <span className="tag">
                    {trackName(m.regionId)} · free pip in {nextPip} turn{nextPip === 1 ? "" : "s"}
                  </span>
                ) : (
                  <select aria-label={`Assign ${c.name}`} value={planned ?? ""} onChange={(e) => game.setAssign(m.candidateId, e.target.value || null)} data-testid={`assign-${m.candidateId}`}>
                    <option value="">{open.length ? "Assign to…" : "Waiting: enter a region first"}</option>
                    {[...open, ...(planned ? pack.regions.filter((r) => r.id === planned) : [])].map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="small">Each member adds 20% of their bonuses and penalties, and a free pip every {pack.rules.freePipEvery} turns in their region.</p>
    </section>
  );
}

export function GroupsPanel({ game, onOpen }: { game: GameApi; onOpen: (id: string) => void }) {
  const { state } = game;
  const ctrl = controllers(pack, state);
  const you = playerOf(state, game.viewer);
  const row = (id: string) => {
    const g = pack.groups.find((x) => x.id === id)!;
    const owner = ctrl[id];
    return (
      <tr key={id} onClick={g.kind === "national" ? () => onOpen(id) : undefined} className={g.kind === "national" ? "link" : ""}>
        <td>
          {owner ? <Chip color={partyColor(state, owner)} /> : <Chip color="#ffffff" />}
          {g.name}
        </td>
        <td>{money(g.income)}</td>
        <td>{pct(groupModifier(pack, you, id))}</td>
        <td>{money(you.wallets[id] ?? 0)}</td>
      </tr>
    );
  };
  return (
    <section data-testid="groups-panel">
      <h3>Groups</h3>
      <table className="list groups">
        <thead>
          <tr>
            <th>Region groups</th>
            <th>Income</th>
            <th>You</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>{pack.groups.filter((g) => g.kind === "state").map((g) => row(g.id))}</tbody>
        <thead>
          <tr>
            <th colSpan={4}>National groups · tap to open their meter</th>
          </tr>
        </thead>
        <tbody>{pack.groups.filter((g) => g.kind === "national").map((g) => row(g.id))}</tbody>
      </table>
      <p className="small">A region group goes to whoever leads regions worth more than half its campaign cost; a national group to whoever leads its meter with 3+ steps. Group money is spent first, smallest wallet first.</p>
    </section>
  );
}

export function RivalsPanel({ game, highlight, onHighlight }: { game: GameApi; highlight: string | null; onHighlight: (id: string | null) => void }) {
  const { state } = game;
  const seats = projectedSeats(pack, state);
  const ctrl = controllers(pack, state);
  return (
    <section data-testid="rivals-panel">
      <h3>Rivals</h3>
      {state.players
        .filter((p) => p.id !== game.viewer)
        .map((p) => {
          const groups = Object.entries(ctrl).filter(([, o]) => o === p.id).map(([g]) => groupName(g));
          return (
            <div key={p.id} className={`rival${highlight === p.id ? " on" : ""}`}>
              <div className="rival-head">
                <Chip color={p.party.color} />
                <b>{p.party.name}</b>
                <span className="tag">{game.levelOf(p.id) ? `AI · ${LEVEL_NAME[game.levelOf(p.id)!]}` : "Human"}</span>
              </div>
              <p className="small">
                Leader {candidateName(p.leaderId)} · {seats[p.id] ?? 0} seats projected · money at turn start {money(totalMoney(p))}
              </p>
              <p className="small">Groups: {groups.length ? groups.join(", ") : "none"}</p>
              <button type="button" onClick={() => onHighlight(highlight === p.id ? null : p.id)}>
                {highlight === p.id ? "Hide on map" : "Show what they lead"}
              </button>
            </div>
          );
        })}
    </section>
  );
}

export type Tab = "plan" | "party" | "groups" | "rivals";
export const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "party", label: "Party" },
  { id: "groups", label: "Groups" },
  { id: "rivals", label: "Rivals" },
];

export type { Plan };
