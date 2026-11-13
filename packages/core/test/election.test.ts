import { describe, expect, it } from "vitest";
import {
  allocateReserved,
  countElection,
  electionCalls,
  finishElection,
  formGovernment,
  generalSeats,
  majority,
  nextRandom,
  popularVote,
  projectedSeats,
  regionLeader,
  regionSeats,
  seatWeight,
  seedRng,
  splitSeats,
  totalSeats,
  drawSeats,
  luckWeights,
  validatePack,
  type MapPack,
} from "../src/index.js";
import { newMatch, setSteps, testPack, testPack as pack } from "./fixtures.js";

describe("seats by pip share", () => {
  it("GDD example: 60% of the pips in a 40-seat region gives 24 seats", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 6);
    setSteps(s, "north", "b", 4);
    expect(splitSeats(s, "north", 40)).toEqual({ a: 24, b: 16, c: 0 });
  });

  it("uses the largest remainder and always hands out every seat", () => {
    const s = newMatch();
    setSteps(s, "south", "a", 5);
    setSteps(s, "south", "b", 3);
    setSteps(s, "south", "c", 1);
    // quotas 16.67, 10, 3.33 -> 16 + 10 + 3 = 29, the last seat goes to the largest remainder (a)
    expect(splitSeats(s, "south", 30)).toEqual({ a: 17, b: 10, c: 3 });
  });

  it("breaks an exact remainder tie by standing in the region", () => {
    const s = newMatch();
    setSteps(s, "south", "b", 1, 1);
    setSteps(s, "south", "a", 1, 2); // b reached step 1 first
    expect(splitSeats(s, "south", 3)).toEqual({ b: 2, a: 1, c: 0 });
  });

  it("projects seats for the whole map", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 3);
    setSteps(s, "city", "b", 3);
    expect(projectedSeats(pack, s)).toEqual({ a: 40, b: 75, c: 0 });
    expect(majority(pack)).toBe(73);
  });
});

describe("election and government", () => {
  it("most seats wins; the largest party forms the government", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 3);
    setSteps(s, "south", "a", 3);
    setSteps(s, "city", "b", 3);
    s.phase = "election";
    const { state, result } = finishElection(pack, s);
    expect(result.seats).toEqual({ a: 70, b: 75, c: 0 });
    expect(result.ranking).toEqual(["b", "a", "c"]);
    expect(result.secondRound).toBe(false);
    expect(state.phase).toBe("finished");
  });

  it("GDD results screen: 82 seats forms the government, the next largest joins until 112 is reached", () => {
    const seats = { ph: 82, pn: 74, bn: 30, gps: 23, others: 7, grs: 6 };
    const g = formGovernment(["ph", "pn", "bn", "gps", "others", "grs"], seats, 112);
    expect(g).toEqual({ members: ["ph", "bn"], opposition: "pn", outside: ["gps", "others", "grs"], seats: 112, hasMajority: true });
  });

  it("a tie for most seats starts a second round: -5 pips everywhere, locks open, order kept, money kept", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 15, 1); // a: all 40
    s.locked.north = "a";
    setSteps(s, "south", "b", 8, 2); // b reached each step before a
    setSteps(s, "south", "a", 8, 3); // 15 seats each
    setSteps(s, "city", "b", 8); // b 40, c 35
    setSteps(s, "city", "c", 7);
    s.phase = "election";
    s.players[0]!.money = 123;
    const pre = countElection(pack, s);
    expect(pre.seats).toEqual({ a: 55, b: 55, c: 35 });
    const { state, result } = finishElection(pack, s);
    expect(result.secondRound).toBe(true);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("campaign");
    expect(state.meters.north!.a!.steps).toBe(10);
    expect(state.locked).toEqual({});
    expect(state.meters.city!.c!.steps).toBe(2);
    expect(state.meters.south!.a!.reached).toHaveLength(3);
    expect(regionLeader(state, "south")).toBe("b"); // b still reached step 3 first
    expect(state.players[0]!.money).toBe(123 + pack.rules.baseIncome);
  });

  it("a tie in the second round is broken by total pips, then by less money spent", () => {
    // City gets an even seat count here so equal pips give equal seats.
    const evenPack = { ...pack, regions: pack.regions.map((r) => (r.id === "city" ? { ...r, seats: 76 } : r)) };
    const s = newMatch(["a", "b"]);
    s.round = 2;
    s.phase = "election";
    setSteps(s, "north", "a", 2);
    setSteps(s, "north", "b", 2);
    setSteps(s, "south", "a", 3);
    setSteps(s, "south", "b", 3);
    setSteps(s, "city", "a", 5);
    setSteps(s, "city", "b", 5);
    s.players[0]!.spent = 900;
    s.players[1]!.spent = 500;
    const { result } = finishElection(evenPack, s);
    expect(result.seats).toEqual({ a: 73, b: 73 });
    expect(result.secondRound).toBe(false);
    expect(result.ranking).toEqual(["b", "a"]); // same seats, same pips, b spent less
  });

  it("a tie in the second round goes first to whoever has more total pips", () => {
    const twoRegions = {
      ...pack,
      regions: [
        { id: "north", name: "North", seats: 40, baseCost: 10_000 },
        { id: "south", name: "South", seats: 40, baseCost: 10_000 },
      ],
    };
    const s = newMatch(["a", "b"]);
    s.round = 2;
    s.phase = "election";
    setSteps(s, "north", "a", 6); // 30 v 10
    setSteps(s, "north", "b", 2);
    setSteps(s, "south", "a", 1); // 10 v 30
    setSteps(s, "south", "b", 3);
    s.players[0]!.spent = 900; // a spent more, but pips come first
    const { result } = finishElection(twoRegions, s);
    expect(result.seats).toEqual({ a: 40, b: 40 });
    expect(result.ranking).toEqual(["a", "b"]);
  });
});

