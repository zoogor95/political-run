/** Main menu, match setup (solo or pass and play) and settings. */
import { useState } from "react";
import { pack } from "./model";
import { loadMatch } from "./saves";
import { COLORS, EMBLEMS, EMBLEM_NAME, aiSeat, checkConfig, defaultConfig, humanSeat, type MatchConfig, type Mode, type Seat } from "./setup";
import { updateSettings, useSettings } from "./settings";
import { applyVolumes, play, startMusic, stopMusic } from "./audio";

export function MainMenu({ onContinue, onNew, onSettings }: { onContinue: () => void; onNew: (mode: Mode) => void; onSettings: () => void }) {
  const save = loadMatch();
  const when = save ? new Date(save.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <main className="menu" data-testid="main-menu">
      <h1>Majority Map</h1>
      <p className="tagline">A cartoon election strategy game</p>
      <div className="menu-buttons">
        {save && (
          <button type="button" className="menu-big primary" onClick={onContinue} data-testid="continue-match">
            Continue match
            <small>
              {save.result ? "Result" : save.state.phase === "final" ? "Final turn" : `Turn ${save.state.turn}`} · United Kingdom · saved {when}
            </small>
          </button>
        )}
        <button type="button" className="menu-big" onClick={() => onNew("solo")} data-testid="new-solo">
          Solo match
          <small>You against computer parties</small>
        </button>
        <button type="button" className="menu-big" onClick={() => onNew("hotseat")} data-testid="new-hotseat">
          Pass and play
          <small>2 to 5 players on one device</small>
        </button>
        <button type="button" className="menu-big" onClick={onSettings} data-testid="open-settings">
          Settings
        </button>
      </div>
      <a className="lab-link" href="?lab">
        Board lab
      </a>
    </main>
  );
}

