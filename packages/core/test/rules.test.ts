import { describe, expect, it } from "vitest";
import {
  allInContention,
  costMultiplier,
  inContention,
  moveCost,
  regionLeader,
  resolveTurn,
  stepCost,
  validatePlan,
} from "../src/index.js";
import { newMatch, richen, setSteps, testPack as pack } from "./fixtures.js";

describe("step costs", () => {
  it("each Parliamentary step costs 1.1x the previous one, with the candidate's bonus applied", () => {
    // GDD region card: London, base £20K, a -10% cost bonus: step 10 is £42.4K and step 11 is £46.7K.
    const s = newMatch();
    const ann = s.players[0]!; // Ann: +10% Capital, so City steps are 10% cheaper
    expect(costMultiplier(pack, ann, "city")).toBeCloseTo(0.9);
    expect(stepCost(pack, ann, "city", 10)).toBe(42_443);
    expect(stepCost(pack, ann, "city", 11)).toBe(46_687);
    expect(moveCost(pack, ann, "city", 9, 11)).toBe(42_443 + 46_687);
  });

  it("adds modifiers from every group a region belongs to", () => {
    const s = newMatch(["a", "b", "c", "d"]);
    const dev = s.players[3]!; // +40% Capital; City is also in Mainland (no modifier)
    expect(costMultiplier(pack, dev, "city")).toBeCloseTo(0.6);
    const bob = s.players[1]!; // -10% Mainland: penalties make steps dearer
    expect(costMultiplier(pack, bob, "north")).toBeCloseTo(1.1);
  });

  it("clamps step costs to 50%-150% of the base cost", () => {
    const s = newMatch();
    const cat = s.players[2]!;
    cat.members.push({ candidateId: "dev", regionId: null, assignedTurn: null }); // 50% + 20% of 40% = 58%
    expect(costMultiplier(pack, cat, "city")).toBe(0.5);
    const eve = { ...s.players[1]!, leaderId: "eve", members: [{ candidateId: "bob", regionId: null, assignedTurn: null }] }; // -50% - 2%
    expect(costMultiplier(pack, eve, "north")).toBe(1.5);
  });

  it("counts 20% of a party member's modifiers", () => {
    const s = newMatch();
    const bob = s.players[1]!;
    bob.members.push({ candidateId: "dev", regionId: null, assignedTurn: null }); // 20% of +40% Capital = +8%
    expect(costMultiplier(pack, bob, "city")).toBeCloseTo(1 + 0.1 - 0.08);
  });
});

describe("entering a region", () => {
  it("limits the first investment to 1 or 2 steps", () => {
    const s = newMatch();
    expect(validatePlan(pack, s, "a", { steps: { north: 2 } })).toEqual([]);
    expect(validatePlan(pack, s, "a", { steps: { north: 3 } }).map((i) => i.code)).toEqual(["entry_limit"]);
  });

  it("allows any number of steps once entered", () => {
    let s = newMatch();
    s = resolveTurn(pack, s, { a: { steps: { north: 1 } } }).state;
    richen(s);
    expect(validatePlan(pack, s, "a", { steps: { north: 9 } })).toEqual([]);
  });

  it("means no region can reach contention in a single turn", () => {
    const s = newMatch();
    richen(s);
    const r = resolveTurn(pack, s, { a: { steps: { north: 2 } }, b: { steps: { south: 2 } } });
    expect(inContention(pack, r.state, "north")).toBe(false);
  });

  it("only lets steps go up", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 4);
    expect(validatePlan(pack, s, "a", { steps: { north: 4 } }).map((i) => i.code)).toEqual(["not_higher"]);
    expect(validatePlan(pack, s, "a", { steps: { north: 16 } }).map((i) => i.code)).toEqual(["over_top"]);
  });

  it("refuses a plan the player can't afford", () => {
    const s = newMatch();
    s.players[0]!.money = 15_000;
    expect(validatePlan(pack, s, "a", { steps: { north: 2 } }).map((i) => i.code)).toEqual(["not_enough_money"]);
  });
});

