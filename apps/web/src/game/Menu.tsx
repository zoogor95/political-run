/** Main menu, match setup (solo or pass and play) and settings. */
import { useState } from "react";
import type { CustomCandidate } from "@majority-map/core";
import { CandidateCreator, UnlockCard } from "./Creator";
import { loadCustoms, useCustoms } from "./customs";
import { MAPS, isMapId, map, mapDetail, selectMap, type MapId } from "./model";
import { Portrait, toAvatar } from "./Portrait";
import { useOwns } from "./store";
import { tutorialDone } from "./tutorial";
import { loadMatch } from "./saves";
import {
  COLORS,
  EMBLEMS,
  EMBLEM_NAME,
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

export function MainMenu({
  onContinue,
  onNew,
  onTutorial,
  onSettings,
  onProfile,
  onOnline,
}: {
  onContinue: () => void;
  onNew: (mode: Mode) => void;
  onTutorial: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onOnline: () => void;
}) {
  const save = loadMatch();
  // New players see Learn to play first; once it's done or skipped, it moves down the list.
  const newcomer = !tutorialDone() && !save;
  const learn = (
    <button
      type="button"
      className={`menu-big${newcomer ? " primary" : ""}`}
      onClick={onTutorial}
      data-testid="learn"
    >
      Learn to play
      <small>
        {newcomer
          ? "New here? A guided first match, about 5 minutes"
          : "A guided match against one easy party"}
      </small>
    </button>
  );
  const when = save
    ? new Date(save.savedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
  return (
    <main className="menu" data-testid="main-menu">
      <h1>Majority Map</h1>
      <p className="tagline">A cartoon election strategy game</p>
      <div className="menu-buttons">
        {newcomer && learn}
        {save && (
          <button
            type="button"
            className="menu-big primary"
            onClick={onContinue}
            data-testid="continue-match"
          >
            Continue match
            <small>
              {save.result
                ? "Result"
                : save.state.phase === "final"
                  ? "Final turn"
                  : `Turn ${save.state.turn}`}{" "}
              ·{" "}
              {MAPS[isMapId(save.state.packId) ? save.state.packId : "uk"].name}{" "}
              · saved {when}
            </small>
          </button>
        )}
        <button
          type="button"
          className="menu-big"
          onClick={() => onNew("solo")}
          data-testid="new-solo"
        >
          Solo match
          <small>You against computer parties</small>
        </button>
        <button
          type="button"
          className="menu-big"
          onClick={() => onNew("hotseat")}
          data-testid="new-hotseat"
        >
          Pass and play
          <small>2 to 5 players on one device</small>
        </button>
        <button
          type="button"
          className="menu-big"
          onClick={onOnline}
          data-testid="new-online"
        >
          Play with friends
          <small>A private match online, by invite code</small>
        </button>
        {!newcomer && learn}
        <button
          type="button"
          className="menu-big"
          onClick={onProfile}
          data-testid="open-profile"
        >
          Profile
          <small>Stats and achievements</small>
        </button>
        <button
          type="button"
          className="menu-big"
          onClick={onSettings}
          data-testid="open-settings"
        >
          Settings
        </button>
      </div>
      <a className="lab-link" href="?lab">
        Board lab
      </a>
    </main>
  );
}

function SeatCard({
  seat,
  config,
  mode,
  customs,
  onChange,
  onRemove,
  onCreate,
}: {
  seat: Seat;
  config: MatchConfig;
  mode: Mode;
  customs: CustomCandidate[];
  onChange: (s: Seat) => void;
  onRemove?: (() => void) | undefined;
  onCreate: (edit?: CustomCandidate) => void;
}) {
  const mine = customs.find((c) => c.id === seat.leaderId);
  const others = config.seats.filter((s) => s.id !== seat.id);
  const takenColor = new Map(
    others.map((s) => [s.party.color, s.party.name || s.label]),
  );
  const takenEmblem = new Map(
    others.map((s) => [s.party.emblem, s.party.name || s.label]),
  );
  const takenLeader = new Set(others.map((s) => s.leaderId));
  const set = (patch: Partial<Seat["party"]>) =>
    onChange({ ...seat, party: { ...seat.party, ...patch } });
  // Pass and play and online seats can be people or computers; online, the host's own seat stays a person.
  const canToggle = mode === "hotseat" || (mode === "online" && seat.id !== "you");
  const presidential = isPresidential();
  const affiliation =
    map.pack.candidates.find((c) => c.id === seat.leaderId)?.affiliation ??
    "Independent";
  return (
    <section
      className="seat"
      data-testid={`seat-${seat.id}`}
      style={{ borderTopColor: seat.party.color }}
    >
      <div className="seat-head">
        <b>
          {seat.kind === "human"
            ? seat.label
            : presidential
              ? "Computer candidate"
              : "Computer party"}
        </b>
        {canToggle && (
          <div
            className="kind"
            role="group"
            aria-label={`${seat.label}: human or computer`}
          >
            {(["human", "ai"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={seat.kind === k}
                onClick={() => onChange({ ...seat, kind: k })}
              >
                {k === "human" ? (mode === "online" ? "Friend" : "Human") : "Computer"}
              </button>
            ))}
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            className="remove"
            aria-label={`Remove ${seat.party.name || seat.label}`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>
      {presidential ? (
        <p className="small" data-testid={`seat-party-${seat.id}`}>
          <i className="chip" style={{ background: seat.party.color }} /> Runs
          as{" "}
          {affiliation === "Independent"
            ? "an Independent"
            : `the ${affiliation} candidate`}
        </p>
      ) : (
        <>
          <label>
            <span>Party name</span>
            <input
              value={seat.party.name}
              maxLength={28}
              onChange={(e) => set({ name: e.target.value })}
              disabled={seat.kind === "ai"}
              aria-label={`${seat.label} party name`}
            />
          </label>
          <div
            className="swatches"
            role="radiogroup"
            aria-label={`${seat.label} colour`}
          >
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
                />
              );
            })}
          </div>
        </>
      )}
      <div className="row">
        {!presidential && (
          <label>
            <span>Emblem</span>
            <select
              value={seat.party.emblem}
              onChange={(e) => set({ emblem: e.target.value })}
              aria-label={`${seat.label} emblem`}
            >
              {EMBLEMS.map((e) => (
                <option key={e} value={e} disabled={takenEmblem.has(e)}>
                  {EMBLEM_NAME[e]}
                  {takenEmblem.has(e)
                    ? ` (taken by ${takenEmblem.get(e)})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{presidential ? "Candidate" : "Leader"}</span>
          <select
            value={seat.leaderId}
            onChange={(e) => onChange({ ...seat, leaderId: e.target.value })}
            aria-label={`${seat.label} leader`}
          >
            {seat.kind === "human" && customs.length > 0 && (
              <optgroup label="Your candidates">
                {customs.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={takenLeader.has(c.id)}
                  >
                    {c.name} · Your candidate
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={map.name}>
              {map.pack.candidates.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={takenLeader.has(c.id)}
                >
                  {c.name} · {c.affiliation}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {seat.kind === "human" && (
          <div className="custom-leader">
            {mine && (
              <Portrait
                avatar={toAvatar(mine.avatar)}
                size={44}
                label={`Portrait of ${mine.name}`}
              />
            )}
            {mine && (
              <button
                type="button"
                onClick={() => onCreate(mine)}
                data-testid={`edit-candidate-${seat.id}`}
              >
                Edit {mine.name}
              </button>
            )}
            <button
              type="button"
              onClick={() => onCreate()}
              data-testid={`create-candidate-${seat.id}`}
            >
              + Create a candidate
            </button>
          </div>
        )}
        {seat.kind === "ai" && (
          <label>
            <span>Difficulty</span>
            <select
              value={seat.level}
              onChange={(e) =>
                onChange({ ...seat, level: e.target.value as Seat["level"] })
              }
              aria-label={`${seat.party.name} difficulty`}
            >
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        )}
      </div>
    </section>
  );
}

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
  const [config, setRawConfig] = useState<MatchConfig>(() =>
    defaultConfig(mode),
  );
  const customs = useCustoms(map.id);
  // Presidential: each seat's party always follows from its candidate.
  const setConfig = (next: MatchConfig) =>
    setRawConfig(
      isPresidential()
        ? { ...next, seats: withCandidateParties(next.seats, customs) }
        : next,
    );
  const owned = useOwns("candidate-creator");
  // The creator opens over the setup screen, so the table being set up stays as it is.
  const [creating, setCreating] = useState<{
    seatId: string;
    edit?: CustomCandidate | undefined;
  } | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const issues = checkConfig(config);
  const openCreator = (seatId: string, edit?: CustomCandidate) =>
    owned ? setCreating({ seatId, edit }) : setUnlocking(seatId);
  /** A seat whose custom leader was deleted goes back to a free leader of the map. */
  const repairLeaders = (cfg: MatchConfig): MatchConfig => {
    const known = new Set([
      ...map.pack.candidates.map((c) => c.id),
      ...loadCustoms().map((c) => c.id),
    ]);
    const seats: Seat[] = [];
    for (const s of cfg.seats) {
      if (known.has(s.leaderId)) seats.push(s);
      else
        seats.push({
          ...s,
          leaderId:
            map.pack.candidates
              .map((c) => c.id)
              .find((id) => !cfg.seats.some((x) => x.leaderId === id)) ??
            map.pack.candidates[0]!.id,
        });
    }
    return { ...cfg, seats };
  };
  // Another map has other leaders and computer parties: seats keep their kind, colour and emblem, and people keep
  // their party names; leaders and computer party names come from the new map.
  const changeMap = (id: MapId) => {
    if (id === map.id) return;
    const wasPresidential = isPresidential();
    selectMap(id);
    // Between Presidential and Parliamentary maps the parties work differently, so the table starts afresh.
    if (wasPresidential !== isPresidential()) {
      const fresh = defaultConfig(mode);
      const seats: Seat[] = [];
      config.seats.forEach((s, i) => {
        const base =
          s.kind === "ai"
            ? aiSeat(seats, i + 1, s.level)
            : humanSeat(seats, i + 1, mode === "online");
        seats.push({
          ...base,
          id: s.id,
          kind: s.kind,
          label: s.label,
          level: s.level,
        });
      });
      setConfig({
        ...config,
        map: id,
        seats: seats.length ? seats : fresh.seats,
      });
      return;
    }
    const seats: Seat[] = [];
    config.seats.forEach((s, i) => {
      if (s.kind === "ai") {
        const fresh = aiSeat(seats, i + 1, s.level);
        seats.push({
          ...s,
          leaderId: fresh.leaderId,
          party: { ...s.party, name: fresh.party.name },
        });
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
      next =
        seat.kind === "ai"
          ? { ...aiSeat(rest, index), id: old.id }
          : { ...humanSeat(rest, index, mode === "online"), id: old.id };
    }
    setConfig({
      ...config,
      seats: config.seats.map((s) => (s.id === seat.id ? next : s)),
    });
  };
  const add = () => {
    const n = config.seats.length + 1;
    const seat =
      mode === "hotseat" || mode === "online"
        ? { ...humanSeat(config.seats, n, mode === "online"), id: `p${n}` }
        : aiSeat(config.seats, n);
    setConfig({ ...config, seats: [...config.seats, seat] });
  };
  return (
    <main className="setup" data-testid="setup">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>{mode === "solo" ? "Solo match" : mode === "online" ? "Play with friends" : "Pass and play"}</h1>
        <span className="muted">
          {map.name} · {mapDetail(map)}
        </span>
      </header>
      <div
        className="map-pick"
        role="radiogroup"
        aria-label="Map"
        data-testid="map-pick"
      >
        {Object.values(MAPS).map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={m.id === map.id}
            className="map-card"
            onClick={() => changeMap(m.id)}
            data-testid={`map-${m.id}`}
          >
            <b>{m.name}</b>
            <small>
              {mapDetail(m)} · {m.pack.regions.length} regions
            </small>
          </button>
        ))}
      </div>
      <p className="small">
        Colours, emblems and leaders are first come, first served: once a seat
        has one, nobody else can pick it.{" "}
        {mode === "hotseat"
          ? "Players take turns on this device; each plan stays secret."
          : mode === "online"
            ? "Set up every seat, then share the invite code: friends take the Friend seats on their own devices."
            : ""}
      </p>
      <div className="seats">
        {config.seats.map((s, i) => (
          <SeatCard
            key={s.id}
            seat={s}
            config={config}
            mode={mode}
            onChange={update}
            customs={customs}
            onCreate={(edit) => openCreator(s.id, edit)}
            onRemove={
              config.seats.length > 2 && (mode !== "solo" ? s.id !== "you" || mode === "hotseat" : i > 0)
                ? () =>
                    setConfig({
                      ...config,
                      seats: config.seats.filter((x) => x.id !== s.id),
                    })
                : undefined
            }
          />
        ))}
        {config.seats.length < 5 && (
          <button
            type="button"
            className="add-seat"
            onClick={add}
            data-testid="add-seat"
          >
            + Add a {mode === "hotseat" ? "player" : mode === "online" ? "seat" : isPresidential() ? "computer candidate" : "computer party"}
          </button>
        )}
      </div>
      {!isPresidential() && (
        <label className="check luck-option">
          <input
            type="checkbox"
            checked={config.luck === true}
            onChange={(e) => setConfig({ ...config, luck: e.target.checked })}
            data-testid="setup-luck"
          />
          <span>
            <b>Turn on luck factor</b>
            <small className="muted">
              {" "}
              Every seat is a draw on election night: more pips mean better
              odds, and each pip of lead counts double. A close race can go
              either way.
            </small>
          </span>
        </label>
      )}
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
      <button
        type="button"
        className="primary start"
        disabled={issues.length > 0 || starting}
        onClick={() => {
          setStartError("");
          const out = onStart({
            ...config,
            customs: customs.filter((c) =>
              config.seats.some((s) => s.leaderId === c.id),
            ),
          });
          if (out) {
            setStarting(true);
            out.catch((e: unknown) => setStartError(e instanceof Error ? e.message : "Couldn't open the lobby.")).finally(() => setStarting(false));
          }
        }}
        data-testid="start-match"
      >
        {mode === "online" ? (starting ? "Opening the lobby…" : "Open the lobby") : "Start the campaign"}
      </button>
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
            const taken = config.seats.some(
              (s) => s.id !== creating.seatId && s.leaderId === c.id,
            );
            setConfig(
              repairLeaders({
                ...config,
                seats: config.seats.map((s) =>
                  s.id === creating.seatId && !taken
                    ? { ...s, leaderId: c.id }
                    : s,
                ),
              }),
            );
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
