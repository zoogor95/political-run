import { describe, expect, it } from "vitest";
import { finishElection, planEasy, resolveTurn, totalMoney, validatePlan } from "../src/index.js";
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
