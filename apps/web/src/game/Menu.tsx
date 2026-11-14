/** Main menu, match setup (solo or pass and play) and settings. */
import { useState } from "react";
import type { CustomCandidate } from "@majority-map/core";
import { CandidatePicker } from "./Candidates";
import { CandidateCreator, UnlockCard } from "./Creator";
import { loadCustoms, useCustoms } from "./customs";
import { majority } from "@majority-map/core";
import { MAPS, map, mapDetail, setPreferredMap, type MapId } from "./model";
import { Portrait, toAvatar } from "./Portrait";
import { useOwns } from "./store";
import { TURN_TIMERS,
  COLORS,
  EMBLEMS,
  EMBLEM_NAME,
  EMBLEM_PATH,
  aiSeat,
  checkConfig,
  defaultConfig,
  humanSeat,
  isPresidential,
  withCandidateParties,
  type MatchConfig,
  type Mode,
  type Seat,
} from "./setup";
import { updateSettings, useSettings } from "./settings";
import { applyVolumes, play, startMusic, stopMusic } from "./audio";

const LEVEL_NAME = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

/** An emblem drawn in a party's colour. */
export function EmblemIcon({ emblem, color, size = 24, label }: { emblem: string; color: string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <path d={EMBLEM_PATH[emblem] ?? ""} style={{ fill: color, stroke: "#2b2440", strokeWidth: 2.6, strokeLinejoin: "round", strokeLinecap: "round" }} />
    </svg>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

/** A light tint of a colour, for the portrait's backdrop. */
const tint = (hex: string) => `color-mix(in srgb, ${hex} 22%, #fff)`;

/**
 * One seat at the table, as a card: the party-colour band, the leader's portrait (custom candidates) or initials,
 * the emblem, party and leader. Tapping it opens it in the editor; computer seats switch difficulty right here.
 */
function SeatTile({
  seat,
  index,
  mode,
  selected,
  customs,
  onSelect,
  onLevel,
  onRemove,
}: {
  seat: Seat;
  index: number;
  mode: Mode;
  selected: boolean;
  customs: CustomCandidate[];
  onSelect: () => void;
  onLevel: (level: Seat["level"]) => void;
  onRemove?: (() => void) | undefined;
}) {
  const presidential = isPresidential();
  const custom = customs.find((c) => c.id === seat.leaderId);
  const leader = map.pack.candidates.find((c) => c.id === seat.leaderId);
  const leaderName = custom?.name ?? leader?.name ?? seat.leaderId;
  const tag = seat.kind === "ai" ? "COMPUTER" : seat.id === "you" ? "YOU" : mode === "online" ? "FRIEND" : "PLAYER";
  const order = mode === "hotseat" && seat.kind === "human" ? `PLAYER ${index + 1}` : `SEAT ${index + 1}`;
  return (
    <section className={`seat-tile${selected ? " selected" : ""}`} data-testid={`seat-${seat.id}`}>
      <button type="button" className="seat-tile-pick" onClick={onSelect} aria-pressed={selected} aria-label={`${seat.label}: ${seat.party.name}, led by ${leaderName}. Edit`}>
        <span className="seat-band" style={{ background: seat.party.color }}>
          <span className="seat-order">{order}</span>
          <span className="seat-tag">{tag}</span>
        </span>
        <span className="seat-face">
          {custom ? (
            <Portrait avatar={toAvatar(custom.avatar)} size={80} label={`Portrait of ${custom.name}`} />
          ) : (
            <span className="seat-initials" style={{ background: tint(seat.party.color) }} aria-hidden="true">
              {initials(leaderName)}
            </span>
          )}
          <span className="seat-emblem">
            <EmblemIcon emblem={seat.party.emblem} color={seat.party.color} label={`${EMBLEM_NAME[seat.party.emblem] ?? seat.party.emblem} emblem`} />
          </span>
        </span>
        <span className="seat-body">
          <b className="seat-party">{seat.party.name || seat.label}</b>
          <span className="seat-player">{seat.kind === "ai" ? (presidential ? "Computer candidate" : "Computer party") : seat.label}</span>
          <span className="seat-spacer" />
          <span className="seat-small">{presidential ? "CANDIDATE" : "LEADER"}</span>
          <span className="seat-leader">{leaderName}</span>
          <span className="seat-aff">{custom ? "Your candidate" : (leader?.affiliation ?? "")}</span>
          {!presidential && (
            <span className="seat-chip">
              <i style={{ background: seat.party.color }} aria-hidden="true" />
              {COLORS.find((c) => c.hex === seat.party.color)?.name ?? "Colour"} · {EMBLEM_NAME[seat.party.emblem] ?? seat.party.emblem}
            </span>
          )}
        </span>
      </button>
      {seat.kind === "ai" && (
        <div className="seat-level" role="group" aria-label={`${seat.party.name} difficulty`}>
          {(["easy", "normal", "hard"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={seat.level === l} onClick={() => onLevel(l)}>
              {LEVEL_NAME[l]}
            </button>
          ))}
        </div>
      )}
      {onRemove && (
        <button type="button" className="seat-remove" aria-label={`Remove ${seat.party.name || seat.label}`} onClick={onRemove}>
          ×
        </button>
      )}
    </section>
  );
}

/** The selected seat's party: name, colour and emblem (first come, first served), leader, and the candidate creator. */
function PartyEditor({
  seat,
  config,
  mode,
  customs,
  onChange,
  onCreate,
  onChoose,
}: {
  seat: Seat;
  config: MatchConfig;
  mode: Mode;
  customs: CustomCandidate[];
  onChange: (s: Seat) => void;
  onCreate: (edit?: CustomCandidate) => void;
  onChoose: () => void;
}) {
  const presidential = isPresidential();
  const mine = customs.find((c) => c.id === seat.leaderId);
  const others = config.seats.filter((s) => s.id !== seat.id);
  const takenColor = new Map(others.map((s) => [s.party.color, s.party.name || s.label]));
  const takenEmblem = new Map(others.map((s) => [s.party.emblem, s.party.name || s.label]));
  const set = (patch: Partial<Seat["party"]>) => onChange({ ...seat, party: { ...seat.party, ...patch } });
  const canToggle = mode === "hotseat" || (mode === "online" && seat.id !== "you");
  const leader = map.pack.candidates.find((c) => c.id === seat.leaderId);
  const leaderName = mine?.name ?? leader?.name ?? seat.leaderId;
  const affiliation = leader?.affiliation ?? "Independent";
  const title =
    seat.kind === "ai"
      ? presidential
        ? "Computer candidate"
        : "Computer party"
      : seat.id === "you"
        ? presidential
          ? "Your candidate"
          : "Your party"
        : `${seat.label}, pick your ${presidential ? "candidate" : "party"}`;
  return (
    <section className="setup-card party-editor" data-testid="party-editor" style={{ borderTopColor: seat.party.color }}>
      <div className="setup-card-head">
        <h2>{title}</h2>
        {canToggle && (
          <div className="kind" role="group" aria-label={`${seat.label}: human or computer`}>
            {(["human", "ai"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={seat.kind === k} onClick={() => onChange({ ...seat, kind: k })}>
                {k === "human" ? (mode === "online" ? "Friend" : "Human") : "Computer"}
              </button>
            ))}
          </div>
        )}
      </div>
      {presidential ? (
        <p className="party-runs" data-testid={`seat-party-${seat.id}`}>
          <i className="chip" style={{ background: seat.party.color }} /> Runs as {affiliation === "Independent" ? "an Independent" : `the ${affiliation} candidate`}, in a shade of the
          party's colour
        </p>
      ) : (
        <>
          <label className="party-name">
            <span className="field-label">PARTY NAME</span>
            <span className="party-name-box">
              <span className="party-name-emblem" style={{ background: seat.party.color }}>
                <EmblemIcon emblem={seat.party.emblem} color="#fff7e2" size={26} />
              </span>
              <input value={seat.party.name} maxLength={28} onChange={(e) => set({ name: e.target.value })} disabled={seat.kind === "ai"} aria-label={`${seat.label} party name`} />
            </span>
          </label>
          <div className="field">
            <span className="field-label" id={`colour-${seat.id}`}>
              COLOUR
            </span>
            <div className="swatches" role="radiogroup" aria-labelledby={`colour-${seat.id}`} aria-label={`${seat.label} colour`}>
              {COLORS.map((c) => {
                const by = takenColor.get(c.hex);
                return (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={seat.party.color === c.hex}
                    aria-label={by ? `${c.name}, taken by ${by}` : c.name}
                    disabled={Boolean(by)}
                    className="swatch"
                    style={{ background: c.hex }}
                    onClick={() => set({ color: c.hex })}
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
            <span className="field-label" id={`emblem-${seat.id}`}>
              EMBLEM
            </span>
            <div className="emblems" role="radiogroup" aria-labelledby={`emblem-${seat.id}`} aria-label={`${seat.label} emblem`}>
              {EMBLEMS.map((e) => {
                const by = takenEmblem.get(e);
                const on = seat.party.emblem === e;
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={by ? `${EMBLEM_NAME[e]}, taken by ${by}` : EMBLEM_NAME[e]}
                    disabled={Boolean(by)}
                    className="emblem-pick"
                    style={on ? { boxShadow: `0 0 0 3px ${seat.party.color}, 0 4px 0 3px #2b2440` } : undefined}
                    onClick={() => set({ emblem: e })}
                  >
                    <EmblemIcon emblem={e} color={on ? tint(seat.party.color) : by ? "#dcdce2" : "#fff7e2"} size={30} />
                    <span>{by ? "TAKEN" : EMBLEM_NAME[e]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="small muted">Crossed out: another seat picked it first. Change a pick and the old one frees up.</p>
        </>
      )}
      <div className="field">
        <span className="field-label">{presidential ? "CANDIDATE" : "LEADER"}</span>
        <button type="button" className="leader-pick" onClick={onChoose} aria-label={`${seat.label} leader: ${leaderName}. Choose another`} data-leader={seat.leaderId} data-testid={`pick-leader-${seat.id}`}>
          <span className="leader-pick-face" style={{ background: tint(seat.party.color), borderColor: seat.party.color }} aria-hidden="true">
            {mine ? <Portrait avatar={toAvatar(mine.avatar)} size={36} label="" /> : initials(leaderName)}
          </span>
          <span className="leader-pick-text">
            <b>{leaderName}</b>
            <small>{mine ? "Your candidate" : (leader?.affiliation ?? "")}</small>
          </span>
          <span className="leader-pick-change">Change</span>
        </button>
      </div>
      {seat.kind === "human" && (
        <div className="custom-leader" data-testid="custom-leader">
          {mine && <Portrait avatar={toAvatar(mine.avatar)} size={44} label={`Portrait of ${mine.name}`} />}
          {mine && (
            <button type="button" onClick={() => onCreate(mine)} data-testid={`edit-candidate-${seat.id}`}>
              Edit {mine.name}
            </button>
          )}
          <button type="button" onClick={() => onCreate()} data-testid={`create-candidate-${seat.id}`}>
            + Create a candidate
          </button>
        </div>
      )}
    </section>
  );
}

/** A seat id not yet at the table, for a new seat. */
const freeId = (seats: Seat[], base: string) => {
  for (let n = seats.length + 1; ; n++) if (!seats.some((s) => s.id === `${base}${n}`)) return `${base}${n}`;
};

export function SetupScreen({
  mode,
  onBack,
  onStart,
}: {
  mode: Mode;
  onBack: () => void;
  /** Online, starting opens a lobby on the server: a rejection's message is shown here. */
  onStart: (config: MatchConfig) => void | Promise<void>;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [config, setRawConfig] = useState<MatchConfig>(() => defaultConfig(mode));
  const [selectedId, setSelectedId] = useState(() => config.seats[0]!.id);
  const settings = useSettings();
  const customs = useCustoms(map.id);
  // Presidential: each seat's party always follows from its candidate.
  const setConfig = (next: MatchConfig) => setRawConfig(isPresidential() ? { ...next, seats: withCandidateParties(next.seats, customs) } : next);
  const owned = useOwns("candidate-creator");
  // The creator opens over the setup screen, so the table being set up stays as it is.
  const [creating, setCreating] = useState<{ seatId: string; edit?: CustomCandidate | undefined } | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  // The seat whose candidate (or leader) is being chosen on the Choose your candidate screen.
  const [choosing, setChoosing] = useState<string | null>(null);
  const issues = checkConfig(config);
  const selected = config.seats.find((s) => s.id === selectedId) ?? config.seats[0]!;
  const openCreator = (seatId: string, edit?: CustomCandidate) => (owned ? setCreating({ seatId, edit }) : setUnlocking(seatId));
  /** A seat whose custom leader was deleted goes back to a free leader of the map. */
  const repairLeaders = (cfg: MatchConfig): MatchConfig => {
    const known = new Set([...map.pack.candidates.map((c) => c.id), ...loadCustoms().map((c) => c.id)]);
    const seats: Seat[] = [];
    for (const s of cfg.seats) {
      if (known.has(s.leaderId)) seats.push(s);
      else
        seats.push({
          ...s,
          leaderId: map.pack.candidates.map((c) => c.id).find((id) => !cfg.seats.some((x) => x.leaderId === id)) ?? map.pack.candidates[0]!.id,
        });
    }
    return { ...cfg, seats };
  };
  // Another map has other leaders and computer parties: seats keep their kind, colour and emblem, and people keep
  // their party names; leaders and computer party names come from the new map.
  const changeMap = (id: MapId) => {
    if (id === map.id) return;
    const wasPresidential = isPresidential();
    setPreferredMap(id); // the menu shows the map last chosen, and the next match starts on it
    // Between Presidential and Parliamentary maps the parties work differently, so the table starts afresh.
    if (wasPresidential !== isPresidential()) {
      const fresh = defaultConfig(mode);
      const seats: Seat[] = [];
      config.seats.forEach((s, i) => {
        const base = s.kind === "ai" ? aiSeat(seats, i + 1, s.level) : humanSeat(seats, i + 1, mode === "online");
        seats.push({ ...base, id: s.id, kind: s.kind, label: s.label, level: s.level });
      });
      setConfig({ ...config, map: id, seats: seats.length ? seats : fresh.seats });
      return;
    }
    const seats: Seat[] = [];
    config.seats.forEach((s, i) => {
      if (s.kind === "ai") {
        const fresh = aiSeat(seats, i + 1, s.level);
        seats.push({ ...s, leaderId: fresh.leaderId, party: { ...s.party, name: fresh.party.name } });
      } else {
        seats.push({ ...s, leaderId: humanSeat(seats, i + 1, mode === "online").leaderId });
      }
    });
    setConfig({ ...config, map: id, seats });
  };
  const update = (seat: Seat) => {
    // A seat switched to computer gets a made-up AI party; switched to human, a player's party.
    const old = config.seats.find((s) => s.id === seat.id)!;
    let next = seat;
    if (old.kind !== seat.kind) {
      const rest = config.seats.filter((s) => s.id !== seat.id);
      const index = config.seats.indexOf(old) + 1;
      next = seat.kind === "ai" ? { ...aiSeat(rest, index), id: old.id } : { ...humanSeat(rest, index, mode === "online"), id: old.id };
    }
    setConfig({ ...config, seats: config.seats.map((s) => (s.id === seat.id ? next : s)) });
  };
  const add = () => {
    const n = config.seats.length + 1;
    const seat: Seat =
      mode === "hotseat" || mode === "online"
        ? { ...humanSeat(config.seats, n, mode === "online"), id: freeId(config.seats, "p") }
        : { ...aiSeat(config.seats, n), id: freeId(config.seats, "ai") };
    setConfig({ ...config, seats: [...config.seats, seat] });
    setSelectedId(seat.id);
  };
  const remove = (id: string) => {
    setConfig({ ...config, seats: config.seats.filter((x) => x.id !== id) });
    if (selectedId === id) setSelectedId(config.seats[0]!.id);
  };
  const presidential = isPresidential();
  const title = `${mode === "solo" ? "Solo campaign" : mode === "online" ? "Play with friends" : "Pass and play"} · ${presidential ? "Presidential" : "Parliamentary"}`;
  const start = () => {
    setStartError("");
    const out = onStart({ ...config, customs: customs.filter((c) => config.seats.some((s) => s.leaderId === c.id)) });
    if (out) {
      setStarting(true);
      out.catch((e: unknown) => setStartError(e instanceof Error ? e.message : "Couldn't open the lobby.")).finally(() => setStarting(false));
    }
  };
  const people = config.seats.filter((s) => s.kind === "human").length;
  return (
    <main className="setup setup-v2" data-testid="setup">
      <header className="setup-top">
        <button type="button" className="setup-back" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#2b2440" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>
        <div className="setup-title">
          <h1>{title}</h1>
          <span>
            {map.name} · {mapDetail(map)}
          </span>
        </div>
        <div className="setup-go">
          <button type="button" className="primary start" disabled={issues.length > 0 || starting} onClick={start} data-testid="start-match">
            {mode === "online" ? (starting ? "Opening the lobby…" : "Open the lobby") : "Start campaign"}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#2b2440" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <span>{issues.length ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to fix` : mode === "online" ? `Next: a lobby with your invite code · ${people - 1} seat${people === 2 ? "" : "s"} for friends` : "Ready when you are"}</span>
        </div>
      </header>

      <div className="setup-main">
        <section className="setup-card setup-seats">
          <div className="setup-card-head">
            <h2>{presidential ? "Candidates" : "Parties in this match"}</h2>
            <span className="muted">2 to 5 seats · tap a seat to change it</span>
          </div>
          <div className="seat-grid">
            {config.seats.map((s, i) => (
              <SeatTile
                key={s.id}
                seat={s}
                index={i}
                mode={mode}
                selected={s.id === selected.id}
                customs={customs}
                onSelect={() => setSelectedId(s.id)}
                onLevel={(level) => update({ ...s, level })}
                onRemove={config.seats.length > 2 && (mode === "hotseat" || s.id !== "you") && (mode !== "solo" || i > 0) ? () => remove(s.id) : undefined}
              />
            ))}
            {config.seats.length < 5 && (
              <button type="button" className="add-seat" onClick={add} data-testid="add-seat">
                <svg width="48" height="48" viewBox="0 0 52 52" aria-hidden="true">
                  <circle cx="26" cy="26" r="23" fill="#fff7e2" stroke="#2b2440" strokeWidth="3" />
                  <path d="M26 15v22M15 26h22" stroke="#2b2440" strokeWidth="4" strokeLinecap="round" />
                </svg>
                <b>+ Add a {mode === "hotseat" ? "player" : mode === "online" ? "seat" : presidential ? "computer candidate" : "computer party"}</b>
                <small>{mode === "solo" ? "Easy, Normal or Hard" : mode === "online" ? "A friend or a computer party" : "Another player on this device, or a computer"}</small>
              </button>
            )}
          </div>
          <p className="setup-note">
            {presidential
              ? "Two candidates can share a party. Each gets their own shade of the party colour on the map."
              : mode === "hotseat"
                ? "Players take turns on this device; each plan stays secret. Colours, emblems and leaders are first come, first served."
                : mode === "online"
                  ? "Set up every seat, then share the invite code: friends take the Friend seats on their own devices."
                  : "Colours, emblems and leaders are first come, first served: once a seat has one, nobody else can pick it."}
          </p>
          {issues.length > 0 && (
            <ul className="issues" data-testid="setup-issues">
              {issues.map((i) => (
                <li key={i.message}>{i.message}</li>
              ))}
            </ul>
          )}
          {startError && (
            <p className="backup-error" role="alert">
              {startError}
            </p>
          )}
        </section>

        <div className="setup-side">
          <PartyEditor key={selected.id} seat={selected} config={config} mode={mode} customs={customs} onChange={update} onCreate={(edit) => openCreator(selected.id, edit)} onChoose={() => setChoosing(selected.id)} />
          <section className="setup-card match-options">
            <h2>Match options</h2>
            <div className="field">
              <span className="field-label" id="map-label">
                MAP
              </span>
              <div className="map-pick" role="radiogroup" aria-labelledby="map-label" data-testid="map-pick">
                {Object.values(MAPS).map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === map.id} className="map-card" onClick={() => changeMap(m.id)} data-testid={`map-${m.id}`}>
                    {m.name}
                  </button>
                ))}
              </div>
              <span className="small">
                {mapDetail(map)} · {map.pack.regions.length} regions · {majority(map.pack)} to win
              </span>
            </div>
            {presidential && map.pack.rules.runningMateTurn !== undefined && (
              <div className="field">
                <span className="field-label">RUNNING MATE</span>
                <b className="small">Picked at the start of turn {map.pack.rules.runningMateTurn}</b>
              </div>
            )}
            <div className="field">
              <span className="field-label">CAMPAIGN LENGTH</span>
              <b className="small">Runs until every region is in contention, then one final turn</b>
            </div>
            {mode === "online" && (
              <label className="field turn-timer">
                <span className="field-label">TURN TIMER</span>
                <select value={config.turnSeconds ?? ""} onChange={(e) => setConfig({ ...config, turnSeconds: e.target.value ? Number(e.target.value) : null })} data-testid="setup-timer">
                  {TURN_TIMERS.map((t) => (
                    <option key={t.label} value={t.seconds ?? ""}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <small className="muted">Run out of time and you sit the turn out; after 3 missed turns in a row the computer plays for you until you're back.</small>
              </label>
            )}
            {!presidential && (
              <label className="check luck-option">
                <input type="checkbox" checked={config.luck === true} onChange={(e) => setConfig({ ...config, luck: e.target.checked })} data-testid="setup-luck" />
                <span>
                  <b>Turn on luck factor</b>
                  <small className="muted"> Every seat is a draw on election night: more pips mean better odds, and each pip of lead counts double.</small>
                </span>
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={settings.showTicker} onChange={(e) => updateSettings({ showTicker: e.target.checked })} />
              <span>
                <b>Show the news ticker</b>
              </span>
            </label>
          </section>
        </div>
      </div>
      {choosing && config.seats.some((s) => s.id === choosing) && (
        <CandidatePicker
          seat={config.seats.find((s) => s.id === choosing)!}
          config={config}
          customs={customs}
          owned={owned}
          onPick={(leaderId) => update({ ...config.seats.find((s) => s.id === choosing)!, leaderId })}
          onCreate={() => {
            const id = choosing;
            setChoosing(null);
            openCreator(id);
          }}
          onClose={() => setChoosing(null)}
        />
      )}
      {unlocking && (
        <UnlockCard
          onClose={() => setUnlocking(null)}
          onUnlocked={() => {
            setCreating({ seatId: unlocking });
            setUnlocking(null);
          }}
        />
      )}
      {creating && (
        <CandidateCreator
          pack={map.pack}
          initial={creating.edit}
          onClose={() => {
            setCreating(null);
            setConfig(repairLeaders(config));
          }}
          onSave={(c) => {
            setCreating(null);
            // The new candidate leads the seat it was made from, unless another seat already has it.
            const taken = config.seats.some((s) => s.id !== creating.seatId && s.leaderId === c.id);
            setConfig(repairLeaders({ ...config, seats: config.seats.map((s) => (s.id === creating.seatId && !taken ? { ...s, leaderId: c.id } : s)) }));
          }}
        />
      )}
    </main>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const set = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch);
    applyVolumes();
  };
  return (
    <div className="overlay" data-testid="settings">
      <div
        className="settings-card"
        role="dialog"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title">Settings</h2>
        <label className="slider">
          <span>Music volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.music * 100)}
            onChange={(e) => {
              const music = Number(e.target.value) / 100;
              set({ music });
              if (music > 0) startMusic();
              else stopMusic();
            }}
            data-testid="music-volume"
          />
          <b>{Math.round(s.music * 100)}%</b>
        </label>
        <label className="slider">
          <span>Sound effects volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.sound * 100)}
            onChange={(e) => {
              set({ sound: Number(e.target.value) / 100 });
              play("tap");
            }}
            data-testid="sound-volume"
          />
          <b>{Math.round(s.sound * 100)}%</b>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.showTicker}
            onChange={(e) => set({ showTicker: e.target.checked })}
            data-testid="setting-ticker"
          />
          <span>Show the news ticker</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.recapSpeed === 2}
            onChange={(e) => set({ recapSpeed: e.target.checked ? 2 : 1 })}
          />
          <span>Fast turn recaps</span>
        </label>
        <label className="pick-row">
          <span>Text size</span>
          <select
            value={s.textScale}
            onChange={(e) => set({ textScale: Number(e.target.value) })}
            data-testid="text-size"
          >
            <option value={1}>Normal</option>
            <option value={1.15}>Large</option>
            <option value={1.3}>Extra large</option>
          </select>
        </label>
        <label className="pick-row">
          <span>Motion</span>
          <select
            value={s.motion}
            onChange={(e) => set({ motion: e.target.value as typeof s.motion })}
            data-testid="motion"
          >
            <option value="system">Follow my device</option>
            <option value="reduced">Reduced</option>
            <option value="full">Full</option>
          </select>
        </label>
        <button
          type="button"
          className="primary"
          onClick={onClose}
          data-testid="close-settings"
        >
          Done
        </button>
      </div>
    </div>
  );
}
