import { describe, expect, it } from "vitest";
import {
  PRESIDENTIAL_RULES,
  canPick,
  countElection,
  createMatch,
  electionCalls,
  finishElection,
  groupModifier,
  majority,
  pickPool,
  planAi,
  playerById,
  projectedSeats,
  resolveTurn,
  validatePlan,
  type AiLevel,
  type GameState,
  type MapPack,
  type Plan,
} from "../src/index.js";
import { setSteps, testPack } from "./fixtures.js";

/** A small Presidential map: 100 electoral votes, 51 to win, and no region is a majority on its own. */
const pack: MapPack = {
  ...testPack,
  id: "test-presidential",
  name: "Testland (Presidential)",
  gameType: "presidential",
  currency: "$",
  rules: PRESIDENTIAL_RULES,
  regions: [
    { id: "north", name: "North", seats: 30, baseCost: 10_000, voters: 3000 },
    { id: "south", name: "South", seats: 25, baseCost: 10_000, voters: 2500 },
    { id: "east", name: "East", seats: 20, baseCost: 10_000, voters: 2000 },
    { id: "city", name: "City", seats: 25, baseCost: 10_000, voters: 2500 },
  ],
  groups: [
    { id: "capital", name: "Capital", kind: "state", regions: ["city"], income: 50_000 },
    { id: "mainland", name: "Mainland", kind: "state", regions: ["north", "south", "east", "city"], income: 50_000 },
    { id: "unions", name: "Trade unions", kind: "national", regions: [], income: 40_000, baseCost: 30_000 },
  ],
};

function match(players = ["a", "b", "c"]): GameState {
  const leaders = ["ann", "bob", "cat", "dev", "eve"];
  return createMatch(pack, {
    seed: 7,
    players: players.map((id, i) => ({ id, leaderId: leaders[i]!, party: { name: `${id} Party`, color: `#00000${i}`, emblem: `e${i}` } })),
  });
}

/** Puts every player on the given steps (all reached on turn 1) and jumps the match to election night. */
function atElection(steps: Record<string, Record<string, number>>, players?: string[]): GameState {
  const s = match(players);
  for (const [region, byPlayer] of Object.entries(steps)) for (const [id, n] of Object.entries(byPlayer)) setSteps(s, region, id, n, 1);
  s.phase = "election";
  s.turn = 9;
  return s;
}

describe("Presidential: electoral votes", () => {
  it("uses 10-step meters, flat step costs and a majority of all electoral votes", () => {
    expect(PRESIDENTIAL_RULES.steps).toBe(10);
    expect(PRESIDENTIAL_RULES.costGrowth).toBe(1);
    expect(majority(pack)).toBe(51); // 270 of 538 in the US
  });

  it("gives each region's electoral votes to its leader; on equal steps, whoever got there first", () => {
    const s = atElection({ north: { a: 5, b: 3 }, south: { b: 4 } });
    setSteps(s, "south", "c", 4, 3); // c reaches 4 in the south after b
    const r = countElection(pack, s);
    expect(r.regionSeats.north).toEqual({ a: 30, b: 0, c: 0 });
    expect(r.regionSeats.south).toMatchObject({ a: 0, b: 25, c: 0 });
    expect(Object.values(r.regionSeats.city!)).toEqual([0, 0, 0]); // nobody campaigned there
    expect(r.seats).toEqual({ a: 30, b: 25, c: 0 });
  });

  it("counts every region you lead during the campaign, in contention or not", () => {
    const s = match();
    setSteps(s, "north", "a", 1);
    setSteps(s, "city", "b", 2);
    expect(projectedSeats(pack, s)).toEqual({ a: 30, b: 25, c: 0 });
  });

  it("gives each region's voters to its winner in the popular vote", () => {
    const s = atElection({ north: { a: 6, b: 5 }, south: { b: 2 } });
    expect(countElection(pack, s).popularVote).toEqual({ a: 3000, b: 2500, c: 0 });
  });

  it("calls regions one by one and agrees with the count", () => {
    const s = atElection({ north: { a: 6 }, south: { a: 3 }, east: { b: 4 }, city: { c: 5 } });
    const calls = electionCalls(pack, s);
    expect(calls.map((c) => c.winner)).toEqual(["a", "a", "b", "c"]);
    expect(calls.at(-1)!.totals).toEqual(countElection(pack, s).seats);
    expect(calls.find((c) => c.majorityFor)?.regionId).toBe("south"); // a passes 51 with the south
  });
});

