/**
 * Sample standings for the board lab: a match on any board with made-up pips, worked out by the real rules engine
 * (leaders, seat splits and projected seats come from @majority-map/core).
 */
import type { BoardData, RegionStyle } from "@majority-map/board";
import { hexToNumber, shadeFor } from "@majority-map/board";
import { PARLIAMENTARY_RULES, createMatch, nextRandom, projectedSeats, regionRanking, seedRng, splitSeats } from "@majority-map/core";
import type { GameState, MapPack } from "@majority-map/core";

export interface Party {
  id: string;
  name: string;
  color: string;
}

/** Your party first, then made-up AI parties for each country. */
const PARTIES: Record<string, Party[]> = {
  uk: [
    { id: "zoogor", name: "Zoogor Party", color: "#6a3fc8" },
    { id: "tea", name: "Tea Break Party", color: "#0f4fa8" },
    { id: "queue", name: "Queue Appreciation Society", color: "#12a3b8" },
    { id: "umbrella", name: "Umbrella Alliance", color: "#f6a01a" },
  ],
  pk: [
    { id: "zoogor", name: "Zoogor Party", color: "#6a3fc8" },
    { id: "mango", name: "Mango Season Party", color: "#a3195b" },
    { id: "biryani", name: "Biryani Front", color: "#b71c1c" },
    { id: "rickshaw", name: "Rickshaw Union", color: "#d86a1c" },
  ],
  in: [
    { id: "zoogor", name: "Zoogor Alliance", color: "#6a3fc8" },
    { id: "tiffin", name: "Grand Tiffin Alliance", color: "#e06b00" },
    { id: "kabaddi", name: "Kabaddi Club", color: "#1d9e5d" },
  ],
  my: [
    { id: "zoogor", name: "Zoogor Party", color: "#6a3fc8" },
    { id: "durian", name: "Durian Lovers Alliance", color: "#1d9e5d" },
    { id: "tehtarik", name: "Teh Tarik Party", color: "#2a3ca8" },
    { id: "hornbill", name: "Hornbill Club", color: "#d18e0a" },
  ],
  us: [
    { id: "zoogor", name: "Zoogor", color: "#6a3fc8" },
    { id: "rivera", name: "Rivera", color: "#df4338" },
    { id: "okafor", name: "Okafor", color: "#2f6fdf" },
  ],
};

export interface Sample {
  pack: MapPack;
  state: GameState;
  parties: Party[];
  styles: Record<string, RegionStyle>;
  seats: Record<string, number>;
}

export function makeSample(board: BoardData, seed = 7): Sample {
  const parties = PARTIES[board.id] ?? PARTIES.uk!;
  const steps = board.id === "us" ? 10 : 15;
  const pack: MapPack = {
    id: board.id,
    name: board.id,
    gameType: board.id === "us" ? "presidential" : "parliamentary",
    currency: "£",
    rules: { ...PARLIAMENTARY_RULES, steps },
    regions: board.regions.map((r) => ({ id: r.id, name: r.name, seats: r.seats, baseCost: 5000 + 200 * r.seats })),
    groups: [],
    candidates: parties.map((p) => ({ id: `leader-${p.id}`, name: p.name, affiliation: "Sample", modifiers: {} })),
    aiPartyNames: [],
  };
  const state = createMatch(pack, {
    seed,
    players: parties.map((p) => ({ id: p.id, leaderId: `leader-${p.id}`, party: { name: p.name, color: p.color, emblem: p.id } })),
  });

  // Made-up pips: most regions contested by two or three parties, a few still empty.
  let rng = seedRng(seed);
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  for (const r of board.regions) {
    if (rand() < 0.08) continue;
    const favourite = Math.floor(rand() * parties.length);
    parties.forEach((p, i) => {
      const roll = rand();
      const pips = i === favourite ? 3 + Math.floor(roll * (steps - 3)) : roll < 0.45 ? 0 : Math.floor(roll * (steps * 0.6));
      const m = state.meters[r.id]![p.id]!;
      m.steps = pips;
      m.reached = Array.from({ length: pips }, (_, k) => k * 2 + Math.floor(rand() * 3));
      m.entered = pips > 0;
    });
    if (state.meters[r.id]![parties[0]!.id]!.steps >= steps) state.locked[r.id] = parties[0]!.id;
  }

  const color = Object.fromEntries(parties.map((p) => [p.id, hexToNumber(p.color)]));
  const styles: Record<string, RegionStyle> = {};
  for (const r of board.regions) {
    const ranking = regionRanking(state, r.id);
    const top = ranking.map((id) => ({ id, steps: state.meters[r.id]![id]!.steps })).filter((x) => x.steps > 0);
    const leader = top[0];
    styles[r.id] = {
      fill: shadeFor(leader ? color[leader.id]! : 0, leader?.steps ?? 0, steps),
      shares: top.slice(0, 3).map((x) => ({ color: color[x.id]!, share: x.steps })),
      locked: state.locked[r.id] !== undefined,
      member: r.id === board.regions[0]!.id,
    };
  }
  return { pack, state, parties, styles, seats: projectedSeats(pack, state) };
}

export function regionDetail(sample: Sample, regionId: string) {
  const region = sample.pack.regions.find((r) => r.id === regionId)!;
  const split = splitSeats(sample.state, regionId, region.seats);
  return {
    region,
    rows: regionRanking(sample.state, regionId).map((id) => ({
      party: sample.parties.find((p) => p.id === id)!,
      pips: sample.state.meters[regionId]![id]!.steps,
      seats: split[id] ?? 0,
    })),
  };
}
