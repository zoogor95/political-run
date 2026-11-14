/**
 * The results screen, after the design's Results (presidential) and ParlResults (parliamentary) artboards: a banner in
 * the winner's colour, the ranking as portrait cards, the chamber as a seat chart with how the government formed, and a
 * bar with the match's numbers and Replay map, Share, Rematch and Main menu.
 */
import { useEffect, useState } from "react";
import { controllers, majority, meterOf, totalSeats, type AiLevel, type GameState } from "@majority-map/core";
import { ACHIEVEMENTS } from "./achievements";
import { textOn } from "./panels";
import { candidateName, money, pack, playerOf, presidential, trackName } from "./model";
import { useProfile } from "./profile";
import type { GameApi } from "./useGame";

const LEVEL_NAME: Record<AiLevel, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
/** The chamber each parliamentary map elects. */
const CHAMBER: Record<string, string> = { uk: "House of Commons", pk: "National Assembly" };

const partyName = (s: GameState, id: string) => playerOf(s, id).party.name;
const partyColor = (s: GameState, id: string) => playerOf(s, id).party.color;
/** A party colour dark enough to read as text on cream. */
const inked = (color: string) => `color-mix(in srgb, ${color} 70%, #2b2440)`;
const votesText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${Math.round(n)}`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("") || name.slice(0, 1).toUpperCase();

function finalNight(game: GameApi) {
  const night = game.election!;
  return { night, s: night.state, result: night.result, me: game.humans[0]! };
}

/** The headline and subtitle, shared by the banner and Share. */
function resultLines(game: GameApi): { title: string; sub: string; color: string } {
  const { s, result, me } = finalNight(game);
  const winner = result.ranking[0]!;
  const youWon = game.solo && winner === me;
  const turns = `after ${game.summaries.length} ${game.summaries.length === 1 ? "turn" : "turns"}`;
  const color = partyColor(s, winner);
  if (presidential()) {
    const ev = result.seats[winner] ?? 0;
    return {
      title: youWon ? "You win the presidency!" : `${candidateName(playerOf(s, winner).leaderId)} wins the presidency`,
      sub: [`${ev} electoral ${ev === 1 ? "vote" : "votes"}`, turns, game.solo && !game.online ? `${LEVEL_NAME[game.level]} AI` : ""].filter(Boolean).join(" · "),
      color,
    };
  }
  const gov = result.government;
  const how = (result.seats[winner] ?? 0) >= majority(pack) ? "a majority" : gov.members.length > 1 ? "no majority, so a government is formed" : "no majority: a minority government";
  return {
    title: youWon ? "You win the most seats!" : `${partyName(s, winner)} wins the most seats`,
    sub: `${result.seats[winner] ?? 0} of ${totalSeats(pack)} · ${how} · ${turns}`,
    color,
  };
}

export function ResultsBanner({ game }: { game: GameApi }) {
  const { title, sub, color } = resultLines(game);
  return (
    <header className="results-banner" style={{ background: color, color: textOn(color) }}>
      <h2>{title}</h2>
      <span>{sub}</span>
    </header>
  );
}

/** The ranking as portrait cards: place, face, leader and party, a line about them, and their seats or electoral votes. */
export function RankCards({ game }: { game: GameApi }) {
  const { s, result, me } = finalNight(game);
  const ctrl = controllers(pack, s);
  const gov = result.government;
  const many = result.ranking.length > 3;
  const role = (id: string) =>
    gov.members[0] === id ? "Forms the government" : gov.members.includes(id) ? "Joins the government" : gov.opposition === id ? "Main opposition" : "Outside the government";
  return (
    <ol className={`rank-cards${many ? " many" : ""}`} data-testid={presidential() ? "race" : "ranks"}>
      {result.ranking.map((id, i) => {
        const p = playerOf(s, id);
        const leader = candidateName(p.leaderId);
        const affiliation = pack.candidates.find((c) => c.id === p.leaderId)?.affiliation;
        const groups = Object.values(ctrl).filter((o) => o === id).length;
        const out = p.eliminated !== undefined || id === result.eliminated;
        const resigned = game.resignedSeats.includes(id);
        const kind = id === me && (game.solo || game.online) ? "YOU" : resigned ? "RESIGNED" : game.levelOf(id) ? "AI" : "PLAYER";
        const line = presidential()
          ? [resigned ? "Resigned: the computer played on" : "", out ? "Eliminated" : "", `${votesText(result.popularVote[id] ?? 0)} popular votes`, `${groups} ${groups === 1 ? "group" : "groups"}`]
          : [resigned ? "Resigned: the computer played on" : "", role(id), affiliation ? `leader from ${affiliation}` : "", `${votesText(result.popularVote[id] ?? 0)} popular votes`];
        return (
          <li key={id} className={`rank-card${kind === "YOU" ? " you" : ""}`} title={`${groups} ${groups === 1 ? "group" : "groups"} held`}>
            <span className="rank-place">{i + 1}</span>
            <span className="call-face rank-face" style={{ background: `color-mix(in srgb, ${p.party.color} 22%, #fff)`, borderColor: p.party.color }} aria-hidden="true">
              {initials(leader)}
            </span>
            <span className="rank-text">
              <b>
                {leader}{" "}
                <small style={{ color: inked(p.party.color) }}>
                  {(presidential() ? (affiliation ?? p.party.name) : p.party.name).toUpperCase()} · {kind}
                </small>
              </b>
              <span>{line.filter(Boolean).join(" · ")}</span>
            </span>
            <span className="rank-seats" style={{ color: inked(p.party.color) }}>
              {out ? "OUT" : (result.seats[id] ?? 0)}
            </span>
          </li>
        );
      })}
      {presidential() && <li className="rank-note">{majority(pack)} electoral votes to win.</li>}
    </ol>
  );
}

