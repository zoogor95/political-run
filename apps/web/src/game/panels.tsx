import {
  canPick,
  controllers,
  eligibleWallets,
  groupCampaignCost,
  groupModifier,
  incomeMultiplier,
  luckWeights,
  majority,
  meterOf,
  moveCost,
  personality,
  pickPool,
  projectedSeats,
  regionLeader,
  regionSeats,
  stepCost,
  STRATEGIES,
  trackBaseCost,
  totalMoney,
  totalSeats,
  type AiLevel,
  type GameState,
  type Plan,
} from "@majority-map/core";
import type { CustomCandidate } from "@majority-map/core";
import { Portrait, toAvatar } from "./Portrait";
import { overspends, type GameApi } from "./useGame";
import { candidate, candidateName, groupName, map, money, pack, planLines, plannedPlayer, playerOf, presidential, trackName, votesWord } from "./model";

const LEVEL_NAME: Record<AiLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
const partyName = (s: GameState, id: string) => playerOf(s, id).party.name;
const partyColor = (s: GameState, id: string) => playerOf(s, id).party.color;

function Chip({ color }: { color: string }) {
  return <i className="chip" style={{ background: color }} />;
}

/** Ink or white, whichever reads better on a colour (WCAG relative luminance). */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.071 ? "#fff" : "#2b2440";
}

/** A party's name as a short label for the tally: its first word, in capitals. */
const shortName = (name: string) => (name.trim().split(/\s+/)[0] ?? "").toUpperCase().slice(0, 9);

