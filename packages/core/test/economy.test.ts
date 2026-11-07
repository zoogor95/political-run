import { describe, expect, it } from "vitest";
import {
  allInContention,
  finishElection,
  groupController,
  paymentOrder,
  resolveTurn,
  stepCost,
  validatePack,
  validatePlan,
} from "../src/index.js";
import { newMatch, richen, setSteps, testPack as pack } from "./fixtures.js";

// Test map: North (10K), South (10K), City (20K).
// State groups: Capital = City; Mainland = North + South + City (40K in campaign cost). National group: Trade unions.
// Leaders: a = Ann (+10% Capital), b = Bob (-10% Mainland), c = Cat (+50% Capital).

describe("test fixture", () => {
  it("is a valid pack", () => {
    expect(validatePack(pack)).toEqual([]);
  });
});

describe("state group control", () => {
  it("goes to whoever leads regions worth more than half the group's campaign cost", () => {
    const s = newMatch();
    setSteps(s, "city", "a", 1); // 20K of Mainland's 40K: exactly half
    expect(groupController(pack, s, "capital")).toBe("a");
    expect(groupController(pack, s, "mainland")).toBeNull();
    setSteps(s, "north", "a", 1); // 30K: over half
    expect(groupController(pack, s, "mainland")).toBe("a");
  });

  it("counts any lead, in contention or not, and the lead can change hands", () => {
    const s = newMatch();
    setSteps(s, "city", "a", 1, 1);
    setSteps(s, "city", "b", 1, 2); // equal steps: a got there first
    expect(groupController(pack, s, "capital")).toBe("a");
    setSteps(s, "city", "b", 2);
    expect(groupController(pack, s, "capital")).toBe("b");
  });
});

describe("national groups", () => {
  it("have their own meter with the same step rules, priced by the group modifier", () => {
    const s = newMatch(["a", "b", "c", "d"]);
    expect(stepCost(pack, s.players[3]!, "unions", 1)).toBe(27_000); // Dev: +10% Trade unions
    expect(validatePlan(pack, s, "a", { steps: { unions: 3 } }).map((i) => i.code)).toEqual(["entry_limit"]);
    richen(s);
    const r = resolveTurn(pack, s, { a: { steps: { unions: 2 } }, b: { steps: { unions: 2 } } });
    expect(r.events.find((e) => e.type === "conflict")).toMatchObject({ regionId: "unions", playerIds: ["a", "b"] });
  });

  it("are controlled by leading with at least 3 steps", () => {
    const s = newMatch();
    setSteps(s, "unions", "a", 2);
    expect(groupController(pack, s, "unions")).toBeNull();
    setSteps(s, "unions", "a", 3);
    expect(groupController(pack, s, "unions")).toBe("a");
  });

  it("don't count toward contention", () => {
    const s = newMatch();
    for (const r of ["north", "south", "city"]) setSteps(s, r, "a", 3);
    expect(allInContention(pack, s)).toBe(true); // nobody is on the Trade unions meter
  });

  it("can't take party members", () => {
    const s = newMatch();
    s.turn = 5;
    setSteps(s, "unions", "a", 2);
    expect(validatePlan(pack, s, "a", { pick: "dev", assign: { dev: "unions" } })[0]!.code).toBe("bad_assign");
  });
});

describe("income", () => {
  it("pays base money plus each group controlled, adjusted by the player's modifier, into that group's wallet", () => {
    const s = newMatch();
    richen(s, 1_000_000);
    setSteps(s, "city", "a", 1);
    setSteps(s, "north", "a", 1);
    setSteps(s, "unions", "b", 3);
    const { state, events } = resolveTurn(pack, s, {});
    const a = state.players[0]!;
    expect(a.money).toBe(1_000_000 + 250_000);
    expect(a.wallets).toMatchObject({ capital: 55_000, mainland: 50_000 }); // Ann: +10% Capital
    expect(state.players[1]!.wallets.unions).toBe(40_000);
    expect(events).toContainEqual({ type: "income", playerId: "a", base: 250_000, groups: { capital: 55_000, mainland: 50_000 } });
  });

  it("GDD example: +25% turns 50K of income into 62.5K", () => {
    const s = newMatch();
    s.players[0]!.leaderId = "cat"; // +50% Capital
    s.players[0]!.members.push({ candidateId: "bob", regionId: null, assignedTurn: null }); // nothing on Capital
    const half = { ...pack, candidates: pack.candidates.map((c) => (c.id === "cat" ? { ...c, modifiers: { capital: 25 } } : c)) };
    setSteps(s, "city", "a", 1);
    expect(resolveTurn(half, s, {}).state.players[0]!.wallets.capital).toBe(62_500);
  });

  it("stops when control is lost, but money already earned stays", () => {
    let s = newMatch();
    richen(s);
    setSteps(s, "city", "a", 1);
    s = resolveTurn(pack, s, {}).state;
    expect(s.players[0]!.wallets.capital).toBe(55_000);
    const r = resolveTurn(pack, s, { b: { steps: { city: 2 } } });
    expect(r.events).toContainEqual({ type: "control_lost", groupId: "capital", playerId: "a" });
    expect(r.events).toContainEqual({ type: "control_gained", groupId: "capital", playerId: "b" });
    expect(r.state.players[0]!.wallets.capital).toBe(55_000);
    expect(r.state.players[1]!.wallets.capital).toBe(50_000); // Bob has no Capital modifier (his -10% is on Mainland)
  });
});