describe("Presidential: majority, elimination and tiebreaks", () => {
  it("ends the match when someone has a majority", () => {
    const s = atElection({ north: { a: 4 }, south: { a: 5 }, east: { b: 6 }, city: { c: 3 } });
    const { state, result } = finishElection(pack, s);
    expect(result.seats).toEqual({ a: 55, b: 20, c: 25 });
    expect(result.eliminated).toBeNull();
    expect(result.ranking).toEqual(["a", "c", "b"]);
    expect(state.phase).toBe("finished");
  });

  it("eliminates last place when nobody reaches the majority, and the campaign goes on", () => {
    // a 30 (north), b 25 (south), c 45 (east and city): nobody has 51, and b is last.
    const s = atElection({ north: { a: 6, c: 2 }, south: { b: 4, c: 3 }, east: { c: 10 }, city: { c: 5, a: 3 } });
    s.locked.east = "c";
    const before = countElection(pack, s);
    expect(before.seats).toEqual({ a: 30, b: 25, c: 45 });
    expect(before.eliminated).toBe("b");
    const { state } = finishElection(pack, s);
    expect(playerById(state, "b").eliminated).toBe(9);
    expect(state.meters.south!.b!.steps).toBe(0);
    expect(state.meters.south!.c!.steps).toBe(3);
    // Every region is still in contention, so everyone left gets one more turn: FINAL TURN again.
    expect(state.phase).toBe("final");
    expect(state.round).toBe(2);
    // The eliminated candidate gets no income and can't plan.
    expect(playerById(state, "b").money).toBe(playerById(s, "b").money);
    expect(playerById(state, "a").money).toBe(playerById(s, "a").money + pack.rules.baseIncome);
    expect(validatePlan(pack, state, "b", { steps: { north: 1 } }).map((i) => i.code)).toEqual(["eliminated"]);
    expect(validatePlan(pack, state, "b", {})).toEqual([]);
  });

  it("removes an eliminated candidate's locks, and goes back to campaigning when regions fall out of contention", () => {
    const s = atElection({ north: { a: 6 }, south: { a: 1, b: 4 }, east: { c: 10 }, city: { a: 3, c: 5 } });
    s.locked.east = "c";
    // a 30, b 25, c 45: b is out. Say c had only the east: then c is last.
    setSteps(s, "city", "c", 0);
    setSteps(s, "city", "b", 4);
    const r = countElection(pack, s);
    expect(r.seats).toEqual({ a: 30, b: 50, c: 20 });
    expect(r.eliminated).toBe("c");
    const { state } = finishElection(pack, s);
    expect(state.locked.east).toBeUndefined(); // c's lock is gone with c's pips
    expect(state.meters.city!.c!.steps).toBe(0);
    expect(state.meters.east!.c!.steps).toBe(0);
    // Nobody is left in the east, so it's out of contention: the campaign goes on until every region is in play.
    expect(state.phase).toBe("campaign");
  });

  it("breaks a tie for fewest electoral votes by fewer pips, then by less money spent", () => {
    // a 30; b and c 25 each (south, city). b has 4 pips in total, c has 6: b is out.
    const s = atElection({ north: { a: 5 }, south: { b: 4 }, city: { c: 6 } });
    expect(countElection(pack, s).eliminated).toBe("b");
    // Same pips: the one who spent less money is out.
    const t = atElection({ north: { a: 5 }, south: { b: 4 }, city: { c: 4 } });
    playerById(t, "b").spent = 90_000;
    playerById(t, "c").spent = 60_000;
    expect(countElection(pack, t).eliminated).toBe("c");
  });

  it("a 50-50 tie with two candidates left eliminates one by the same tiebreaks, and the other wins", () => {
    // a: north 30 and east 20; b: south 25 and city 25.
    const t = atElection({ north: { a: 5 }, east: { a: 3 }, south: { b: 4 }, city: { b: 6 } }, ["a", "b"]);
    const r = countElection(pack, t);
    expect(r.seats).toEqual({ a: 50, b: 50 });
    expect(r.eliminated).toBe("a"); // 8 pips against b's 10
    const { state } = finishElection(pack, t);
    expect(state.phase).toBe("finished");
    expect(r.ranking).toEqual(["b", "a"]);
  });

  it("ranks eliminated candidates last, the most recently eliminated first", () => {
    const s = atElection({ north: { a: 6, c: 2 }, south: { b: 4, c: 3 }, east: { c: 10 }, city: { c: 5, a: 3 } });
    const next = finishElection(pack, s).state; // b is out
    const r = countElection(pack, { ...next, phase: "election" });
    expect(r.ranking.at(-1)).toBe("b");
  });
});

