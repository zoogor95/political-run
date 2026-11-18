import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countElection, createMatch, finishElection, majority, planAi, resolveTurn, totalSeats, validatePack, type MapPack, type Plan } from "@majority-map/core";
import myJson from "../packs/my/pack.json" with { type: "json" };

const my = myJson as MapPack;
const board = JSON.parse(readFileSync(new URL("../maps/my.json", import.meta.url), "utf8")) as { regions: { id: string; seats: number }[] };

describe("Malaysia pack", () => {
  it("validates", () => {
    expect(validatePack(my)).toEqual([]);
  });

  it("has the Dewan Rakyat's 222 seats and needs 112 for a majority", () => {
    expect(my.regions).toHaveLength(16);
    expect(totalSeats(my)).toBe(222);
    expect(majority(my)).toBe(112);
  });

  it("has the board's regions and seat counts", () => {
    expect(Object.fromEntries(my.regions.map((r) => [r.id, r.seats]))).toEqual(Object.fromEntries(board.regions.map((r) => [r.id, r.seats])));
  });

  it("puts every region in at least one state group", () => {
    const grouped = new Set(my.groups.filter((g) => g.kind === "state").flatMap((g) => g.regions));
    expect(my.regions.filter((r) => !grouped.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  it("spreads about 21 million registered voters across the regions by seats", () => {
    const total = my.regions.reduce((a, r) => a + (r.voters ?? 0), 0);
    expect(Math.abs(total - 21_100_000)).toBeLessThan(20_000);
  });

  it("uses no ethnic or religious groups: groups are places and kinds of work or age", () => {
    expect(my.groups.map((g) => g.id).sort()).toEqual(["borneo", "business", "civil-servants", "east-coast", "federal-territories", "klang-valley", "north", "rural", "south", "urban", "west-coast", "workers", "youth"]);
  });

  it("plays a full match between Hard AIs to a 222-seat result", () => {
    const leaders = ["anwar-ibrahim", "muhyiddin-yassin", "ahmad-zahid-hamidi"];
    let s = createMatch(my, { seed: 11, players: leaders.map((leaderId, i) => ({ id: `p${i}`, leaderId, party: { name: `P${i}`, color: `#00000${i}`, emblem: `e${i}` } })) });
    let rng = 5;
    for (let guard = 0; guard < 120 && s.phase !== "finished"; guard++) {
      if (s.phase === "election") {
        const count = countElection(my, s);
        expect(Object.values(count.seats).reduce((a, b) => a + b, 0)).toBe(222);
        s = finishElection(my, s).state;
        continue;
      }
      const plans: Record<string, Plan> = {};
      for (const p of s.players) {
        const r = planAi(my, s, p.id, "hard", rng);
        rng = r.rng;
        plans[p.id] = r.plan;
      }
      s = resolveTurn(my, s, plans).state;
    }
    expect(s.phase).toBe("finished");
  });
});