describe("conflicts", () => {
  it("GDD example: A 3 to 7 and B 5 to 7 collide and lose the money; C 2 to 6 moves", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "north", "a", 3);
    setSteps(s, "north", "b", 5);
    setSteps(s, "north", "c", 2);
    const costA = moveCost(pack, s.players[0]!, "north", 3, 7);
    const costB = moveCost(pack, s.players[1]!, "north", 5, 7);
    const { state, events } = resolveTurn(pack, s, { a: { steps: { north: 7 } }, b: { steps: { north: 7 } }, c: { steps: { north: 6 } } });
    expect(state.meters.north!.a!.steps).toBe(3);
    expect(state.meters.north!.b!.steps).toBe(5);
    expect(state.meters.north!.c!.steps).toBe(6);
    expect(state.players[0]!.money).toBe(10_000_000 - costA + pack.rules.baseIncome);
    expect(state.players[1]!.money).toBe(10_000_000 - costB + pack.rules.baseIncome);
    expect(events).toContainEqual({ type: "conflict", regionId: "north", step: 7, playerIds: ["a", "b"], costs: { a: costA, b: costB } });
  });

  it("three or more on the same number all collide", () => {
    const s = newMatch();
    richen(s);
    const { state } = resolveTurn(pack, s, { a: { steps: { south: 2 } }, b: { steps: { south: 2 } }, c: { steps: { south: 2 } } });
    expect(["a", "b", "c"].map((id) => state.meters.south![id]!.steps)).toEqual([0, 0, 0]);
  });

  it("different target numbers never collide", () => {
    const s = newMatch();
    const { state } = resolveTurn(pack, s, { a: { steps: { south: 1 } }, b: { steps: { south: 2 } } });
    expect(state.meters.south!.a!.steps).toBe(1);
    expect(state.meters.south!.b!.steps).toBe(2);
  });

  it("reaching a step someone held from an earlier turn is not a conflict; the earlier one leads", () => {
    let s = newMatch();
    s = resolveTurn(pack, s, { a: { steps: { south: 2 } } }).state;
    const r = resolveTurn(pack, s, { b: { steps: { south: 2 } } });
    expect(r.events.some((e) => e.type === "conflict")).toBe(false);
    expect(r.state.meters.south!.b!.steps).toBe(2);
    expect(regionLeader(r.state, "south")).toBe("a");
  });

  it("a conflict on first entry counts as entered, so next turn any number of steps is allowed", () => {
    let s = newMatch();
    s = resolveTurn(pack, s, { a: { steps: { north: 2 } }, b: { steps: { north: 2 } } }).state;
    expect(s.meters.north!.a!).toMatchObject({ steps: 0, entered: true });
    richen(s);
    expect(validatePlan(pack, s, "a", { steps: { north: 6 } })).toEqual([]);
  });
});

describe("lead and locks", () => {
  it("the most steps leads; nobody leads an empty region", () => {
    const s = newMatch();
    expect(regionLeader(s, "north")).toBeNull();
    setSteps(s, "north", "b", 4);
    setSteps(s, "north", "a", 3);
    expect(regionLeader(s, "north")).toBe("b");
  });

  it("filling the meter locks the region for everyone", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "south", "a", 12);
    setSteps(s, "south", "b", 3);
    const r = resolveTurn(pack, s, { a: { steps: { south: 15 } }, b: { steps: { south: 5 } } });
    expect(r.state.locked.south).toBe("a");
    expect(r.state.meters.south!.b!.steps).toBe(5); // same-turn moves still land
    expect(r.events).toContainEqual({ type: "locked", regionId: "south", playerId: "a" });
    expect(validatePlan(pack, r.state, "b", { steps: { south: 6 } }).map((i) => i.code)).toEqual(["locked"]);
  });

  it("two players aiming at the top step collide, so neither locks", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "south", "a", 13);
    setSteps(s, "south", "b", 14);
    const r = resolveTurn(pack, s, { a: { steps: { south: 15 } }, b: { steps: { south: 15 } } });
    expect(r.state.locked.south).toBeUndefined();
  });
});

