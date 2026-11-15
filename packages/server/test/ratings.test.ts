import { describe, expect, it } from "vitest";
import { expected, ratingChanges, seasonOf } from "../src/ratings.js";

describe("ranked ratings", () => {
  it("names the season by calendar quarter", () => {
    expect(seasonOf(Date.UTC(2026, 10, 14))).toMatchObject({ id: "2026-Q4", name: "Season 2026 Q4", startsAt: Date.UTC(2026, 9, 1), endsAt: Date.UTC(2027, 0, 1) });
    expect(seasonOf(Date.UTC(2027, 0, 1)).id).toBe("2027-Q1");
  });

  it("moves two new players by 16 each way, and an upset by more", () => {
    expect(ratingChanges(["a", "b"], {})).toEqual({ a: 16, b: -16 });
    const upset = ratingChanges(["low", "high"], { low: 900, high: 1100 });
    expect(upset.low).toBeGreaterThan(16);
    expect(upset.high).toBeLessThan(-16);
    expect(expected(1000, 1000)).toBe(0.5);
  });

  it("scores a free-for-all as duels: first gains, last loses, the middle about even, and it nearly balances", () => {
    const c = ratingChanges(["a", "b", "c", "d"], {});
    expect(c.a).toBe(16);
    expect(c.d).toBe(-16);
    expect(Math.abs(c.b!) + Math.abs(c.c!)).toBeLessThanOrEqual(12);
    expect(Math.abs(Object.values(c).reduce((x, y) => x + y, 0))).toBeLessThanOrEqual(2);
  });
});