function SeatCard({ seat, config, mode, onChange, onRemove }: { seat: Seat; config: MatchConfig; mode: Mode; onChange: (s: Seat) => void; onRemove?: (() => void) | undefined }) {
  const others = config.seats.filter((s) => s.id !== seat.id);
  const takenColor = new Map(others.map((s) => [s.party.color, s.party.name || s.label]));
  const takenEmblem = new Map(others.map((s) => [s.party.emblem, s.party.name || s.label]));
  const takenLeader = new Set(others.map((s) => s.leaderId));
  const set = (patch: Partial<Seat["party"]>) => onChange({ ...seat, party: { ...seat.party, ...patch } });
  const canToggle = mode === "hotseat";
  return (
    <section className="seat" data-testid={`seat-${seat.id}`} style={{ borderTopColor: seat.party.color }}>
      <div className="seat-head">
        <b>{seat.kind === "human" ? seat.label : "Computer party"}</b>
        {canToggle && (
          <div className="kind" role="group" aria-label={`${seat.label}: human or computer`}>
            {(["human", "ai"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={seat.kind === k} onClick={() => onChange({ ...seat, kind: k })}>
                {k === "human" ? "Human" : "Computer"}
              </button>
            ))}
          </div>
        )}
        {onRemove && (
          <button type="button" className="remove" aria-label={`Remove ${seat.party.name || seat.label}`} onClick={onRemove}>
            ×
          </button>
        )}
      </div>
      <label>
        <span>Party name</span>
        <input value={seat.party.name} maxLength={28} onChange={(e) => set({ name: e.target.value })} disabled={seat.kind === "ai"} aria-label={`${seat.label} party name`} />
      </label>
      <div className="swatches" role="radiogroup" aria-label={`${seat.label} colour`}>
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
      <div className="row">
        <label>
          <span>Emblem</span>
          <select value={seat.party.emblem} onChange={(e) => set({ emblem: e.target.value })} aria-label={`${seat.label} emblem`}>
            {EMBLEMS.map((e) => (
              <option key={e} value={e} disabled={takenEmblem.has(e)}>
                {EMBLEM_NAME[e]}
                {takenEmblem.has(e) ? ` (taken by ${takenEmblem.get(e)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Leader</span>
          <select value={seat.leaderId} onChange={(e) => onChange({ ...seat, leaderId: e.target.value })} aria-label={`${seat.label} leader`}>
            {pack.candidates.map((c) => (
              <option key={c.id} value={c.id} disabled={takenLeader.has(c.id)}>
                {c.name} · {c.affiliation}
              </option>
            ))}
          </select>
        </label>
        {seat.kind === "ai" && (
          <label>
            <span>Difficulty</span>
            <select value={seat.level} onChange={(e) => onChange({ ...seat, level: e.target.value as Seat["level"] })} aria-label={`${seat.party.name} difficulty`}>
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

export function SetupScreen({ mode, onBack, onStart }: { mode: Mode; onBack: () => void; onStart: (config: MatchConfig) => void }) {
  const [config, setConfig] = useState<MatchConfig>(() => defaultConfig(mode));
  const issues = checkConfig(config);
  const update = (seat: Seat) => {
    // A seat switched to computer gets a made-up AI party; switched to human, a player's party.
    const old = config.seats.find((s) => s.id === seat.id)!;
    let next = seat;
    if (old.kind !== seat.kind) {
      const rest = config.seats.filter((s) => s.id !== seat.id);
      const index = config.seats.indexOf(old) + 1;
      next = seat.kind === "ai" ? { ...aiSeat(rest, index), id: old.id } : { ...humanSeat(rest, index), id: old.id, label: `Player ${index}` };
    }
    setConfig({ ...config, seats: config.seats.map((s) => (s.id === seat.id ? next : s)) });
  };
  const add = () => {
    const n = config.seats.length + 1;
    const seat = mode === "hotseat" ? { ...humanSeat(config.seats, n), id: `p${n}` } : aiSeat(config.seats, n);
    setConfig({ ...config, seats: [...config.seats, seat] });
  };
  return (
    <main className="setup" data-testid="setup">
      <header className="setup-head">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <h1>{mode === "solo" ? "Solo match" : "Pass and play"}</h1>
        <span className="muted">United Kingdom · Parliamentary · 650 seats</span>
      </header>
      <p className="small">
        Colours, emblems and leaders are first come, first served: once a seat has one, nobody else can pick it. {mode === "hotseat" ? "Players take turns on this device; each plan stays secret." : ""}
      </p>
      <div className="seats">
        {config.seats.map((s, i) => (
          <SeatCard
            key={s.id}
            seat={s}
            config={config}
            mode={mode}
            onChange={update}
            onRemove={config.seats.length > 2 && (mode === "hotseat" || i > 0) ? () => setConfig({ ...config, seats: config.seats.filter((x) => x.id !== s.id) }) : undefined}
          />
        ))}
        {config.seats.length < 5 && (
          <button type="button" className="add-seat" onClick={add} data-testid="add-seat">
            + Add a {mode === "hotseat" ? "player" : "computer party"}
          </button>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="issues" data-testid="setup-issues">
          {issues.map((i) => (
            <li key={i.message}>{i.message}</li>
          ))}
        </ul>
      )}
      <button type="button" className="primary start" disabled={issues.length > 0} onClick={() => onStart(config)} data-testid="start-match">
        Start the campaign
      </button>
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
      <div className="settings-card" role="dialog" aria-labelledby="settings-title">
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
          <input type="checkbox" checked={s.showTicker} onChange={(e) => set({ showTicker: e.target.checked })} data-testid="setting-ticker" />
          <span>Show the news ticker</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.recapSpeed === 2} onChange={(e) => set({ recapSpeed: e.target.checked ? 2 : 1 })} />
          <span>Fast turn recaps</span>
        </label>
        <label className="pick-row">
          <span>Text size</span>
          <select value={s.textScale} onChange={(e) => set({ textScale: Number(e.target.value) })} data-testid="text-size">
            <option value={1}>Normal</option>
            <option value={1.15}>Large</option>
            <option value={1.3}>Extra large</option>
          </select>
        </label>
        <label className="pick-row">
          <span>Motion</span>
          <select value={s.motion} onChange={(e) => set({ motion: e.target.value as typeof s.motion })} data-testid="motion">
            <option value="system">Follow my device</option>
            <option value="reduced">Reduced</option>
            <option value="full">Full</option>
          </select>
        </label>
        <button type="button" className="primary" onClick={onClose} data-testid="close-settings">
          Done
        </button>
      </div>
    </div>
  );
}