describe("seeded randomness", () => {
  it("replays the same sequence from the same seed", () => {
    const run = (seed: number) => {
      let st = seedRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [v, next] = nextRandom(st);
        out.push(v);
        st = next;
      }
      return out;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    run(7).forEach((v) => expect(v >= 0 && v < 1).toBe(true));
  });
});

describe("election night", () => {
  const withVoters = {
    ...pack,
    regions: pack.regions.map((r) => ({ ...r, voters: { north: 1000, south: 800, city: 3000 }[r.id]! })),
    callOrder: ["city", "north", "south"],
  };

  it("calls regions in the pack's order with running totals and marks the call that passes the majority", () => {
    const s = newMatch();
    setSteps(s, "city", "a", 3); // 75 seats: past the 73 majority on the first call
    setSteps(s, "north", "b", 3);
    setSteps(s, "south", "b", 2, 2);
    setSteps(s, "south", "c", 2, 1); // c got there first
    const calls = electionCalls(withVoters, s);
    expect(calls.map((c) => c.regionId)).toEqual(["city", "north", "south"]);
    expect(calls[0]).toMatchObject({ winner: "a", totals: { a: 75, b: 0, c: 0 }, majorityFor: "a" });
    expect(calls[1]!.majorityFor).toBeUndefined();
    expect(calls[2]!.winner).toBe("c"); // 15-15 split; c reached its steps first
    expect(calls.at(-1)!.totals).toEqual({ a: 75, b: 55, c: 15 });
  });

  it("has no majority call in a hung parliament", () => {
    const s = newMatch();
    setSteps(s, "city", "a", 3);
    setSteps(s, "city", "b", 3);
    setSteps(s, "north", "c", 3);
    setSteps(s, "south", "c", 3);
    expect(electionCalls(withVoters, s).some((c) => c.majorityFor)).toBe(false);
  });

  it("splits each region's voters by pip share for the popular vote", () => {
    const s = newMatch();
    setSteps(s, "city", "a", 3);
    setSteps(s, "city", "b", 1);
    setSteps(s, "north", "b", 2);
    s.phase = "election";
    const { result } = finishElection(withVoters, s);
    expect(result.popularVote).toEqual({ a: 2250, b: 750 + 1000, c: 0 });
    expect(popularVote(pack, s)).toEqual({ a: 0, b: 0, c: 0 }); // no voter counts, no popular vote
  });

  it("checks the call order lists every region once", () => {
    expect(validatePack({ ...withVoters, callOrder: ["city", "north"] }).map((i) => i.path)).toContain("callOrder");
    expect(validatePack({ ...withVoters, callOrder: ["city", "north", "north"] }).map((i) => i.path)).toContain("callOrder");
    expect(validatePack(withVoters)).toEqual([]);
  });
});

