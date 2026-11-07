import { describe, expect, it } from "vitest";
import { HEADLINE_KINDS, PLACEHOLDERS, fillTemplate, headlinesForTurn, resolveTurn, summarizeTurn, type NewsTemplates, type TurnSummary } from "../src/index.js";
import { newMatch, richen, setSteps, testPack as pack } from "./fixtures.js";

/** One template per kind that uses every placeholder the kind allows, so the generator's variables are checked too. */
const templates: NewsTemplates = {
  channel: "TEST",
  templates: Object.fromEntries(HEADLINE_KINDS.map((k) => [k, [`${k}: ${PLACEHOLDERS[k].map((p) => `{${p}}`).join(" ")}`]])) as NewsTemplates["templates"],
};
const ctx = (summary: TurnSummary, extra: { secondRound?: boolean } = {}) => ({
  summary,
  you: "a",
  partyName: (id: string) => `${id.toUpperCase()} Party`,
  regionName: (id: string) => pack.regions.find((r) => r.id === id)?.name ?? id,
  groupName: (id: string) => pack.groups.find((g) => g.id === id)?.name ?? id,
  candidateName: (id: string) => pack.candidates.find((c) => c.id === id)?.name ?? id,
  money: (n: number) => `£${n}`,
  ...extra,
});

describe("turn summary", () => {
  it("records seats, spending, moves, conflicts, groups and next turn's income per party", () => {
    const s = newMatch();
    richen(s, 1_000_000);
    setSteps(s, "north", "c", 2);
    const r = resolveTurn(pack, s, { a: { steps: { city: 2 } }, b: { steps: { south: 1 } }, c: { steps: { south: 1, north: 3 } } });
    const sum = summarizeTurn(pack, s, r.state, r.events);
    const a = sum.parties.find((p) => p.playerId === "a")!;
    const b = sum.parties.find((p) => p.playerId === "b")!;
    expect(a.moves).toEqual([expect.objectContaining({ regionId: "city", from: 0, to: 2, firstEntry: true })]);
    expect(a.seatsBefore).toBe(0);
    expect(a.seatsAfter).toBe(75);
    expect(a.groupsGained).toContain("capital");
    expect(a.income?.groups.capital).toBe(55_000);
    expect(b.conflicts).toEqual([{ regionId: "south", step: 1, rivals: ["c"], amount: 11_000 }]);
    expect(b.spent).toBe(11_000);
    expect(sum.changedRegions).toEqual(["north", "south", "city"]);
    expect(sum.newlyContended).toEqual(["north"]);
  });
});

describe("headlines", () => {
  it("rejects a template that uses a placeholder its kind doesn't have", () => {
    expect(() => fillTemplate("{region} is lovely", "filler", {})).toThrow(/filler/);
    expect(fillTemplate("{party} wins {group}", "control_gained", { party: "Zoogor Party", group: "London" })).toBe("Zoogor Party wins London");
  });

  it("covers every kind of event, puts big moments on BREAKING cards and favours your campaign", () => {
    const s = newMatch();
    richen(s, 5_000_000);
    s.turn = 5;
    setSteps(s, "north", "a", 11); // 11 -> 15 is a big move (4+ steps) that also locks the region
    setSteps(s, "south", "b", 2);
    setSteps(s, "south", "c", 3);
    s.players[1]!.members.push({ candidateId: "dev", regionId: "south", assignedTurn: 2 });
    const r = resolveTurn(pack, s, {
      a: { steps: { north: 15, city: 1 }, pick: "eve" },
      b: { steps: { city: 1 } },
      c: { steps: { city: 2 } },
    });
    const sum = summarizeTurn(pack, s, r.state, r.events);
    const { headlines } = headlinesForTurn(templates, ctx(sum), 1, 50);
    const kinds = new Set(headlines.map((h) => h.kind));
    for (const k of ["conflict_you", "locked", "first_entry", "big_move", "free_pip", "member_picked", "control_gained"] as const) expect(kinds).toContain(k);
    expect(headlines.find((h) => h.kind === "locked")).toMatchObject({ breaking: true, involvesYou: true });
    expect(headlines.find((h) => h.kind === "conflict_you")!.text).toMatch(/^conflict_you: A Party B Party City £\d+ 1$/);
    expect(headlines[0]!.score).toBeGreaterThanOrEqual(headlines.at(-1)!.score);
  });

  it("announces the final turn, the election and a second round", () => {
    const base: TurnSummary = { turn: 3, parties: [], changedRegions: [], newlyContended: [], finalTurnNext: true, electionNext: false };
    expect(headlinesForTurn(templates, ctx(base), 1).headlines[0]).toMatchObject({ kind: "final_turn", breaking: true });
    expect(headlinesForTurn(templates, ctx({ ...base, finalTurnNext: false, electionNext: true }), 1).headlines[0]!.kind).toBe("election");
    expect(headlinesForTurn(templates, ctx({ ...base, finalTurnNext: false }, { secondRound: true }), 1).headlines[0]!.kind).toBe("second_round");
  });

  it("keeps the ticker full with filler and is deterministic", () => {
    const quiet: TurnSummary = { turn: 2, parties: [], changedRegions: [], newlyContended: [], finalTurnNext: false, electionNext: false };
    const one = headlinesForTurn(templates, ctx(quiet), 9);
    expect(one.headlines.length).toBeGreaterThanOrEqual(4);
    expect(one.headlines.every((h) => h.kind === "filler")).toBe(true);
    expect(headlinesForTurn(templates, ctx(quiet), 9)).toEqual(one);
  });
});
