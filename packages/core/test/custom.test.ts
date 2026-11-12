import { describe, expect, it } from "vitest";
import { CUSTOM_RULES, createMatch, customBudget, customCost, customPrice, customRefund, groupModifier, validateCustom, validatePack, withCustomCandidates, type CustomCandidate } from "../src/index.js";
import { testPack } from "./fixtures.js";

// Testland: North 40, South 30 and City 75 seats (145). Capital = City (52% of the seats), Mainland = everything.
const custom = (modifiers: Record<string, number>, over: Partial<CustomCandidate> = {}): CustomCandidate => ({
  id: "custom-zed",
  name: "Zed Zoogor",
  affiliation: "Independent",
  modifiers,
  custom: true,
  packId: "test",
  bio: "Runs on tea.",
  avatar: { skin: "#f2c39b", hairStyle: "short" },
  ...over,
});

describe("custom candidate points", () => {
  it("prices a 5% bonus by the group's share of the seats, and a national group by its income", () => {
    expect(customPrice(testPack, "capital")).toBe(8); // 75 of 145 seats: 15 × 0.52
    expect(customPrice(testPack, "mainland")).toBe(15);
    expect(customPrice(testPack, "unions")).toBe(2); // £40K a turn against £250K base income: 15 × 0.16
  });

  it("gives back half a step's price for a penalty, rounded down", () => {
    expect(customRefund(testPack, "capital")).toBe(4);
    expect(customRefund(testPack, "unions")).toBe(1);
    expect(customCost(testPack, { capital: 10, unions: 15, mainland: -5 })).toBe(16 + 6 - 7);
  });

  it("uses the pack's budget or the default", () => {
    expect(customBudget(testPack)).toBe(CUSTOM_RULES.defaultBudget);
    expect(customBudget({ ...testPack, customBudget: 12 })).toBe(12);
  });
});

describe("validating a custom candidate", () => {
  it("accepts one within the budget and the rules", () => {
    expect(validateCustom(testPack, custom({ unions: 15, mainland: -5 }))).toEqual([]);
  });

  it("refuses one over budget, off-step, too strong on a group, or with too many modifiers", () => {
    const fields = (c: CustomCandidate) => validateCustom(testPack, c).map((i) => i.message);
    expect(fields(custom({ capital: 10 }))).toEqual(["Costs 16 points; the budget is 8"]);
    expect(fields(custom({ unions: 7 }))[0]).toMatch(/steps of 5%/);
    expect(fields(custom({ unions: 20 }))[0]).toMatch(/up to 15%/);
    const five = custom({ unions: 5, capital: -5, mainland: -5, north: 5, south: 5 });
    expect(fields(five)).toContain("At most 4 bonuses and penalties");
  });

  it("needs a name that isn't a roster leader's, a short bio, and the right map", () => {
    const msgs = validateCustom(testPack, custom({}, { name: " ", bio: "x".repeat(141), packId: "uk" })).map((i) => i.field);
    expect(msgs).toEqual(["packId", "name", "bio"]);
    expect(validateCustom(testPack, custom({}, { name: "ann" }))[0]!.message).toMatch(/map's own leaders/);
  });
});

describe("playing a custom candidate", () => {
  it("joins the pack's candidates for its own map only, and leads a party with its bonuses", () => {
    const c = custom({ unions: 15 });
    expect(withCustomCandidates(testPack, [c, { ...c, id: "custom-other", packId: "uk" }]).candidates.map((x) => x.id)).toEqual([
      ...testPack.candidates.map((x) => x.id),
      "custom-zed",
    ]);
    const pack = withCustomCandidates(testPack, [c]);
    expect(validatePack(pack)).toEqual([]);
    const s = createMatch(pack, {
      seed: 1,
      players: [
        { id: "a", leaderId: "custom-zed", party: { name: "A", color: "#000001", emblem: "a" } },
        { id: "b", leaderId: "bob", party: { name: "B", color: "#000002", emblem: "b" } },
      ],
    });
    expect(groupModifier(pack, s.players[0]!, "unions")).toBe(15);
  });
});
