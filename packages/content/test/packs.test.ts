import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createMatch,
  finishElection,
  isPickTurn,
  majority,
  moveCost,
  planEasy,
  projectedSeats,
  resolveTurn,
  totalSeats,
  trackIds,
  validatePack,
  validatePlan,
} from "@majority-map/core";
import type { MapPack, Plan } from "@majority-map/core";
import ukJson from "../packs/uk/pack.json" with { type: "json" };

const uk = ukJson as MapPack;

describe("UK pack", () => {
  it("validates", () => {
    expect(validatePack(uk)).toEqual([]);
  });

  it("has the real 650 seats and needs 326 for a majority", () => {
    expect(uk.regions).toHaveLength(12);
    expect(totalSeats(uk)).toBe(650);
    expect(majority(uk)).toBe(326);
  });

  it("puts every region in at least one state group", () => {
    const grouped = new Set(uk.groups.filter((g) => g.kind === "state").flatMap((g) => g.regions));
    expect(uk.regions.filter((r) => !grouped.has(r.id))).toEqual([]);
  });

  it("can start a full match and price a London move (Starmer is 15% cheaper in London: step 10 costs £40K, to the nearest £1K)", () => {
    const s = createMatch(uk, {
      seed: 1,
      players: [
        { id: "zoogor", leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
        { id: "ai-1", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      ],
    });
    const cost = moveCost(uk, s.players[0]!, "lon", 9, 10);
    expect(cost).toBe(40_000);
  });
});

describe("validator", () => {
  it("catches a deliberately broken pack", () => {
    const broken: MapPack = structuredClone(uk);
    broken.regions[1]!.id = broken.regions[0]!.id;
    broken.regions[2]!.seats = 0;
    broken.groups[0]!.regions.push("atlantis");
    broken.candidates[0]!.modifiers.nowhere = 10;
    broken.candidates[1]!.modifiers.north = 80;
    broken.rules.firstEntryMax = broken.rules.contentionAt;
    broken.aiPartyNames = ["Tea Break Party", "tea break party"];
    const paths = validatePack(broken).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "rules.firstEntryMax",
        "regions[1].id",
        "regions[2].seats",
        "groups[0].regions",
        "candidates[0].modifiers.nowhere",
        "candidates[1].modifiers.north",
        "aiPartyNames",
      ]),
    );
  });
});

describe("UK economy", () => {
  it("prices national group meters above most regions", () => {
    const regionCosts = uk.regions.map((r) => r.baseCost).sort((a, b) => a - b);
    const median = regionCosts[Math.floor(regionCosts.length / 2)]!;
    for (const g of uk.groups.filter((x) => x.kind === "national")) expect(g.baseCost!).toBeGreaterThan(median);
  });
});

