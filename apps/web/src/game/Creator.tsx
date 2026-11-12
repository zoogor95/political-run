/** The candidate creator (a paid unlock) and its unlock card: an avatar, a name and bio, and bonuses from a points budget. */
import { useState } from "react";
import { CUSTOM_RULES, customBudget, customCost, customPrice, customRefund, validateCustom, type CustomCandidate, type MapPack } from "@majority-map/core";
import { deleteCustom, newCustomId, saveCustom } from "./customs";
import { BACKGROUNDS, DEFAULT_AVATAR, HAIRS, HAIR_STYLES, OUTFITS, Portrait, SKINS, toAvatar, type Avatar } from "./Portrait";
import { PRODUCTS, TEST_STORE, purchase } from "./store";

export function UnlockCard({ onUnlocked, onClose }: { onUnlocked: () => void; onClose: () => void }) {
  const p = PRODUCTS["candidate-creator"];
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay" data-testid="unlock">
      <div className="settings-card unlock-card" role="dialog" aria-labelledby="unlock-title">
        <Portrait avatar={{ ...DEFAULT_AVATAR, hairStyle: "hijab", hair: "#2f6b4f", bg: "#ffd34d" }} size={84} label="A custom candidate" />
        <h2 id="unlock-title">{p.name}</h2>
        <p>{p.about}</p>
        <p className="price">One-time unlock · {p.price}</p>
        {TEST_STORE && <p className="test-note">Test store: payments aren't connected yet, so unlocking is free and only lasts in this browser.</p>}
        <div className="row">
          <button type="button" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            data-testid="unlock-buy"
            onClick={async () => {
              setBusy(true);
              if (await purchase("candidate-creator")) onUnlocked();
              setBusy(false);
            }}
          >
            Unlock for {p.price}
          </button>
        </div>
      </div>
    </div>
  );
}