describe("party members and free pips", () => {
  it("picks happen every 5th turn and stack", () => {
    const s = newMatch();
    expect(validatePlan(pack, s, "a", { pick: "dev" }).map((i) => i.code)).toEqual(["not_pick_turn"]);
    s.turn = 5;
    expect(validatePlan(pack, s, "a", { pick: "dev" })).toEqual([]);
    const r = resolveTurn(pack, s, { a: { pick: "dev" } });
    expect(r.state.players[0]!.members).toHaveLength(1);
    expect(validatePlan(pack, r.state, "a", { pick: "eve" }).map((i) => i.code)).toEqual(["not_pick_turn"]);
  });

  it("the pool excludes yourself and opponents' leaders; two players may pick the same person", () => {
    const s = newMatch();
    s.turn = 5;
    expect(validatePlan(pack, s, "a", { pick: "ann" })[0]!.code).toBe("bad_pick");
    expect(validatePlan(pack, s, "a", { pick: "bob" })[0]!.code).toBe("bad_pick");
    const r = resolveTurn(pack, s, { a: { pick: "dev" }, b: { pick: "dev" } });
    expect(r.state.players.map((p) => p.members.length)).toEqual([1, 1, 0]);
  });

  it("members go only to regions you have entered, one per region, and can't be moved", () => {
    const s = newMatch();
    s.turn = 10; // second pick turn; one member already working in North
    setSteps(s, "north", "a", 2);
    s.players[0]!.members.push({ candidateId: "eve", regionId: "north", assignedTurn: 5 });
    expect(validatePlan(pack, s, "a", { pick: "dev", assign: { dev: "south" } })[0]!.code).toBe("bad_assign");
    expect(validatePlan(pack, s, "a", { pick: "dev", assign: { dev: "north" } })[0]!.code).toBe("bad_assign");
    expect(validatePlan(pack, s, "a", { assign: { eve: "north" } })[0]!.code).toBe("bad_assign");
  });

  it("an assigned member adds a free pip every 3 turns from assignment", () => {
    let s = newMatch();
    s.turn = 5;
    setSteps(s, "north", "a", 2);
    s = resolveTurn(pack, s, { a: { pick: "dev", assign: { dev: "north" } } }).state; // assigned on turn 5
    const stepsByTurn: number[] = [];
    for (let t = 6; t <= 11; t++) {
      s = resolveTurn(pack, s, {}).state;
      stepsByTurn.push(s.meters.north!.a!.steps);
    }
    expect(stepsByTurn).toEqual([2, 2, 3, 3, 3, 4]); // free pips on turns 8 and 11
  });

  it("GDD example: A at 3, B at 2; B buys 2 and reaches 4, then A's free pip brings A to 4; B leads", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "north", "a", 3);
    setSteps(s, "north", "b", 2);
    s.players[0]!.members.push({ candidateId: "dev", regionId: "north", assignedTurn: s.turn - 3 });
    const r = resolveTurn(pack, s, { b: { steps: { north: 4 } } });
    expect(r.state.meters.north!.a!.steps).toBe(4);
    expect(r.state.meters.north!.b!.steps).toBe(4);
    expect(regionLeader(r.state, "north")).toBe("b");
  });

  it("free pips are never part of a conflict", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "north", "a", 3);
    setSteps(s, "north", "b", 2);
    s.players[0]!.members.push({ candidateId: "dev", regionId: "north", assignedTurn: s.turn - 3 });
    const r = resolveTurn(pack, s, { b: { steps: { north: 4 } } });
    expect(r.events.some((e) => e.type === "conflict")).toBe(false);
  });

  it("free pips stop when the meter is full", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 15);
    s.locked.north = "a";
    s.players[0]!.members.push({ candidateId: "dev", regionId: "north", assignedTurn: s.turn - 3 });
    const r = resolveTurn(pack, s, {});
    expect(r.state.meters.north!.a!.steps).toBe(15);
  });
});

describe("contention and the final turn", () => {
  it("a region is in contention once anyone has 3 steps", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 2);
    expect(inContention(pack, s, "north")).toBe(false);
    setSteps(s, "north", "b", 3);
    expect(inContention(pack, s, "north")).toBe(true);
  });

  it("when every region is in contention the next turn is the final turn, then the election", () => {
    const s = newMatch();
    richen(s);
    setSteps(s, "north", "a", 3);
    setSteps(s, "south", "b", 3);
    setSteps(s, "city", "c", 2);
    const r1 = resolveTurn(pack, s, { c: { steps: { city: 3 } } });
    expect(allInContention(pack, r1.state)).toBe(true);
    expect(r1.state.phase).toBe("final");
    expect(r1.events).toContainEqual({ type: "final_turn" });
    expect(r1.events).toContainEqual({ type: "contention", regionId: "city" });
    const r2 = resolveTurn(pack, r1.state, {});
    expect(r2.state.phase).toBe("election");
    expect(validatePlan(pack, r2.state, "a", {}).map((i) => i.code)).toEqual(["not_campaigning"]);
  });

  it("the safety cap ends a stalled campaign", () => {
    const s = newMatch();
    s.turn = pack.rules.turnCap;
    expect(resolveTurn(pack, s, {}).state.phase).toBe("election");
  });
});

describe("money", () => {
  it("everyone starts with one turn of base money and gets it again every turn", () => {
    let s = newMatch();
    expect(s.players.map((p) => p.money)).toEqual([250_000, 250_000, 250_000]);
    s = resolveTurn(pack, s, { a: { steps: { north: 1 } } }).state;
    expect(s.players[0]!.money).toBe(500_000 - 10_000);
    expect(s.players[0]!.spent).toBe(10_000);
    expect(s.players[1]!.money).toBe(500_000);
  });

  it("resolveTurn refuses an invalid plan", () => {
    expect(() => resolveTurn(pack, newMatch(), { a: { steps: { north: 5 } } })).toThrow(/first investment/);
  });

  it("does not change the state it was given", () => {
    const s = newMatch();
    const copy = structuredClone(s);
    resolveTurn(pack, s, { a: { steps: { north: 2 } } });
    expect(s).toEqual(copy);
  });
});
