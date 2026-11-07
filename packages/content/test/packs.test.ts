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

  it("can start a full match and price a London move like the design (Starmer: step 10 about £42.4K)", () => {
    const s = createMatch(uk, {
      seed: 1,
      players: [
        { id: "zoogor", leaderId: "keir-starmer", party: { name: "Zoogor Party", color: "#6a3fc8", emblem: "megaphone" } },
        { id: "ai-1", leaderId: "kemi-badenoch", party: { name: "Tea Break Party", color: "#0f4fa8", emblem: "teacup" } },
      ],
    });
    const cost = moveCost(uk, s.players[0]!, "lon", 9, 10);
    expect(Math.round(cost / 100) / 10).toBe(42.4);
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
    broken.rules.firstEntryMax = 3;
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