/** The chamber as a half-circle of seats: the government from the left, the main opposition on the right. */
function Hemicycle({ s, game }: { s: GameState; game: GameApi }) {
  const { result } = finalNight(game);
  const gov = result.government;
  const order = [...gov.members, ...result.ranking.filter((id) => !gov.members.includes(id) && id !== gov.opposition), ...(gov.opposition ? [gov.opposition] : [])];
  const total = order.reduce((a, id) => a + (result.seats[id] ?? 0), 0);
  const rows = Math.max(6, Math.round(Math.sqrt(total / 3.4)));
  const r0 = 70;
  const r1 = 180;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.floor((total * r) / sum));
  for (let k = rows - 1, left = total - counts.reduce((a, b) => a + b, 0); left > 0; k = (k - 1 + rows) % rows, left--) counts[k]!++;
  const seats: { a: number; x: number; y: number }[] = [];
  radii.forEach((r, i) => {
    const n = counts[i]!;
    for (let j = 0; j < n; j++) {
      const a = Math.PI - Math.PI * (n === 1 ? 0.5 : j / (n - 1));
      seats.push({ a, x: 200 + r * Math.cos(a), y: 180 - r * Math.sin(a) });
    }
  });
  seats.sort((p, q) => q.a - p.a);
  const dot = Math.min(5.2, (0.42 * (r1 - r0)) / (rows - 1), (0.42 * Math.PI * r0) / Math.max(1, counts[0]! - 1));
  const colors: string[] = [];
  for (const id of order) for (let k = 0; k < (result.seats[id] ?? 0); k++) colors.push(partyColor(s, id));
  const others = total - gov.seats;
  return (
    <svg className="hemicycle" viewBox="0 -9 400 221" role="img" aria-label={`Seat chart: government ${gov.seats} seats, others ${others}`}>
      {seats.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={dot} fill={colors[i] ?? "#fff"} stroke="#2b2440" strokeWidth={dot > 3 ? 1 : 0.6} />
      ))}
      <text x="200" y="190" className="hemi-score">
        {gov.seats} – {others}
      </text>
      <text x="200" y="207" className="hemi-label">
        GOVERNMENT · OTHERS
      </text>
    </svg>
  );
}