describe("spending", () => {
  it("pays from eligible group wallets, smallest balance first, then base money", () => {
    const s = newMatch();
    const a = s.players[0]!;
    a.money = 100_000;
    a.wallets = { capital: 5_000, mainland: 30_000, unions: 2_000 };
    expect(paymentOrder(pack, a, "city")).toEqual(["unions", "capital", "mainland", "base"]);
    expect(paymentOrder(pack, a, "north")).toEqual(["unions", "mainland", "base"]); // Capital money only works in City
    setSteps(s, "city", "a", 1);
    const cost = stepCost(pack, a, "city", 2); // 19,800 with Ann's bonus
    const r = resolveTurn(pack, s, { a: { steps: { city: 2 } } });
    expect(r.events.find((e) => e.type === "moved")).toMatchObject({ cost, paidFrom: { unions: 2_000, capital: 5_000, mainland: cost - 7_000 } });
  });

  it("only counts money that can be spent where the plan spends it", () => {
    const s = newMatch();
    const a = s.players[0]!;
    a.money = 0;
    a.wallets = { capital: 100_000, mainland: 0, unions: 0 };
    expect(validatePlan(pack, s, "a", { steps: { north: 1 } }).map((i) => i.code)).toEqual(["not_enough_money"]);
    expect(validatePlan(pack, s, "a", { steps: { city: 1 } })).toEqual([]);
  });

  it("checks a whole plan the same way it will be paid", () => {
    const s = newMatch();
    const a = s.players[0]!;
    a.money = 10_000;
    a.wallets = { capital: 0, mainland: 0, unions: 10_000 };
    // North is paid first (pack order) from Trade unions money, then South from base money.
    expect(validatePlan(pack, s, "a", { steps: { south: 1, north: 1 } })).toEqual([]);
    const r = resolveTurn(pack, s, { a: { steps: { south: 1, north: 1 } } });
    expect(r.events.filter((e) => e.type === "moved").map((e) => e.type === "moved" && e.paidFrom)).toEqual([{ unions: 10_000 }, { base: 10_000 }]);
    expect(validatePlan(pack, s, "a", { steps: { south: 1, north: 1, city: 1 } }).map((i) => i.code)).toEqual(["not_enough_money"]);
  });

  it("money lost in a conflict comes out of the wallets the same way", () => {
    const s = newMatch();
    s.players[0]!.wallets.unions = 4_000;
    const r = resolveTurn(pack, s, { a: { steps: { north: 1 } }, b: { steps: { north: 1 } } });
    expect(r.state.players[0]!.wallets.unions).toBe(0);
    expect(r.state.players[0]!.money).toBe(250_000 - 6_000 + 250_000);
  });
});

describe("second round", () => {
  it("cuts region pips but leaves national group meters alone", () => {
    const s = newMatch(["a", "b"]);
    setSteps(s, "north", "a", 8);
    setSteps(s, "south", "b", 8);
    setSteps(s, "city", "a", 4);
    setSteps(s, "city", "b", 4);
    setSteps(s, "unions", "a", 6);
    s.phase = "election";
    // North and South get 40 seats each and City an even 76, so this board is a 78-78 tie.
    const evenPack = { ...pack, regions: pack.regions.map((r) => ({ ...r, seats: r.id === "city" ? 76 : 40 })) };
    const { state, result } = finishElection(evenPack, s);
    expect(result.secondRound).toBe(true);
    expect(state.meters.north!.a!.steps).toBe(3);
    expect(state.meters.unions!.a!.steps).toBe(6);
  });
});