describe("a full UK match", () => {
  it("plays from turn 1 to a finished election with simple bots", () => {
    const players = [
      { id: "zoogor", leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
      { id: "tea", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      { id: "queue", leaderId: "nigel-farage", party: { name: "Queue Appreciation Society", color: "#12a3b8", emblem: "ticket" } },
    ];
    let state = createMatch(uk, { seed: 7, players });
    const tracks = trackIds(uk);
    let elections = 0;
    let groupIncome = 0;
    for (let guard = 0; guard < 200 && state.phase !== "finished"; guard++) {
      if (state.phase === "election") {
        state = finishElection(uk, state).state;
        elections++;
        continue;
      }
      // Each bot walks the tracks from a different starting point and adds steps while the plan stays valid.
      const plans: Record<string, Plan> = {};
      state.players.forEach((p, i) => {
        const plan: Plan = { steps: {} };
        if (isPickTurn(uk, state)) {
          const pick = uk.candidates.find((c) => !state.players.some((q) => q.leaderId === c.id) && !p.members.some((m) => m.candidateId === c.id));
          if (pick) plan.pick = pick.id;
        }
        for (let k = 0; k < tracks.length; k++) {
          const id = tracks[(k + i * 4 + state.turn) % tracks.length]!;
          const now = state.meters[id]![p.id]!;
          const target = Math.min(uk.rules.steps, now.steps + (now.entered ? 2 : 1));
          if (target <= now.steps || state.locked[id] !== undefined) continue;
          const tryPlan = { ...plan, steps: { ...plan.steps, [id]: target } };
          if (validatePlan(uk, state, p.id, tryPlan).length === 0) plan.steps = tryPlan.steps;
        }
        plans[p.id] = plan;
      });
      const r = resolveTurn(uk, state, plans);
      groupIncome += r.events.filter((e) => e.type === "income").reduce((a, e) => a + (e.type === "income" ? Object.values(e.groups).reduce((x, y) => x + y, 0) : 0), 0);
      state = r.state;
    }
    expect(state.phase).toBe("finished");
    expect(elections).toBeGreaterThanOrEqual(1);
    expect(groupIncome).toBeGreaterThan(0);
    const seats = projectedSeats(uk, state);
    expect(Object.values(seats).reduce((a, b) => a + b, 0)).toBe(650);
    for (const p of state.players) {
      expect(p.money).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(p.wallets)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("a UK match between Easy AIs", () => {
  it("finishes with members picked and lasts a sensible number of turns", () => {
    const players = [
      { id: "zoogor", leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
      { id: "tea", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      { id: "queue", leaderId: "nigel-farage", party: { name: "Queue Appreciation Society", color: "#12a3b8", emblem: "ticket" } },
    ];
    let state = createMatch(uk, { seed: 11, players });
    let rng = state.rng;
    let campaignTurns = 0;
    for (let guard = 0; guard < 200 && state.phase !== "finished"; guard++) {
      if (state.phase === "election") {
        state = finishElection(uk, state).state;
        continue;
      }
      const plans: Record<string, Plan> = {};
      for (const p of state.players) {
        const r = planEasy(uk, state, p.id, rng);
        rng = r.rng;
        plans[p.id] = r.plan;
      }
      state = resolveTurn(uk, state, plans).state;
      campaignTurns++;
    }
    console.log(`UK Easy-AI match: ${campaignTurns} campaign turns, round ${state.round}, members ${state.players.map((p) => p.members.length).join("/")}`);
    expect(state.phase).toBe("finished");
    expect(campaignTurns).toBeGreaterThanOrEqual(5);
    expect(campaignTurns).toBeLessThanOrEqual(30);
    expect(state.players.every((p) => p.members.length >= 1)).toBe(true);
  });
});

describe("US pack", () => {
  const us = JSON.parse(readFileSync(new URL("../packs/us/pack.json", import.meta.url), "utf8")) as MapPack;
  const results = JSON.parse(readFileSync(new URL("../packs/us/results-2024.json", import.meta.url), "utf8")) as {
    states: { id: string; ev: number; votes: number; republican: number; democratic: number }[];
  };

  it("validates as a Presidential pack with 538 electoral votes and 270 to win", () => {
    expect(validatePack(us)).toEqual([]);
    expect(us.gameType).toBe("presidential");
    expect(us.regions).toHaveLength(51);
    expect(totalSeats(us)).toBe(538);
    expect(majority(us)).toBe(270);
    expect(us.rules.steps).toBe(10);
    expect(us.rules.costGrowth).toBe(1);
    expect(us.rules.runningMateTurn).toBe(5);
  });

  it("matches the board and the 2024 results: electoral votes, voters and step costs", () => {
    const board = JSON.parse(readFileSync(new URL("../maps/us.json", import.meta.url), "utf8")) as { regions: { id: string; seats: number }[] };
    for (const r of us.regions) {
      const row = results.states.find((s) => s.id === r.id)!;
      expect(board.regions.find((b) => b.id === r.id)?.seats).toBe(r.seats);
      expect(row.ev).toBe(r.seats);
      expect(r.voters).toBe(row.votes);
      const margin = Math.abs(row.republican - row.democratic);
      const comp = 1 + 0.6 * Math.max(0, 1 - margin / 25);
      expect(r.baseCost).toBe(Math.round((2000 + 1500 * r.seats * comp) / 1000) * 1000);
    }
    expect(us.regions.reduce((a, r) => a + (r.voters ?? 0), 0)).toBe(155_240_955);
  });

  it("puts every state in a state group and calls every state once, east to west", () => {
    const grouped = new Set(us.groups.filter((g) => g.kind === "state").flatMap((g) => g.regions));
    expect(us.regions.filter((r) => !grouped.has(r.id))).toEqual([]);
    expect([...us.callOrder!].sort()).toEqual(us.regions.map((r) => r.id).sort());
    expect(us.callOrder!.slice(0, 2)).toEqual(["ga", "in"]);
    expect(us.callOrder!.at(-1)).toBe("ak");
  });

  it("gives every candidate a party and a reason for every modifier", () => {
    for (const c of us.candidates) {
      expect(["Republican", "Democratic", "Independent"]).toContain(c.affiliation);
      expect(Object.keys(c.notes ?? {}).sort()).toEqual(Object.keys(c.modifiers).sort());
    }
  });

  it("plays a whole Easy match through to a winner", () => {
    let s = createMatch(us, {
      seed: 3,
      players: ["a", "b", "c"].map((id, i) => ({ id, leaderId: us.candidates[i * 5]!.id, party: { name: id, color: `#00000${i}`, emblem: `e${i}` } })),
    });
    let rng = 3;
    for (let guard = 0; guard < 300 && s.phase !== "finished"; guard++) {
      if (s.phase === "election") {
        s = finishElection(us, s).state;
        continue;
      }
      const plans: Record<string, Plan> = {};
      for (const p of s.players) {
        const r = planEasy(us, s, p.id, rng);
        rng = r.rng;
        expect(validatePlan(us, s, p.id, r.plan)).toEqual([]);
        plans[p.id] = r.plan;
      }
      s = resolveTurn(us, s, plans).state;
    }
    expect(s.phase).toBe("finished");
  });
});
