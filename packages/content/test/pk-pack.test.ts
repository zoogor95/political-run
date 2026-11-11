import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countElection, createMatch, finishElection, majority, planAi, resolveTurn, totalSeats, validatePack, type MapPack, type Plan } from "@majority-map/core";
import pkJson from "../packs/pk/pack.json" with { type: "json" };

const pk = pkJson as MapPack;
const board = JSON.parse(readFileSync(new URL("../maps/pk.json", import.meta.url), "utf8")) as { regions: { id: string; seats: number; area: string }[] };
const PROVINCES: Record<string, string> = { pb: "punjab", sd: "sindh", kp: "kp", ba: "balochistan", is: "capital" };

describe("Pakistan pack", () => {
  it("validates", () => {
    expect(validatePack(pk)).toEqual([]);
  });

  it("has 266 general and 70 reserved seats, 336 in all, and needs 169 for a majority", () => {
    expect(pk.regions.reduce((a, r) => a + r.seats, 0)).toBe(266);
    expect(pk.reservedSeats!.reduce((a, d) => a + d.seats, 0)).toBe(70);
    expect(totalSeats(pk)).toBe(336);
    expect(majority(pk)).toBe(169);
  });

  it("has the board's regions and seat counts", () => {
    expect(Object.fromEntries(pk.regions.map((r) => [r.id, r.seats]))).toEqual(Object.fromEntries(board.regions.map((r) => [r.id, r.seats])));
  });

  it("puts every region in its province's group, and shares women's seats by province", () => {
    for (const r of board.regions) expect(pk.groups.find((g) => g.id === PROVINCES[r.area])!.regions, r.id).toContain(r.id);
    const women = Object.fromEntries(pk.reservedSeats!.filter((d) => d.group).map((d) => [d.group, d.seats]));
    expect(women).toEqual({ punjab: 32, sindh: 14, kp: 10, balochistan: 4 });
    expect(pk.reservedSeats!.find((d) => !d.group)?.seats).toBe(10);
  });

  it("spreads the Election Commission's 128.6 million registered voters across the regions", () => {
    expect(Math.abs(pk.regions.reduce((a, r) => a + (r.voters ?? 0), 0) - 128_585_760)).toBeLessThan(100);
  });

  it("prices national group meters above most regions", () => {
    const costs = pk.regions.map((r) => r.baseCost).sort((a, b) => a - b);
    const median = costs[Math.floor(costs.length / 2)]!;
    for (const g of pk.groups.filter((x) => x.kind === "national")) expect(g.baseCost!).toBeGreaterThan(median);
  });

  it("plays a full match between Hard AIs to a 336-seat result", () => {
    const leaders = ["maryam-nawaz", "bilawal-bhutto-zardari", "imran-khan"];
    let s = createMatch(pk, { seed: 11, players: leaders.map((leaderId, i) => ({ id: `p${i}`, leaderId, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })) });
    let rng = 5;
    for (let guard = 0; guard < 120 && s.phase !== "finished"; guard++) {
      if (s.phase === "election") {
        const count = countElection(pk, s);
        expect(Object.values(count.seats).reduce((a, b) => a + b, 0)).toBe(336);
        s = finishElection(pk, s).state;
        continue;
      }
      const plans: Record<string, Plan> = {};
      for (const p of s.players) {
        const r = planAi(pk, s, p.id, "hard", rng);
        rng = r.rng;
        plans[p.id] = r.plan;
      }
      s = resolveTurn(pk, s, plans).state;
    }
    expect(s.phase).toBe("finished");
  });
});