export function TopBar({ game, onMenu, onSettings, onResign }: { game: GameApi; onMenu?: () => void; onSettings?: () => void; onResign?: () => void }) {
  // During the recap the bar shows the board as it was before the turn, so the reveal isn't given away.
  const state = game.stage === "recap" && game.report ? game.report.before : game.state;
  const { issues } = game;
  const counted = game.stage === "results" ? game.election?.result.seats : undefined;
  const seats = counted ?? projectedSeats(pack, state);
  const total = totalSeats(pack);
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
          {onResign && game.canResign && (
            <button type="button" onClick={onResign} aria-label="Resign" title="Resign" data-testid="resign-button">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 21V4" />
                <path d="M5 4h12l-2.5 4L17 12H5" fill="#fff" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div className={`turn${final ? " final" : ""}`} data-testid="turn">
        <b>{game.stage === "results" ? "Result" : final ? "FINAL TURN" : `Turn ${state.turn}`}</b>
        <span>
          {state.round > 1 ? "Second round · " : ""}
          {map.name} · {total} {votesWord()}
        </span>
      </div>
      <div className="tally-wrap" data-testid="tally">
        <div className="tally" role="img" aria-label={`Projected ${votesWord()}: ${order.map((p) => `${p.party.name} ${seats[p.id] ?? 0}`).join(", ")}`}>
          {order.map((p) => {
            const n = seats[p.id] ?? 0;
            const share = (100 * n) / total;
            // Wide enough segments carry the party's short name too, as on the design's board.
            const text = share >= 9 ? `${shortName(p.party.name)} ${n}` : share >= 2.5 ? String(n) : "";
            return (
              <div key={p.id} style={{ width: `${share}%`, background: p.party.color, color: textOn(p.party.color), paddingLeft: n ? 8 : 0 }}>
                <span>{text}</span>
              </div>
            );
          })}
          <em style={{ left: `${(100 * majority(pack)) / total}%` }} />
        </div>
        <div className="tally-note">
          <span>
            {presidential()
              ? counted
                ? "Electoral votes won"
                : "Electoral votes if the election were today"
              : counted
                ? "Seats won"
                : state.luck
                  ? "Expected seats if the election were today (luck factor on)"
                  : "Projected seats if the election were today"}
          </span>
          <span>
            {majority(pack)} {presidential() ? "TO WIN" : "FOR A MAJORITY"}
            {(() => {
              const me = state.players.find((p) => p.id === game.viewer);
              if (!me || counted) return null;
              const short = shortName(me.party.name);
              const need = majority(pack) - (seats[me.id] ?? 0);
              return need > 0 ? ` · ${short} needs ${need} more` : ` · ${short} would win`;
            })()}
          </span>
        </div>
      </div>
      <div className="contention" data-testid="contention">
        <span className="contention-row">
          <span>IN CONTENTION</span>
          <b>
            {contention} / {pack.regions.length}
          </b>
        </span>
        <span className="contention-bar" aria-hidden="true">
          <i style={{ width: `${(100 * contention) / pack.regions.length}%` }} />
        </span>
      </div>
      {game.stage !== "results" && (
        <button
          type="button"
          className="submit"
          disabled={issues.length > 0 || state.phase === "finished" || game.stage !== "planning" || Boolean(game.online && (game.online.sent || game.online.spectating || !game.online.connected))}
          onClick={game.submit}
          data-testid="submit"
          title={game.online?.waitingFor.length ? `Waiting for ${game.online.waitingFor.map(game.label).join(", ")}` : undefined}
        >
          {game.watching && !game.online ? "Next turn" : !game.online ? "Submit turn" : game.online.spectating ? "Watching" : !game.online.connected ? "Reconnecting…" : game.online.sent ? "Waiting…" : "Submit turn"}
        </button>
      )}
    </header>
  );
}

function Meter({ state, trackId, playerId, plannedTo }: { state: GameState; trackId: string; playerId: string; plannedTo?: number | undefined }) {
  const steps = meterOf(state, trackId, playerId).steps;
  const color = partyColor(state, playerId);
  return (
    <div className="meter" role="img" aria-label={`${partyName(state, playerId)}: ${steps} of ${pack.rules.steps} steps`} style={{ gridTemplateColumns: `repeat(${pack.rules.steps}, minmax(0, 1fr))` }}>
      {Array.from({ length: pack.rules.steps }, (_, i) => {
        const n = i + 1;
        const filled = n <= steps;
        const planned = !filled && plannedTo !== undefined && n <= plannedTo;
        return (
          <span
            key={n}
            className={`cell${planned ? " planned" : ""}${n === pack.rules.contentionAt ? " notch" : ""}${n === pack.rules.steps && !filled ? " lock" : ""}`}
            style={filled ? { background: color, borderColor: "#2b2440" } : planned ? { borderColor: color, background: `color-mix(in srgb, ${color} 25%, #fff)` } : undefined}
          />
        );
      })}
    </div>
  );
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

/** A party's face on the region card: a custom candidate's portrait, or the leader's initials on the party colour. */
function Face({ state, playerId, size = 44 }: { state: GameState; playerId: string; size?: number }) {
  const p = playerOf(state, playerId);
  const c = candidate(p.leaderId);
  if (c && "custom" in c) return <Portrait avatar={toAvatar((c as CustomCandidate).avatar)} size={size} label={`Portrait of ${c.name}`} />;
  return (
    <span className="face" style={{ width: size, height: size, background: `color-mix(in srgb, ${p.party.color} 22%, #fff)`, borderColor: p.party.color }} aria-hidden="true">
      {initialsOf(candidateName(p.leaderId))}
    </span>
  );
}

const voters = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(n / 1000)}K`);

/**
 * The region card (design: Region card and Parliamentary region card): the region's band, its groups, seats, your next
 * step's cost and voters, every party's meter (your planned steps dashed), the seats now and with your plan, your
 * member there, what your plan would do against the rivals, and the one step control.
 */
export function TrackCard({ game, trackId, onClose }: { game: GameApi; trackId: string; onClose: () => void }) {
  const { state, plan } = game;
  const region = pack.regions.find((r) => r.id === trackId);
  const national = pack.groups.find((g) => g.id === trackId && g.kind === "national");
  const mine = meterOf(state, trackId, game.viewer);
  const planned = plan.steps?.[trackId];
  const locked = state.locked[trackId] !== undefined;
  const max = mine.entered ? pack.rules.steps : Math.min(pack.rules.steps, pack.rules.firstEntryMax);
  // What the stepper shows: the planned step, or where you are now when nothing is planned here.
  const shown = planned ?? mine.steps;
  const you = plannedPlayer(state, plan, game.viewer);
  const cost = shown > mine.steps ? moveCost(pack, you, trackId, mine.steps, shown) : 0;
  const canAdd = !locked && mine.steps < max && state.phase !== "finished";
  // One more step only if the whole plan can still be paid for (group money only counts where it may be spent).
  const affordable = shown < max && !overspends(state, game.viewer, { ...plan, steps: { ...(plan.steps ?? {}), [trackId]: shown + 1 } });
  const stepAfter = shown < max ? moveCost(pack, you, trackId, mine.steps, shown + 1) - cost : 0;
  const wallets = eligibleWallets(pack, trackId).filter((w) => (you.wallets[w] ?? 0) > 0);
  const ranking = [...state.players].sort((a, b) => meterOf(state, trackId, b.id).steps - meterOf(state, trackId, a.id).steps);
  const top = ranking[0] && meterOf(state, trackId, ranking[0].id).steps > 0 ? ranking[0] : null;
  const band = locked ? partyColor(state, state.locked[trackId]!) : top ? top.party.color : "#3b5a8c";
  // Your next step at full price and with your leader's (and members') group bonuses.
  const nextStep = Math.min(pack.rules.steps, shown + 1);
  const nextCost = stepCost(pack, you, trackId, nextStep);
  const fullCost = Math.max(1000, Math.round((trackBaseCost(pack, trackId) * pack.rules.costGrowth ** (nextStep - 1)) / 1000) * 1000);
  const line = planLines(state, plan, game.viewer).find((l) => l.trackId === trackId);
  // Seats in this region now, and if your plan goes through as it stands (rivals' moves aren't known).
  const seatsNow = region ? (regionSeats(pack, state)[trackId] ?? {}) : null;
  const seatsPlanned = (() => {
    if (!region || planned === undefined) return null;
    const next = structuredClone(state);
    const m = next.meters[trackId]![game.viewer]!;
    m.steps = planned;
    m.entered = true;
    return regionSeats(pack, next)[trackId] ?? {};
  })();
  const member = playerOf(state, game.viewer).members.find((m) => m.regionId === trackId);
  // What the plan does against the parties already here: lead, tie (a clash if they move to the same step) or trail.
  const rivals = state.players.filter((p) => p.id !== game.viewer).map((p) => ({ p, steps: meterOf(state, trackId, p.id).steps }));
  const best = rivals.reduce<{ p: (typeof rivals)[number]["p"]; steps: number } | null>((a, r) => (!a || r.steps > a.steps ? r : a), null);
  const tied = planned !== undefined ? rivals.filter((r) => r.steps === planned) : [];
  return (
    <section className="card region-card" data-testid="region-card">
      <div className="region-band" style={{ background: band, color: textOn(band) }}>
        <div className="region-title">
          <h2>{trackName(trackId)}</h2>
          <span>
            {region ? `${presidential() ? "State" : "Investment region"} · ${region.seats} ${votesWord()}` : "National group · its own meter"}
            {locked ? ` · locked by ${partyName(state, state.locked[trackId]!)}` : top ? ` · ${game.label(top.id)} ${game.label(top.id) === "You" ? "lead" : "leads"}` : ""}
          </span>
        </div>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {region && <RegionGroups state={state} regionId={region.id} viewer={game.viewer} />}
      <div className="region-stats">
        <div>
          <small>{region ? (presidential() ? "ELECTORAL VOTES" : "SEATS") : "INCOME"}</small>
          <b>{region ? region.seats : money(national?.income ?? 0)}</b>
        </div>
        <div>
          <small>YOUR STEP {nextStep} COST</small>
          <b>
            {money(nextCost)}
            {fullCost !== nextCost && <s>{money(fullCost)}</s>}
          </b>
        </div>
        <div>
          <small>{region ? "VOTERS" : "HELD BY"}</small>
          <b>{region ? voters(region.voters ?? 0) : (() => {
            const owner = controllers(pack, state)[trackId];
            return owner ? game.label(owner) : "Nobody";
          })()}</b>
        </div>
      </div>
      <div className="meters">
        <div className="meters-head">
          <span>STEPS ({pack.rules.steps})</span>
          <span>
            CONTENTION AT {pack.rules.contentionAt} · LOCK AT {pack.rules.steps}
          </span>
        </div>
        {ranking.map((p, i) => {
          const steps = meterOf(state, trackId, p.id).steps;
          const own = p.id === game.viewer;
          return (
            <div key={p.id} className={`meter-row${own ? " own" : ""}`}>
              <Face state={state} playerId={p.id} />
              <Meter state={state} trackId={trackId} playerId={p.id} plannedTo={own ? planned : undefined} />
              <b className="who">
                {game.label(p.id) === "You" ? "You" : p.party.name.split(/\s+/).slice(0, 2).join(" ")} {steps}
                {own && planned !== undefined ? ` → ${planned}` : i === 0 && steps > 0 && !own ? " · leads" : ""}
              </b>
            </div>
          );
        })}
      </div>
      {region && state.luck && <LuckOdds state={state} regionId={region.id} label={game.label} />}
      {(seatsNow || member || (planned !== undefined && best)) && (
        <div className="region-extra">
          {seatsNow && (
            <div className="region-seats" data-testid="region-seats">
              <small>{presidential() ? `LEADER TAKES ALL ${region!.seats}` : "SEATS FROM PIP SHARE"} · NOW{seatsPlanned ? " → WITH YOUR PLAN" : ""}</small>
              {[seatsNow, ...(seatsPlanned ? [seatsPlanned] : [])].map((s, k) => (
                <div key={k} className="share-bar" aria-hidden="true">
                  {state.players
                    .filter((p) => (s[p.id] ?? 0) > 0)
                    .map((p) => (
                      <span key={p.id} style={{ width: `${(100 * (s[p.id] ?? 0)) / region!.seats}%`, background: p.party.color }} />
                    ))}
                </div>
              ))}
              <span>
                {state.players
                  .filter((p) => (seatsNow[p.id] ?? 0) > 0 || (seatsPlanned?.[p.id] ?? 0) > 0)
                  .map((p) => `${game.label(p.id) === "You" ? "You" : p.party.name.split(/\s+/)[0]} ${seatsNow[p.id] ?? 0}${seatsPlanned ? ` → ${seatsPlanned[p.id] ?? 0}` : ""}`)
                  .join(" · ") || `No one has ${votesWord()} here yet`}
              </span>
            </div>
          )}
          {planned !== undefined && best && (
            <div className="region-hint" data-testid="region-hint">
              <b>
                +{planned - mine.steps} step{planned - mine.steps === 1 ? "" : "s"}:{" "}
                {tied.length
                  ? `you'd be level with ${tied.map((r) => r.p.party.name).join(" and ")} at ${planned}`
                  : planned > best.steps
                    ? `you'd lead ${planned} to ${best.steps}, if ${best.p.party.name} doesn't also move`
                    : `still behind ${best.p.party.name} (${best.steps})`}
              </b>
              <small>Moving to the same step as a rival is a clash: both lose the money for that move.</small>
            </div>
          )}
          {member && (
            <div className="region-member">
              <span className="face" style={{ width: 44, height: 44, background: `color-mix(in srgb, ${playerOf(state, game.viewer).party.color} 22%, #fff)`, borderColor: playerOf(state, game.viewer).party.color }} aria-hidden="true">
                {initialsOf(candidateName(member.candidateId))}
              </span>
              <span>
                <small>PARTY MEMBER HERE</small>
                <b>{candidateName(member.candidateId)}</b>
                <em>
                  +1 free pip every {pack.rules.freePipEvery} turns · never part of a clash
                </em>
              </span>
            </div>
          )}
        </div>
      )}
      {wallets.length > 0 && <p className="small">Group money you can spend here: {wallets.map((w) => `${groupName(w)} ${money(you.wallets[w] ?? 0)}`).join(" · ")}</p>}
      {canAdd ? (
        // One control: + plans a step (and another), − takes one back, down to nothing planned.
        <div className="planner">
          <div className="stepper">
            <button
              type="button"
              aria-label="One step less"
              disabled={planned === undefined}
              onClick={() => game.setTarget(trackId, shown - 1 > mine.steps ? shown - 1 : null)}
              data-testid="step-down"
            >
              −
            </button>
            <div>
              <small>{planned === undefined ? "NOW" : "TARGET"}</small>
              <b data-testid="target">Step {shown}</b>
            </div>
            <button type="button" aria-label="One step more" disabled={shown >= max || !affordable} onClick={() => game.setTarget(trackId, shown + 1)} data-testid="step-up">
              +
            </button>
          </div>
          <div className="cost">
            {planned === undefined ? (
              <>
                <b>{money(stepCost(pack, you, trackId, mine.steps + 1))}</b>
                <small>
                  for the next step{affordable ? ": press + to plan it" : ""}
                  {!mine.entered ? ` · first entry: up to ${pack.rules.firstEntryMax}` : ""}
                </small>
              </>
            ) : (
              <>
                <b>
                  {money(cost)} for {shown - mine.steps} step{shown - mine.steps === 1 ? "" : "s"}
                </b>
                <small>
                  {shown - mine.steps <= 3
                    ? Array.from({ length: shown - mine.steps }, (_, k) => `step ${mine.steps + k + 1} ${money(stepCost(pack, you, trackId, mine.steps + k + 1))}`).join(" + ")
                    : `steps ${mine.steps + 1} to ${shown}`}
                  {line?.paidFrom ? ` · paid from ${Object.entries(line.paidFrom).map(([w, n]) => `${w === "base" ? "Base" : groupName(w)} ${money(n)}`).join(" + ")}` : ""}
                  {!mine.entered ? ` · first entry: up to ${pack.rules.firstEntryMax}` : ""}
                </small>
              </>
            )}
          </div>
          {planned !== undefined && (
            <button type="button" onClick={() => game.setTarget(trackId, null)} data-testid="remove-steps">
              Remove
            </button>
          )}
          {shown < max && !affordable && (
            <p className="short-money" data-testid="short-money" role="status">
              Not enough money for step {shown + 1} here: it costs {money(stepAfter)} more than your plan can pay. Take steps back elsewhere to free some up.
            </p>
          )}
        </div>
      ) : (
        <p className="muted">{locked ? "Nobody can invest here any more." : mine.steps >= pack.rules.steps ? "Your meter is full." : ""}</p>
      )}
    </section>
  );
}