/** How the government formed, under the seat chart. */
function Formation({ s, game }: { s: GameState; game: GameApi }) {
  const { result } = finalNight(game);
  const gov = result.government;
  const need = majority(pack);
  const outside = gov.outside.filter((id) => (result.seats[id] ?? 0) > 0);
  const row = (id: string, text: string, n: string) => (
    <li key={id}>
      <i className="chip" style={{ background: partyColor(s, id) }} />
      <span>{text} </span>
      <b>{n}</b>
    </li>
  );
  return (
    <ol className="formation" data-testid="formation">
      {row(gov.members[0]!, `${partyName(s, gov.members[0]!)} has the most seats: forms the government`, String(result.seats[gov.members[0]!] ?? 0))}
      {gov.opposition && row(gov.opposition, `${partyName(s, gov.opposition)} is second: main opposition`, String(result.seats[gov.opposition] ?? 0))}
      {gov.members.slice(1).map((id) => row(id, `${partyName(s, id)} joins the government`, `+${result.seats[id] ?? 0}`))}
      <li className="muted">
        <span>
          {gov.hasMajority
            ? `Majority reached with ${gov.seats} of ${need} needed${outside.length ? `; ${outside.map((id) => `${partyName(s, id)} ${result.seats[id] ?? 0}`).join(", ")} ${outside.length === 1 ? "stays" : "stay"} outside` : ""}.`
            : `No majority even together: a minority government with ${gov.seats} seats.`}
        </span>
      </li>
    </ol>
  );
}