describe("Presidential: running mate", () => {
  /** A match at the start of the given turn. */
  const onTurn = (turn: number) => ({ ...match(), turn });

  it("is picked on turn 5 only, once", () => {
    expect(canPick(pack, onTurn(4), "a")).toBe(false);
    expect(canPick(pack, onTurn(5), "a")).toBe(true);
    expect(canPick(pack, onTurn(10), "a")).toBe(false);
    expect(validatePlan(pack, onTurn(6), "a", { pick: "dev" }).map((i) => i.code)).toEqual(["not_pick_turn"]);
    const s = onTurn(5);
    s.players[0]!.members.push({ candidateId: "dev", regionId: null, assignedTurn: null });
    expect(canPick(pack, s, "a")).toBe(false);
  });

  it("comes from every candidate except yourself and your opponents' candidates; several players may pick the same one", () => {
    const s = onTurn(5);
    expect(pickPool(pack, s, "a")).toEqual(["dev", "eve"]);
    expect(validatePlan(pack, s, "a", { pick: "bob" }).map((i) => i.code)).toEqual(["bad_pick"]);
    const { state } = resolveTurn(pack, s, { a: { pick: "dev" }, b: { pick: "dev" }, c: {} });
    expect(state.players.map((p) => p.members.map((m) => m.candidateId))).toEqual([["dev"], ["dev"], []]);
  });

  it("adds 20% of their bonuses and penalties from turn 5, and is never assigned to a region", () => {
    const s = onTurn(5);
    const before = groupModifier(pack, playerById(s, "a"), "capital");
    const { state } = resolveTurn(pack, s, { a: { pick: "dev" }, b: {}, c: {} });
    // Ann has +10% Capital; Dev's +40% adds 20% of itself: 8 more.
    expect(groupModifier(pack, playerById(state, "a"), "capital")).toBe(before + 8);
    expect(validatePlan(pack, s, "a", { pick: "dev", assign: { dev: "north" } }).map((i) => i.code)).toEqual(["bad_assign"]);
  });
});

describe("Presidential: computer candidates", () => {
  it.each<AiLevel>(["easy", "normal", "hard"])("%s plays whole matches with valid plans, a running mate and a winner", (level) => {
    for (const seed of [1, 2, 3]) {
      let s = createMatch(pack, {
        seed,
        players: ["a", "b", "c"].map((id, i) => ({ id, leaderId: ["ann", "bob", "cat"][i]!, party: { name: id, color: `#00000${i}`, emblem: `e${i}` } })),
      });
      let rng = seed;
      for (let guard = 0; guard < 200 && s.phase !== "finished"; guard++) {
        if (s.phase === "election") {
          s = finishElection(pack, s).state;
          continue;
        }
        const plans: Record<string, Plan> = {};
        for (const p of s.players) {
          const r = planAi(pack, s, p.id, level, rng);
          rng = r.rng;
          expect(validatePlan(pack, s, p.id, r.plan)).toEqual([]);
          plans[p.id] = r.plan;
        }
        s = resolveTurn(pack, s, plans).state;
      }
      expect(s.phase).toBe("finished");
    }
  });

  it.each<AiLevel>(["easy", "normal", "hard"])("%s picks a running mate on turn 5 and never assigns them", (level) => {
    const s = { ...match(), turn: 5 };
    const { plan } = planAi(pack, s, "a", level, 11);
    expect(pickPool(pack, s, "a")).toContain(plan.pick);
    expect(plan.assign).toBeUndefined();
  });
});
