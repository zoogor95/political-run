import { describe, expect, it } from "vitest";
import { advancing, cupCanBeCreated, cupFor, isFinal, phaseAt, roundsFor, seatTables, SIGNUP_DAYS } from "../src/tournament.js";

describe("tournament schedule", () => {
  it("has a Winter Cup from January and a Summer Cup from July, one per map", () => {
    const winter = cupFor("uk", Date.UTC(2027, 2, 10));
    expect(winter).toMatchObject({ id: "uk-2027-winter", name: "UK Winter Cup 2027", opensAt: Date.UTC(2027, 0, 1), endsBefore: Date.UTC(2027, 6, 1) });
    expect(winter.startsAt).toBe(Date.UTC(2027, 0, 1) + SIGNUP_DAYS * 86_400_000);
    expect(cupFor("pk", Date.UTC(2027, 8, 1))).toMatchObject({ id: "pk-2027-summer", name: "Pakistan Summer Cup 2027", endsBefore: Date.UTC(2028, 0, 1) });
    expect(cupFor("us", Date.UTC(2027, 11, 31)).id).toBe("us-2027-summer");
    expect(cupFor("us", Date.UTC(2028, 0, 1)).id).toBe("us-2028-winter");
  });

  it("knows whether sign-up is open or the cup has started", () => {
    const cup = cupFor("uk", Date.UTC(2027, 0, 5));
    expect(phaseAt(cup, Date.UTC(2026, 11, 31))).toBe("scheduled");
    expect(phaseAt(cup, Date.UTC(2027, 0, 5))).toBe("open");
    expect(phaseAt(cup, cup.startsAt)).toBe("started");
  });
});

describe("tournament brackets", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

  it("seats everyone in tables of at most four, as even as possible and never alone", () => {
    for (const n of [4, 5, 6, 9, 13, 17, 64, 100, 256]) {
      const tables = seatTables(ids(n), n);
      expect(tables.flat().sort()).toEqual(ids(n).sort());
      expect(Math.max(...tables.map((t) => t.length))).toBeLessThanOrEqual(4);
      expect(Math.min(...tables.map((t) => t.length))).toBeGreaterThanOrEqual(2);
      expect(Math.max(...tables.map((t) => t.length)) - Math.min(...tables.map((t) => t.length))).toBeLessThanOrEqual(1);
    }
    expect(seatTables(ids(8), 1)).toEqual(seatTables(ids(8), 1));
    expect(seatTables(ids(8), 1)).not.toEqual(seatTables(ids(8), 2));
  });

  it("needs three rounds for 64 players and four for 256, with the last table the final", () => {
    expect([roundsFor(4), roundsFor(5), roundsFor(16), roundsFor(17), roundsFor(64), roundsFor(256)]).toEqual([1, 2, 2, 3, 3, 4]);
    expect([isFinal(4), isFinal(5), isFinal(2)]).toEqual([true, false, true]);
  });

  it("sends the table's first finisher through", () => {
    expect(advancing(["x", "y", "z"])).toBe("x");
    expect(advancing([])).toBeNull();
  });
});

describe("when a cup is made", () => {
  it("only while people can still sign up, never after the window has closed", () => {
    const cup = cupFor("uk", Date.UTC(2027, 0, 5));
    expect(cupCanBeCreated(cup, Date.UTC(2027, 0, 5))).toBe(true);
    expect(cupCanBeCreated(cup, cup.startsAt - 1)).toBe(true);
    expect(cupCanBeCreated(cup, cup.startsAt)).toBe(false);
    expect(cupCanBeCreated(cupFor("uk", Date.UTC(2027, 4, 1)), Date.UTC(2027, 4, 1))).toBe(false); // mid-season: wait for the Summer Cup
  });
});
