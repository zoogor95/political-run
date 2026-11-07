import { PARLIAMENTARY_RULES, createMatch } from "../src/index.js";
import type { GameState, MapPack, Meter } from "../src/index.js";

/** A small three-region Parliamentary map for tests. */
export const testPack: MapPack = {
  id: "test",
  name: "Testland",
  gameType: "parliamentary",
  currency: "£",
  rules: PARLIAMENTARY_RULES,
  regions: [
    { id: "north", name: "North", seats: 40, baseCost: 10_000 },
    { id: "south", name: "South", seats: 30, baseCost: 10_000 },
    { id: "city", name: "City", seats: 75, baseCost: 20_000 },
  ],
  groups: [
    { id: "capital", name: "Capital", kind: "state", regions: ["city"], income: 50_000 },
    { id: "mainland", name: "Mainland", kind: "state", regions: ["north", "south", "city"], income: 50_000 },
    { id: "unions", name: "Trade unions", kind: "national", regions: [], income: 40_000, baseCost: 30_000 },
  ],
  candidates: [
    { id: "ann", name: "Ann", affiliation: "Party One", modifiers: { capital: 10 } },
    { id: "bob", name: "Bob", affiliation: "Party Two", modifiers: { mainland: -10 } },
    { id: "cat", name: "Cat", affiliation: "Party Three", modifiers: { capital: 50 } },
    { id: "dev", name: "Dev", affiliation: "Party One", modifiers: { capital: 40, unions: 10 } },
    { id: "eve", name: "Eve", affiliation: "Party Two", modifiers: { mainland: -50 } },
  ],
  aiPartyNames: ["Tea Break Party", "Queue Appreciation Society", "Umbrella Alliance", "Sunny Spells Party"],
};

export function newMatch(players = ["a", "b", "c"]): GameState {
  const leaders = ["ann", "bob", "cat", "dev", "eve"];
  return createMatch(testPack, {
    seed: 42,
    players: players.map((id, i) => ({
      id,
      leaderId: leaders[i]!,
      party: { name: `${id} Party`, color: `#00000${i}`, emblem: `emblem-${i}` },
    })),
  });
}

/** Puts a player straight onto a step, as if they had reached each step at the given turn. For setting up examples. */
export function setSteps(state: GameState, regionId: string, playerId: string, steps: number, turn = 0): void {
  const meter: Meter = state.meters[regionId]![playerId]!;
  meter.steps = steps;
  meter.reached = Array.from({ length: steps }, () => turn * 2);
  meter.entered = steps > 0 || meter.entered;
}

export function richen(state: GameState, amount = 10_000_000): void {
  state.players.forEach((p) => (p.money = amount));
}
