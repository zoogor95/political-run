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
export function plannedPlayer(state: GameState, plan: Plan): PlayerState {
  const you = structuredClone(playerOf(state, YOU));
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
export function planLines(state: GameState, plan: Plan): PlanLine[] {
  const payer = plannedPlayer(state, plan);
  const order = trackIds(pack);
  return Object.entries(plan.steps ?? {})
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([trackId, to]) => {
      const from = meterOf(state, trackId, YOU).steps;
      const cost = moveCost(pack, payer, trackId, from, to);
      return { trackId, from, to, cost, paidFrom: pay(pack, payer, trackId, cost) };
    });
}

/** Board colours from the match: each region in its leader's shade for their pips, pip bars for the top three. */
export function boardStyles(state: GameState, plan: Plan, highlight: string | null): Record<string, RegionStyle> {
  const color = Object.fromEntries(state.players.map((p) => [p.id, hexToNumber(p.party.color)]));
  const you = playerOf(state, YOU);
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
      member: you.members.some((m) => m.regionId === r.id) || Object.values(plan.assign ?? {}).includes(r.id),
      planned: plan.steps?.[r.id] !== undefined,
    };
  }
  return styles;
}
