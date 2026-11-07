import { describe, expect, it } from "vitest";
import { finishElection, likelyTargets, planAi, planEasy, resolveTurn, totalMoney, validatePlan } from "../src/index.js";
import type { Plan } from "../src/index.js";
import { newMatch, setSteps, testPack as pack } from "./fixtures.js";

describe("Easy AI", () => {
  it("plays a whole match with valid plans and spends most of its money", () => {
    let s = newMatch(["a", "b", "c"]);
    let rng = 99;
    let spentShare = 0;
    let turns = 0;
    for (let guard = 0; guard < 120 && s.phase !== "finished"; guard++) {
      if (s.phase === "election") {
        s = finishElection(pack, s).state;
        continue;
      }
      const plans: Record<string, Plan> = {};
      for (const p of s.players) {
        const r = planEasy(pack, s, p.id, rng);
        rng = r.rng;
        plans[p.id] = r.plan;
      }
      const before = totalMoney(s.players[0]!);
      const next = resolveTurn(pack, s, plans).state; // throws if any plan were invalid
      spentShare += next.players[0]!.spent - s.players[0]!.spent > 0 ? (next.players[0]!.spent - s.players[0]!.spent) / before : 0;
      s = next;
      turns++;
    }
    expect(s.phase).toBe("finished");
    expect(spentShare / turns).toBeGreaterThan(0.4);
  });

  it("picks a member on a pick turn and assigns waiting members to entered regions", () => {
    const s = newMatch();
    s.turn = 5;
    setSteps(s, "city", "a", 2);
    const { plan } = planEasy(pack, s, "a", 3);
    expect(plan.pick).toBeDefined();
    expect(["ann", "bob", "cat"]).not.toContain(plan.pick);
    expect(plan.assign).toEqual({ [plan.pick!]: "city" });
    expect(validatePlan(pack, s, "a", plan)).toEqual([]);
  });

  it("is deterministic for the same random state", () => {
    const s = newMatch();
    expect(planEasy(pack, s, "a", 5)).toEqual(planEasy(pack, s, "a", 5));
  });
});

describe("Normal and Hard AI", () => {
  for (const level of ["normal", "hard"] as const) {
    it(`${level} plays a whole match with valid plans`, () => {
      let s = newMatch(["a", "b", "c"]);
      let rng = 7;
      for (let guard = 0; guard < 120 && s.phase !== "finished"; guard++) {
        if (s.phase === "election") {
          s = finishElection(pack, s).state;
          continue;
        }
        const plans: Record<string, Plan> = {};
        for (const p of s.players) {
          const r = planAi(pack, s, p.id, level, rng);
          rng = r.rng;
          plans[p.id] = r.plan;
        }
        s = resolveTurn(pack, s, plans).state; // throws if a plan were invalid
      }
      expect(s.phase).toBe("finished");
    });
  }

  it("spends nearly everything on the final turn", () => {
    const s = newMatch();
    s.phase = "final";
    for (const r of ["north", "south", "city"]) setSteps(s, r, "b", 3);
    setSteps(s, "north", "a", 2);
    const { plan } = planAi(pack, s, "a", "hard", 4);
    const after = resolveTurn(pack, s, { a: plan }).state.players[0]!;
    expect(after.spent / totalMoney(s.players[0]!)).toBeGreaterThan(0.85);
  });

  it("knows which steps a rival is likely to aim for", () => {
    const s = newMatch();
    expect([...likelyTargets(pack, s, "b", "north")]).toEqual([1, 2]);
    setSteps(s, "north", "b", 3);
    setSteps(s, "north", "c", 5);
    expect([...likelyTargets(pack, s, "b", "north")].sort()).toEqual([4, 5, 6]);
    s.locked.north = "c";
    expect(likelyTargets(pack, s, "b", "north").size).toBe(0);
  });
});