function RegionGroups({ state, regionId, viewer }: { state: GameState; regionId: string; viewer: string }) {
  const groups = pack.groups.filter((g) => g.kind === "state" && g.regions.includes(regionId));
  if (groups.length === 0) return null;
  const ctrl = controllers(pack, state);
  const you = playerOf(state, viewer);
  return (
    <div className="region-groups" data-testid="region-groups" aria-label="Region groups">
      {groups.map((g) => {
        const owner = ctrl[g.id];
        const mod = Math.round(groupModifier(pack, you, g.id));
        return (
          <span key={g.id} className={`group-chip${mod > 0 ? " plus" : mod < 0 ? " minus" : ""}`} title={owner ? `Held by ${partyName(state, owner)}` : "Nobody holds it yet"}>
            <Chip color={owner ? partyColor(state, owner) : "#ffffff"} />
            {g.name}
            {mod !== 0 && ` · you ${mod > 0 ? "−" : "+"}${Math.abs(mod)}% cost`}
          </span>
        );
      })}
    </div>
  );
}

function LuckOdds({ state, regionId, label }: { state: GameState; regionId: string; label: (id: string) => string }) {
  const weights = luckWeights(state, regionId);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="small muted">Luck factor: nobody has a pip here yet, so nobody can win a seat.</p>;
  return (
    <p className="small" data-testid="luck-odds">
      Chance of each seat:{" "}
      {Object.entries(weights)
        .map(([id, w]) => `${label(id)} ${Math.round((100 * w) / total)}%`)
        .join(" · ")}
    </p>
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
      <MoneySources game={game} lines={lines} />
      <div className="sums">
        <span>Plan total</span>
        <b>{money(total)}</b>
        <span>Your money</span>
        <b data-testid="money">{money(totalMoney(you))}</b>
        <span className="sums-left">Remaining</span>
        <b className={`sums-left${totalMoney(you) - total < 0 ? " bad" : ""}`} data-testid="remaining">
          {money(totalMoney(you) - total)}
        </b>
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

/**
 * Where your money is and where it can go: base money (anywhere), each region group's money (only in that group's
 * regions) and national group money (anywhere), with what the plan takes from each and what's left.
 */
function MoneySources({ game, lines }: { game: GameApi; lines: ReturnType<typeof planLines> }) {
  const you = playerOf(game.state, game.viewer);
  const used: Record<string, number> = {};
  for (const l of lines) for (const [w, n] of Object.entries(l.paidFrom ?? {})) used[w] = (used[w] ?? 0) + n;
  const groups = pack.groups.filter((g) => (you.wallets[g.id] ?? 0) > 0 || (used[g.id] ?? 0) > 0);
  if (groups.length === 0) return null;
  const rows = [
    { id: "base", name: "Base money", where: "anywhere", have: you.money },
    ...groups.map((g) => ({
      id: g.id,
      name: g.name,
      where: g.kind === "national" ? "anywhere" : `only in ${g.regions.length === 1 ? trackName(g.regions[0]!) : `its ${g.regions.length} regions`}`,
      have: you.wallets[g.id] ?? 0,
    })),
  ];
  return (
    <table className="list money-sources" data-testid="money-sources">
      <thead>
        <tr>
          <th>Your money</th>
          <th>Planned</th>
          <th>Left</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              {r.name}
              <small className="muted"> · {r.where}</small>
            </td>
            <td>{used[r.id] ? money(used[r.id]!) : "–"}</td>
            <td>{money(r.have - (used[r.id] ?? 0))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Presidential: your candidate, your ticket and, on turn 5, the running mate pick. */
function TicketPanel({ game }: { game: GameApi }) {
  const { state, plan } = game;
  const you = playerOf(state, game.viewer);
  const leader = candidate(you.leaderId);
  const mateTurn = pack.rules.runningMateTurn ?? 5;
  const mateId = you.members[0]?.candidateId ?? plan.pick;
  const mate = mateId ? candidate(mateId) : null;
  const share = pack.rules.memberSharePct;
  return (
    <section data-testid="party-panel">
      <h3>{leader.name}</h3>
      <p className="muted">
        {leader.affiliation === "Independent" ? "Independent" : `${leader.affiliation} candidate`}
        {you.eliminated !== undefined ? " · eliminated" : ""}
      </p>
      <h3>Running mate</h3>
      {canPick(pack, state, game.viewer) ? (
        <div className="pick">
          <label htmlFor="pick">Pick your running mate (any candidate not running against you)</label>
          <select id="pick" value={plan.pick ?? ""} onChange={(e) => game.setPick(e.target.value || null)} data-testid="pick">
            <option value="">Choose…</option>
            {pickPool(pack, state, game.viewer).map((id) => (
              <option key={id} value={id}>
                {candidateName(id)} · {candidate(id).affiliation}
              </option>
            ))}
          </select>
        </div>
      ) : mate ? null : (
        <p className="muted">{state.turn < mateTurn ? `You pick a running mate on turn ${mateTurn}.` : "You didn't pick a running mate."}</p>
      )}
      {mate && (
        <ul className="members" data-testid="running-mate">
          <li>
            <div>
              <b>{mate.name}</b> <small>{mate.affiliation}</small>
              <div className="small">
                {Object.entries(mate.modifiers)
                  .map(([g, v]) => `${groupName(g)} ${pct((v * share) / 100)}`)
                  .join(" · ")}
              </div>
            </div>
          </li>
        </ul>
      )}
      <p className="small">A running mate adds {share}% of their bonuses and penalties to your ticket from turn {mateTurn}.</p>
    </section>
  );
}

export function PartyPanel({ game }: { game: GameApi }) {
  if (presidential()) return <TicketPanel game={game} />;
  return <MembersPanel game={game} />;
}

function MembersPanel({ game }: { game: GameApi }) {
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
      {"custom" in leader && (
        <div className="leader-card" data-testid="custom-leader">
          <Portrait avatar={toAvatar((leader as CustomCandidate).avatar)} size={56} label={`Portrait of ${leader.name}`} />
          <span>
            <b>{leader.name}</b>
            {(leader as CustomCandidate).bio && <small>{(leader as CustomCandidate).bio}</small>}
          </span>
        </div>
      )}
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

/**
 * Groups (design: State groups): one row per group, edged in the colour of whoever controls it, with your group money
 * (green) or the controller's name. A region group lights up on the board with its detail card; a national group opens
 * its own meter.
 */
export function GroupsPanel({
  game,
  onOpen,
  focus,
  onFocus,
}: {
  game: GameApi;
  onOpen: (id: string) => void;
  /** The region group lit up on the board, if any. */
  focus: string | null;
  onFocus: (groupId: string | null) => void;
}) {
  const { state } = game;
  const ctrl = controllers(pack, state);
  const you = playerOf(state, game.viewer);
  const row = (id: string) => {
    const g = pack.groups.find((x) => x.id === id)!;
    const owner = ctrl[id];
    const national = g.kind === "national";
    const on = focus === id;
    const wallet = you.wallets[id] ?? 0;
    const open = () => (national ? onOpen(id) : onFocus(on ? null : id));
    return (
      <li key={id}>
        <button
          type="button"
          className={`group-row${on ? " on" : ""}`}
          style={{ borderLeftColor: owner ? partyColor(state, owner) : "#c8c2d3" }}
          aria-pressed={on}
          onClick={open}
          data-testid={`group-row-${id}`}
        >
          <span className="group-row-name">
            {g.name}
            <small>
              {national ? "National" : `${g.regions.length} ${presidential() ? (g.regions.length === 1 ? "state" : "states") : g.regions.length === 1 ? "region" : "regions"}`} · {money(g.income)} a turn
            </small>
          </span>
          {wallet > 0 ? (
            <span className="group-badge money" title="Group money you can spend">
              {money(wallet)}
            </span>
          ) : owner ? (
            <span className="group-badge owner" style={{ color: inkOn(partyColor(state, owner)) }}>
              {owner === game.viewer ? (game.solo ? "You" : you.party.name) : groupLabel(playerOf(state, owner).party.name)}
            </span>
          ) : (
            <span className="group-badge open">Open</span>
          )}
        </button>
      </li>
    );
  };
  return (
    <section className="groups-panel" data-testid="groups-panel">
      <h3>{presidential() ? "State groups" : "Region groups"}</h3>
      <ul className="group-rows">{pack.groups.filter((g) => g.kind === "state").map((g) => row(g.id))}</ul>
      <h3>National groups</h3>
      <ul className="group-rows">{pack.groups.filter((g) => g.kind === "national").map((g) => row(g.id))}</ul>
      <p className="small groups-key">
        Green badges show group money you can spend. The coloured edge shows who controls each group. A region group goes to whoever leads {presidential() ? "states" : "regions"} worth more
        than half its campaign cost; a national group to whoever leads its meter with 3+ steps.
      </p>
    </section>
  );
}

/** A party colour dark enough to read as text on white. */
const inkOn = (color: string) => `color-mix(in srgb, ${color} 65%, #2b2440)`;
const groupLabel = (name: string) => name.trim().split(/\s+/).slice(0, presidential() ? 2 : 1).join(" ");

/**
 * The picked region group, over the board (design: State groups): its income, what your bonus or penalty makes of it,
 * each party's share of the group's campaign cost against the half needed, what it takes to win it, and who holds it.
 */
export function GroupDetail({ game, groupId, onClose }: { game: GameApi; groupId: string; onClose: () => void }) {
  const { state } = game;
  const g = pack.groups.find((x) => x.id === groupId)!;
  const you = playerOf(state, game.viewer);
  const total = groupCampaignCost(pack, g);
  const led: Record<string, number> = {};
  const open: string[] = [];
  for (const r of pack.regions) {
    if (!g.regions.includes(r.id)) continue;
    const leader = regionLeader(state, r.id);
    if (leader === null) open.push(r.name);
    else led[leader] = (led[leader] ?? 0) + r.baseCost;
  }
  const owner = controllers(pack, state)[groupId] ?? null;
  const order = Object.entries(led).sort((a, b) => b[1] - a[1]);
  const nobody = total - order.reduce((a, [, n]) => a + n, 0);
  const mod = groupModifier(pack, you, groupId);
  const yours = Math.round(g.income * incomeMultiplier(pack, you, groupId));
  const mine = led[game.viewer] ?? 0;
  const need = Math.max(0, Math.floor(total / 2) + 1 - mine);
  const share = (n: number) => (total ? (100 * n) / total : 0);
  const label = (id: string) => (id === game.viewer ? (game.solo ? "You" : groupLabel(you.party.name)) : groupLabel(playerOf(state, id).party.name));
  const where = presidential() ? "states" : "regions";
  return (
    <section className="group-detail" data-testid="group-detail" aria-label={`${g.name} group`}>
      <div className="group-detail-head">
        <h3>{g.name}</h3>
        <span>
          {g.regions.length} {g.regions.length === 1 ? where.slice(0, -1) : where} · {money(g.income)} a turn to the controller
        </span>
        {mod !== 0 && (
          <span className={mod > 0 ? "good" : "bad"}>
            Your {mod > 0 ? "bonus" : "penalty"} {pct(mod)}: you'd get {money(yours)}
          </span>
        )}
      </div>
      <div className="group-detail-bar">
        <div className="group-detail-labels">
          <span>SHARE OF THE GROUP'S CAMPAIGN COST</span>
          <span>MORE THAN 50% CONTROLS IT</span>
        </div>
        <div className="group-share" role="img" aria-label={`Share of ${g.name}'s campaign cost: ${order.map(([id, n]) => `${label(id)} ${Math.round(share(n))}%`).join(", ") || "nobody leads anywhere"}`}>
          {order.map(([id, n]) => {
            const c = partyColor(state, id);
            return (
              <div key={id} style={{ width: `${share(n)}%`, background: c, color: textOn(c) }}>
                {share(n) >= 14 ? `${label(id)} ${Math.round(share(n))}%` : share(n) >= 6 ? `${Math.round(share(n))}%` : ""}
              </div>
            );
          })}
          {nobody > 0 && <div className="nobody">{share(nobody) >= 18 ? `Nobody leads ${Math.round(share(nobody))}%` : ""}</div>}
          <em />
        </div>
        <span className="group-detail-hint">
          {owner === game.viewer
            ? `You control it: ${money(yours)} a turn goes into your ${g.name} money.`
            : `To take control: lead in ${where} worth ${money(need)} more of the group's cost.`}
          {open.length > 0 && ` ${open.slice(0, 2).join(" and ")}${open.length > 2 ? ` and ${open.length - 2} more` : ""} ${open.length === 1 ? "is" : "are"} still open.`}
        </span>
      </div>
      <div className="group-detail-owner">
        {owner ? (
          <span className="leader-initials" style={{ background: `color-mix(in srgb, ${partyColor(state, owner)} 22%, #fff)`, borderColor: partyColor(state, owner) }} aria-hidden="true">
            {candidateName(playerOf(state, owner).leaderId)
              .split(/\s+/)
              .filter((w) => /^[A-Z]/.test(w))
              .map((w) => w[0])
              .slice(0, 2)
              .join("")}
          </span>
        ) : (
          <span className="leader-initials open" aria-hidden="true">
            ?
          </span>
        )}
        <small>{owner ? label(owner).toUpperCase() : "NOBODY YET"}</small>
        <small className="muted">CONTROLLER</small>
      </div>
      <button type="button" className="group-detail-close" onClick={onClose} aria-label={`Close ${g.name}`}>
        ✕
      </button>
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
                {presidential() ? "Candidate" : "Leader"} {candidateName(p.leaderId)}
                {p.eliminated !== undefined ? " · eliminated" : ` · ${seats[p.id] ?? 0} ${votesWord()} projected`} · money at turn start {money(totalMoney(p))}
              </p>
              <p className="small">Groups: {groups.length ? groups.join(", ") : "none"}</p>
              {(() => {
                const level = game.levelOf(p.id);
                if (!level || level === "easy") return null;
                const style = personality(pack, state, p.id);
                return (
                  <p className="small" data-testid={`rival-style-${p.id}`}>
                    Plays: {STRATEGIES[style.strategy].name} · home turf {style.favourites.map(groupName).join(" and ") || "everywhere"}
                  </p>
                );
              })()}
              <button type="button" onClick={() => onHighlight(highlight === p.id ? null : p.id)}>
                {highlight === p.id ? "Hide on map" : "Show what they lead"}
              </button>
            </div>
          );
        })}
    </section>
  );
}

/**
 * Every party at a glance, as on the design's board: you first, then the rest by projected seats, each with leader,
 * who plays it and the seats; your money underneath. Tap a party to see what it leads on the map.
 */
export function LeadersCard({ game, highlight, onHighlight }: { game: GameApi; highlight: string | null; onHighlight: (id: string | null) => void }) {
  const state = game.stage === "recap" && game.report ? game.report.before : game.state;
  const seats = projectedSeats(pack, state);
  const order = [...state.players].sort((a, b) => (a.id === game.viewer ? -1 : b.id === game.viewer ? 1 : (seats[b.id] ?? 0) - (seats[a.id] ?? 0)));
  const you = state.players.find((p) => p.id === game.viewer);
  return (
    <section className="leaders-card" data-testid="leaders-card" aria-label="Leaders">
      <h3 className="leaders-head">{presidential() ? "CANDIDATES" : "LEADERS"}</h3>
      <ul>
        {order.map((p) => {
          const c = candidate(p.leaderId);
          const custom = c && "custom" in c ? (c as CustomCandidate) : null;
          const level = game.levelOf(p.id);
          const mine = p.id === game.viewer && !game.watching;
          const who = mine ? `${game.solo ? "YOU" : "PLAYING"} · ${p.party.name}` : `${p.party.name} · ${level ? `AI ${LEVEL_NAME[level]}` : "PERSON"}`;
          return (
            <li key={p.id} className={`${mine ? "you" : ""}${highlight === p.id ? " on" : ""}${p.eliminated !== undefined ? " out" : ""}`}>
              <button type="button" onClick={() => onHighlight(highlight === p.id ? null : p.id)} aria-pressed={highlight === p.id} aria-label={`${p.party.name}: show what they lead on the map`}>
                {custom ? (
                  <Portrait avatar={toAvatar(custom.avatar)} size={44} label={`Portrait of ${custom.name}`} />
                ) : (
                  <span className="leader-initials" style={{ background: `color-mix(in srgb, ${p.party.color} 22%, #fff)`, borderColor: p.party.color }} aria-hidden="true">
                    {candidateName(p.leaderId)
                      .split(/\s+/)
                      .filter((w) => /^[A-Z]/.test(w))
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                )}
                <span className="leader-text">
                  <small>
                    <i className="chip" style={{ background: p.party.color }} /> {who.toUpperCase()}
                  </small>
                  <b>
                    {candidateName(p.leaderId)} <em>{custom ? "Your candidate" : (c?.affiliation ?? "")}</em>
                  </b>
                </span>
                <span className="leader-seats">{p.eliminated !== undefined ? "out" : (seats[p.id] ?? 0)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {you && !game.watching && (
        <div className="leaders-money">
          <span>Your money</span>
          <b>{money(totalMoney(you))}</b>
        </div>
      )}
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