describe("reserved seats", () => {
  // Testland with Pakistan-style reserved seats: 10 for women shared by seats won on the Mainland, 3 nationwide.
  const reservedPack: MapPack = {
    ...testPack,
    reservedSeats: [
      { id: "women", name: "Women", seats: 10, group: "capital" },
      { id: "minorities", name: "Non-Muslims", seats: 3 },
    ],
  };

  it("counts reserved seats in the parliament and the majority", () => {
    expect(totalSeats(reservedPack)).toBe(145 + 13);
    expect(generalSeats(reservedPack)).toBe(145);
    expect(majority(reservedPack)).toBe(80);
  });

  it("shares reserved seats out by general seats won in their scope, largest remainder", () => {
    const s = newMatch(["a", "b"]);
    setSteps(s, "city", "a", 3); // City: a 3 pips, b 2 pips of 75 seats -> 45 and 30
    setSteps(s, "city", "b", 2);
    setSteps(s, "north", "b", 1); // North: b alone, 40 seats
    const won = regionSeats(reservedPack, s);
    expect(won.city).toEqual({ a: 45, b: 30 });
    const reserved = allocateReserved(reservedPack, s, won);
    // Women follow the City only: 45 to 30 of 10 seats -> 6 and 4. Nationwide: a 45, b 70 of 3 -> 1 and 2.
    expect(reserved).toEqual({ women: { a: 6, b: 4 }, minorities: { a: 1, b: 2 } });
    expect(projectedSeats(reservedPack, s)).toEqual({ a: 45 + 6 + 1, b: 70 + 4 + 2 });
  });

  it("gives a party with no general seats in the scope no reserved seats", () => {
    const s = newMatch(["a", "b"]);
    setSteps(s, "north", "a", 2);
    setSteps(s, "city", "b", 1);
    expect(allocateReserved(reservedPack, s, regionSeats(reservedPack, s)).women).toEqual({ a: 0, b: 10 });
  });

  it("adds reserved seats to the count and declares them after every region on election night", () => {
    const s = newMatch(["a", "b"]);
    setSteps(s, "city", "a", 3);
    setSteps(s, "city", "b", 2);
    setSteps(s, "north", "b", 1);
    setSteps(s, "south", "a", 1);
    s.phase = "election";
    const result = countElection(reservedPack, s);
    // Nationwide a has 75 general seats to b's 70, so a takes 2 of the 3 non-Muslim seats on the larger remainder.
    expect(result.seats).toEqual({ a: 45 + 30 + 6 + 2, b: 30 + 40 + 4 + 1 });
    expect(result.reserved.women).toEqual({ a: 6, b: 4 });
    const calls = electionCalls(reservedPack, s);
    expect(calls.map((c) => c.regionId)).toEqual(["north", "south", "city", "women", "minorities"]);
    expect(calls.slice(-2).every((c) => c.reserved)).toBe(true);
    expect(calls.at(-1)!.totals).toEqual(result.seats);
    // a passes 80 only once the women's seats are declared.
    expect(calls.find((c) => c.majorityFor)?.regionId).toBe("women");
  });

  it("weights a region's general seats by the reserved seats they decide", () => {
    expect(seatWeight(reservedPack, "city")).toBeCloseTo(1 + 10 / 75 + 3 / 145);
    expect(seatWeight(reservedPack, "north")).toBeCloseTo(1 + 3 / 145);
    expect(seatWeight(testPack, "city")).toBe(1);
  });

  it("checks reserved seat sets", () => {
    const bad: MapPack = { ...reservedPack, reservedSeats: [{ id: "city", name: "", seats: 0, group: "unions" }] };
    expect(validatePack(bad).map((i) => i.path)).toEqual(
      expect.arrayContaining(["reservedSeats[0].id", "reservedSeats[0].name", "reservedSeats[0].seats", "reservedSeats[0].group"]),
    );
    expect(validatePack(reservedPack)).toEqual([]);
  });
});

describe("luck factor", () => {
  it("weights: each pip of lead over the fewest counts double (the 9, 6, 3 example is 15, 9, 3)", () => {
    const s = newMatch();
    setSteps(s, "north", "a", 9);
    setSteps(s, "north", "b", 6);
    setSteps(s, "north", "c", 3);
    expect(luckWeights(s, "north")).toEqual({ a: 15, b: 9, c: 3 });
    setSteps(s, "south", "b", 4);
    expect(luckWeights(s, "south")).toEqual({ b: 4 }); // alone: every seat
    expect(luckWeights(s, "city")).toEqual({});
  });

  it("projects the expected seats and draws the real ones at the count, the same way every time", () => {
    const s = { ...newMatch(), luck: true };
    setSteps(s, "north", "a", 9);
    setSteps(s, "north", "b", 6);
    setSteps(s, "north", "c", 3);
    // 40 seats at 15/27, 9/27, 3/27: 22.2, 13.3, 4.4 expected; the spare seat goes to the biggest remainder.
    expect(regionSeats(pack, s).north).toEqual({ a: 22, b: 13, c: 5 });
    const drawn = drawSeats(s, "north", 40);
    expect(Object.values(drawn).reduce((x, y) => x + y, 0)).toBe(40);
    expect(drawSeats(s, "north", 40)).toEqual(drawn);
    expect(countElection(pack, s).regionSeats.north).toEqual(drawn);
    expect(electionCalls(pack, s).find((c) => c.regionId === "north")!.seats).toEqual(drawn);
    // Nobody campaigned in the city: nobody wins it, luck or not.
    expect(countElection(pack, s).regionSeats.city).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("draws close to the weights over many matches, and differently from match to match", () => {
    const totals = { a: 0, b: 0, c: 0 };
    const draws = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const s = { ...newMatch(), luck: true, seed };
      setSteps(s, "north", "a", 9);
      setSteps(s, "north", "b", 6);
      setSteps(s, "north", "c", 3);
      const d = drawSeats(s, "north", 40);
      draws.add(JSON.stringify(d));
      for (const id of ["a", "b", "c"] as const) totals[id] += d[id]!;
    }
    expect(draws.size).toBeGreaterThan(50);
    expect(totals.a / 8000).toBeCloseTo(15 / 27, 1);
    expect(totals.b / 8000).toBeCloseTo(9 / 27, 1);
    expect(totals.c / 8000).toBeCloseTo(3 / 27, 1);
  });

  it("is off unless the match turns it on", () => {
    expect(newMatch().luck).toBeUndefined();
    const s = newMatch();
    setSteps(s, "north", "a", 6);
    setSteps(s, "north", "b", 4);
    expect(countElection(pack, s).regionSeats.north).toEqual({ a: 24, b: 16, c: 0 });
  });
});