function Swatches({ label, options, value, onPick }: { label: string; options: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="creator-field">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {options.map((c, i) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`${label} ${i + 1}`} className="swatch" style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  );
}

const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`;

export function CandidateCreator({ pack, initial, onSave, onClose }: { pack: MapPack; initial?: CustomCandidate | undefined; onSave: (c: CustomCandidate) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [avatar, setAvatar] = useState<Avatar>(() => toAvatar(initial?.avatar));
  const [mods, setMods] = useState<Record<string, number>>(() => ({ ...(initial?.modifiers ?? {}) }));
  const [id] = useState(() => initial?.id ?? newCustomId());
  const set = (patch: Partial<Avatar>) => setAvatar({ ...avatar, ...patch });
  const budget = customBudget(pack);
  const used = customCost(pack, mods);
  const candidate: CustomCandidate = {
    id,
    name: name.trim(),
    affiliation: "Independent",
    modifiers: mods,
    custom: true,
    packId: pack.id,
    bio: bio.trim(),
    avatar: { ...avatar },
  };
  const issues = validateCustom(pack, candidate);
  const step = (gid: string, dir: 1 | -1) => {
    const next = { ...mods, [gid]: (mods[gid] ?? 0) + dir * CUSTOM_RULES.step };
    if (next[gid] === 0) delete next[gid];
    setMods(next);
  };
  const canStep = (gid: string, dir: 1 | -1) => {
    const now = mods[gid] ?? 0;
    const to = now + dir * CUSTOM_RULES.step;
    if (Math.abs(to) > CUSTOM_RULES.maxPct) return false;
    if (now === 0 && Object.keys(mods).length >= CUSTOM_RULES.maxModifiers) return false;
    const next = { ...mods, [gid]: to };
    if (to === 0) delete next[gid];
    return customCost(pack, next) <= budget || customCost(pack, next) < used;
  };
  const sections: [string, MapPack["groups"]][] = [
    ["Regions", pack.groups.filter((g) => g.kind === "state")],
    ["Voter groups", pack.groups.filter((g) => g.kind === "national")],
  ];
  return (
    <div className="overlay creator-overlay" data-testid="creator">
      <div className="creator" role="dialog" aria-labelledby="creator-title">
        <header className="setup-head">
          <button type="button" onClick={onClose}>
            Back
          </button>
          <h1 id="creator-title">{initial ? "Edit your candidate" : "Create your candidate"}</h1>
          <span className="muted">{pack.name}</span>
        </header>
        <div className="creator-body">
          <section className="creator-col">
            <div className="creator-portrait">
              <Portrait avatar={avatar} size={150} label={`Portrait of ${name || "your candidate"}`} />
            </div>
            <Swatches label="Skin" options={SKINS} value={avatar.skin} onPick={(skin) => set({ skin })} />
            <div className="creator-field">
              <span>Hair</span>
              <div className="kind" role="radiogroup" aria-label="Hair style">
                {HAIR_STYLES.map((h) => (
                  <button key={h.id} type="button" role="radio" aria-checked={avatar.hairStyle === h.id} onClick={() => set({ hairStyle: h.id })}>
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
            <Swatches label={avatar.hairStyle === "hijab" ? "Hijab colour" : "Hair colour"} options={HAIRS} value={avatar.hair} onPick={(hair) => set({ hair })} />
            <Swatches label="Outfit" options={OUTFITS} value={avatar.outfit} onPick={(outfit) => set({ outfit })} />
            <Swatches label="Background" options={BACKGROUNDS} value={avatar.bg} onPick={(bg) => set({ bg })} />
            <div className="creator-toggles">
              {(
                [
                  ["tie", "Tie"],
                  ["beard", "Beard"],
                  ["glasses", "Glasses"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={avatar[k]} onChange={(e) => set({ [k]: e.target.checked })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>
          <section className="creator-col">
            <label className="creator-field">
              <span>Name</span>
              <input value={name} maxLength={CUSTOM_RULES.maxName} onChange={(e) => setName(e.target.value)} aria-label="Candidate name" data-testid="creator-name" />
            </label>
            <label className="creator-field">
              <span>
                Bio · {bio.length}/{CUSTOM_RULES.maxBio}
              </span>
              <textarea value={bio} maxLength={CUSTOM_RULES.maxBio} rows={4} onChange={(e) => setBio(e.target.value)} aria-label="Candidate bio" />
            </label>
            <p className="small">Your candidate runs as an independent and can lead your party on the {pack.name} map. Only parts from the creator: no uploaded pictures.</p>
          </section>
          <section className="creator-col creator-bonuses">
            <div className="points" data-testid="creator-points">
              <b>
                {used} of {budget} points
              </b>
              <div className="points-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (100 * Math.max(0, used)) / budget)}%` }} />
              </div>
              <small>
                Up to {CUSTOM_RULES.maxModifiers} bonuses or penalties, {CUSTOM_RULES.maxPct}% at most each. A bonus makes campaigning there cheaper and raises its income. A penalty gives back half its price.
              </small>
            </div>
            {sections.map(([title, groups]) => (
              <div key={title} className="bonus-list">
                <h3>{title}</h3>
                {groups.map((g) => {
                  const v = mods[g.id] ?? 0;
                  return (
                    <div key={g.id} className={`bonus-row${v > 0 ? " up" : v < 0 ? " down" : ""}`} data-testid={`bonus-${g.id}`}>
                      <span>
                        <b>{g.name}</b>
                        <small>
                          {customPrice(pack, g.id)} pt{customPrice(pack, g.id) === 1 ? "" : "s"} per +5%
                          {customRefund(pack, g.id) > 0 ? ` · −5% gives back ${customRefund(pack, g.id)}` : ""}
                        </small>
                      </span>
                      <button type="button" aria-label={`Less for ${g.name}`} disabled={!canStep(g.id, -1)} onClick={() => step(g.id, -1)}>
                        −
                      </button>
                      <output aria-label={`${g.name} modifier`}>{pct(v)}</output>
                      <button type="button" aria-label={`More for ${g.name}`} disabled={!canStep(g.id, 1)} onClick={() => step(g.id, 1)}>
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        </div>
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        )}
        <footer className="creator-foot">
          {initial && (
            <button
              type="button"
              onClick={() => {
                deleteCustom(initial.id);
                onClose();
              }}
            >
              Delete candidate
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={issues.length > 0}
            data-testid="creator-save"
            onClick={() => {
              saveCustom(candidate);
              onSave(candidate);
            }}
          >
            Save candidate
          </button>
        </footer>
      </div>
    </div>
  );
}
