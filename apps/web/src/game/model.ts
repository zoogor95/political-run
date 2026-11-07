/** Game setup and pure helpers for the play screen: the UK solo match, board styles from the match state, money text. */
import type { RegionStyle } from "@majority-map/board";
import { EMPTY, hexToNumber, shadeFor, tint } from "@majority-map/board";
import ukPack from "@majority-map/content/packs/uk/pack.json";
import {
  createMatch,
  meterOf,
  moveCost,
  pay,
  regionRanking,
  trackIds,
  type GameState,
  type MapPack,
  type Plan,
  type PlayerState,
} from "@majority-map/core";

export const pack = ukPack as unknown as MapPack;
export const YOU = "you";

export function newGame(seed = Date.now() % 1_000_000): GameState {
  return createMatch(pack, {
    seed,
    players: [
      { id: YOU, leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
      { id: "tea", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      { id: "queue", leaderId: "nigel-farage", party: { name: "Queue Appreciation Society", color: "#12a3b8", emblem: "ticket" } },
    ],
  });
}

export function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}${pack.currency}${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1000) return `${sign}${pack.currency}${(a / 1000).toFixed(a >= 100_000 ? 0 : 1)}K`;
  return `${sign}${pack.currency}${a}`;
}

export const candidateName = (id: string) => pack.candidates.find((c) => c.id === id)?.name ?? id;
export const candidate = (id: string) => pack.candidates.find((c) => c.id === id)!;
export const trackName = (id: string) => pack.regions.find((r) => r.id === id)?.name ?? pack.groups.find((g) => g.id === id)?.name ?? id;
export const groupName = (id: string) => pack.groups.find((g) => g.id === id)?.name ?? id;
export const playerOf = (state: GameState, id: string) => state.players.find((p) => p.id === id)!;

/** The player as the plan's costs see them: with this turn's pick already counted as a member. */
export function plannedPlayer(state: GameState, plan: Plan, viewer: string): PlayerState {
  const you = structuredClone(playerOf(state, viewer));
  if (plan.pick) you.members.push({ candidateId: plan.pick, regionId: null, assignedTurn: null });
  return you;
}

export interface PlanLine {
  trackId: string;
  from: number;
  to: number;
  cost: number;
  /** Wallet id ("base" for base money) to amount; null when the money allowed here runs out. */
  paidFrom: Record<string, number> | null;
}

/** The plan's moves in the order the engine pays them, with how each is paid. */
export function planLines(state: GameState, plan: Plan, viewer: string): PlanLine[] {
  const payer = plannedPlayer(state, plan, viewer);
  const order = trackIds(pack);
  return Object.entries(plan.steps ?? {})
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([trackId, to]) => {
      const from = meterOf(state, trackId, viewer).steps;
      const cost = moveCost(pack, payer, trackId, from, to);
      return { trackId, from, to, cost, paidFrom: pay(pack, payer, trackId, cost) };
    });
}

/** Board colours from the match: each region in its leader's shade for their pips, pip bars for the top three. */
export function boardStyles(state: GameState, plan: Plan, highlight: string | null, viewer: string | null): Record<string, RegionStyle> {
  const color = Object.fromEntries(state.players.map((p) => [p.id, hexToNumber(p.party.color)]));
  const you = viewer ? playerOf(state, viewer) : null;
  const styles: Record<string, RegionStyle> = {};
  for (const r of pack.regions) {
    const top = regionRanking(state, r.id)
      .map((id) => ({ id, steps: meterOf(state, r.id, id).steps }))
      .filter((x) => x.steps > 0);
    const leader = top[0];
    let fill = leader ? shadeFor(color[leader.id]!, leader.steps, pack.rules.steps) : EMPTY;
    // Rival view: regions that rival leads stay lit, the rest fade.
    if (highlight && leader?.id !== highlight) fill = tint(fill, 0.65);
    styles[r.id] = {
      fill,
      shares: top.slice(0, 3).map((x) => ({ color: color[x.id]!, share: x.steps })),
      locked: state.locked[r.id] !== undefined,
      member: (you?.members.some((m) => m.regionId === r.id) ?? false) || Object.values(plan.assign ?? {}).includes(r.id),
      planned: plan.steps?.[r.id] !== undefined,
    };
  }
  return styles;
}

/** Prepared boards for checking election night end to end: a hung parliament and a dead heat. */
export type Scenario = "hung" | "tie";

/** A UK match on its final turn with a prepared board. Pips are set directly, as if earned over earlier turns. */
export function scenarioGame(kind: Scenario): GameState {
  const s = newGame(7);
  s.turn = 9;
  s.phase = "final";
  const give = (regionId: string, playerId: string, steps: number, turn: number) => {
    const m = s.meters[regionId]![playerId]!;
    m.steps = steps;
    m.entered = true;
    m.reached = Array.from({ length: steps }, () => turn * 2);
  };
  if (kind === "hung") {
    // Zoogor 274, Tea Break 214, Queue Appreciation Society 162: nobody reaches 326.
    const owners: Record<string, string> = { se: YOU, lon: YOU, sw: YOU, wal: YOU, ni: YOU, nw: "tea", sco: "tea", wm: "tea", ne: "tea", ee: "queue", yh: "queue", em: "queue" };
    for (const [r, p] of Object.entries(owners)) give(r, p, 3, 2);
  } else {
    // You and Tea Break level everywhere; odd seat counts alternate who got there first, so it ends 325 each.
    let youFirst = true;
    for (const r of pack.regions) {
      const odd = r.seats % 2 === 1;
      give(r.id, YOU, 3, odd && !youFirst ? 3 : 2);
      give(r.id, "tea", 3, odd && youFirst ? 3 : 2);
      if (odd) youFirst = !youFirst;
    }
  }
  return s;
}

/**
 * Election-night colours: called regions in the colour of the party that won the most seats there, at full
 * strength, with the seat split as the badge bar; regions not yet called stay unpainted.
 */
export function electionStyles(state: GameState, calls: { regionId: string; seats: Record<string, number>; winner: string | null }[], called: number): Record<string, RegionStyle> {
  const color = Object.fromEntries(state.players.map((p) => [p.id, hexToNumber(p.party.color)]));
  const styles: Record<string, RegionStyle> = {};
  for (const r of pack.regions) styles[r.id] = { fill: EMPTY };
  calls.slice(0, called).forEach((c) => {
    const split = Object.entries(c.seats).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    styles[c.regionId] = {
      fill: c.winner ? color[c.winner]! : EMPTY,
      shares: split.slice(0, 3).map(([id, n]) => ({ color: color[id]!, share: n })),
    };
  });
  return styles;
}