/** The right-hand column: the race (presidential) or the chamber (parliamentary), the headline of the match and the groups. */
export function ResultsPanel({ game, litGroup, onGroup }: { game: GameApi; litGroup: string | null; onGroup: (groupId: string) => void }) {
  const { s, result } = finalNight(game);
  const ctrl = controllers(pack, s);
  return (
    <div className="results-side">
      {presidential() ? (
        <RankCards game={game} />
      ) : (
        <section className="chamber">
          <div className="chamber-head">
            <h3>{CHAMBER[pack.id] ?? "Parliament"}</h3>
            <small>{majority(pack)} FOR A MAJORITY</small>
          </div>
          <Hemicycle s={s} game={game} />
          <small className="chamber-label">HOW THE GOVERNMENT FORMED</small>
          <Formation s={s} game={game} />
          <p className="chamber-note">Rankings count most seats only. A tie for most seats starts a second round: every party loses 5 pips in every region and the campaign continues.</p>
        </section>
      )}
      {game.matchHeadline && (
        <p className="match-headline" data-testid="match-headline">
          <small>HEADLINE OF THE MATCH</small>
          <b>{game.matchHeadline.text}</b>
        </p>
      )}
      {s.luck && (
        <p className="results-luck" data-testid="luck-note">
          Luck factor on: every seat was drawn by chance, weighted by pips with each pip of lead counting double.
        </p>
      )}
      <section className="results-groups">
        <h3>Groups on the map</h3>
        <p className="small muted">Pick a group to show its regions on the seat map.</p>
        <ul className="result-groups" data-testid="result-groups">
          {pack.groups
            .filter((g) => g.kind === "state")
            .map((g) => {
              const won: Record<string, number> = {};
              for (const r of g.regions) for (const [id, n] of Object.entries(result.regionSeats[r] ?? {})) won[id] = (won[id] ?? 0) + n;
              const top = Object.entries(won)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
              const owner = ctrl[g.id];
              return (
                <li key={g.id}>
                  <button type="button" aria-pressed={litGroup === g.id} onClick={() => onGroup(g.id)} data-testid={`result-group-${g.id}`}>
                    <span className="rg-name">
                      <i className="chip" style={{ background: owner ? partyColor(s, owner) : "#fff" }} title={owner ? `Held by ${partyName(s, owner)}` : "Nobody holds it"} />
                      {g.name}
                    </span>
                    <span className="rg-seats">{top.map(([id, n]) => `${partyName(s, id)} ${n}`).join(" · ") || (presidential() ? "No states won" : "No seats won")}</span>
                  </button>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}

/** The region with the smallest lead between first and second place at the count. */
function closestRegion(s: GameState): string | null {
  let best: { id: string; margin: number; seats: number } | null = null;
  for (const r of pack.regions) {
    const steps = s.players.map((p) => meterOf(s, r.id, p.id).steps).sort((a, b) => b - a);
    if (!steps[0]) continue;
    const margin = steps[0] - (steps[1] ?? 0);
    if (!best || margin < best.margin || (margin === best.margin && r.seats > best.seats)) best = { id: r.id, margin, seats: r.seats };
  }
  return best ? trackName(best.id) : null;
}

/** The bar under the results: the match in numbers, then Replay map, Share, Rematch and Main menu. */
export function ResultsBar({ game, onMenu, onReplay }: { game: GameApi; onMenu: () => void; onReplay: () => void }) {
  const { s, me } = finalNight(game);
  const you = playerOf(s, me);
  const profile = useProfile();
  const [level, setLevel] = useState<AiLevel>(game.level);
  const [shared, setShared] = useState<string | null>(null);
  useEffect(() => {
    if (!shared) return;
    const t = setTimeout(() => setShared(null), 2200);
    return () => clearTimeout(t);
  }, [shared]);
  const lost = game.summaries.reduce((a, t) => a + (t.parties.find((p) => p.playerId === me)?.conflicts.reduce((x, c) => x + c.amount, 0) ?? 0), 0);
  const locked = Object.values(s.locked).filter((id) => id === me).length;
  const who = game.solo || game.online ? "YOU" : you.party.name.split(/\s+/)[0]!.toUpperCase();
  const place = presidential() ? "STATE" : "REGION";
  const got = ACHIEVEMENTS.filter((a) => a.id in profile.unlocked).length;
  const share = async () => {
    const { title, sub } = resultLines(game);
    const text = `Majority Map: ${title} (${sub}).`;
    const url = /^https?:/.test(location.protocol) ? location.origin + location.pathname : undefined;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Majority Map", text, ...(url ? { url } : {}) });
        return;
      }
      await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
      setShared("Copied!");
    } catch {
      setShared(null);
    }
  };
  return (
    <div className="results-bar">
      <div className="res-stats" data-testid="stats">
        <div>
          <small>{who} SPENT</small>
          <b>{money(you.spent)}</b>
        </div>
        <div>
          <small>LOST IN CONFLICTS</small>
          <b className="bad">{money(lost)}</b>
        </div>
        <div>
          <small>{place}S LOCKED</small>
          <b>{locked}</b>
        </div>
        <div>
          <small>CLOSEST {place}</small>
          <b>{closestRegion(s) ?? "None"}</b>
        </div>
        <div>
          <small>ACHIEVEMENTS</small>
          <b>
            {got}/{ACHIEVEMENTS.length}
          </b>
        </div>
      </div>
      <div className="res-buttons">
        <button type="button" onClick={onReplay} data-testid="replay-open">
          Replay map
        </button>
        <button type="button" onClick={share} data-testid="share">
          {shared ?? "Share"}
        </button>
        {!game.online && (
          <span className="rematch">
            <select value={level} onChange={(e) => setLevel(e.target.value as AiLevel)} aria-label="Rematch difficulty" data-testid="level">
              {(["easy", "normal", "hard"] as const).map((l) => (
                <option key={l} value={l}>
                  {LEVEL_NAME[l]} AI
                </option>
              ))}
            </select>
            <button type="button" className="primary" onClick={() => game.restart(level)} data-testid="rematch">
              Rematch
            </button>
          </span>
        )}
        <button type="button" onClick={onMenu} data-testid="results-menu">
          Main menu
        </button>
      </div>
    </div>
  );
}

/** Replay map: a strip over the map that plays the board turn by turn, or scrubs to any turn. */
export function ReplayStrip({ game, replay, onReplay, onClose }: { game: GameApi; replay: number; onReplay: (turn: number) => void; onClose: () => void }) {
  const last = game.boards.length - 1;
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    if (replay >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => onReplay(replay + 1), 700);
    return () => clearTimeout(t);
  }, [playing, replay, last, onReplay]);
  return (
    <div className="replay-strip">
      <button
        type="button"
        onClick={() => {
          if (!playing && replay >= last) onReplay(0);
          setPlaying((p) => !p);
        }}
        aria-label={playing ? "Pause" : "Play"}
        data-testid="replay-play"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <label htmlFor="replay">{replay >= last ? "Final result" : replay === 0 ? "Start" : `After turn ${replay}`}</label>
      <input
        id="replay"
        type="range"
        min={0}
        max={last}
        value={replay}
        onChange={(e) => {
          setPlaying(false);
          onReplay(Number(e.target.value));
        }}
        data-testid="replay"
      />
      <button type="button" onClick={onClose} aria-label="Close the replay" data-testid="replay-close">
        ✕
      </button>
    </div>
  );
}
