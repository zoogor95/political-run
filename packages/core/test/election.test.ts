import { describe, expect, it } from "vitest";
import { countElection, finishElection, formGovernment, majority, nextRandom, projectedSeats, regionLeader, seedRng, splitSeats } from "../src/index.js";
import { newMatch, setSteps, testPack as pack } from "./fixtures.js";

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
