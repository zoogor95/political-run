import { describe, expect, it } from "vitest";
import { EMPTY_STATS } from "./achievements";
import { keyForCode, mergeProfile, mergeUnlocked, newRecoveryCode, newerStats, normalizeCode } from "./recovery";

describe("recovery codes", () => {
  it("are 25 unambiguous characters in groups of five, different every time", () => {
    const a = newRecoveryCode();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
    expect(newRecoveryCode()).not.toBe(a);
  });

  it("forgive case, spacing and look-alike letters when typed back", () => {
    const code = "7KQ2M-9XH40-ABCDE-FGH1J-KMNPQ";
    expect(normalizeCode(code)).toBe(code);
    expect(normalizeCode(" 7kq2m 9xh4o abcde fghij kmnpq ")).toBe(code);
    expect(normalizeCode("7KQ2M9XH40ABCDEFGHLJKMNPQ")).toBe(code);
    expect(normalizeCode("7KQ2M-9XH40")).toBeNull();
    expect(normalizeCode("UUUUU-UUUUU-UUUUU-UUUUU-UUUUU")).toBeNull();
  });

  it("turn into a stable device key the server accepts, without sending the code itself", async () => {
    const key = await keyForCode("7KQ2M-9XH40-ABCDE-FGH1J-KMNPQ");
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await keyForCode("7KQ2M-9XH40-ABCDE-FGH1J-KMNPQ")).toBe(key);
    expect(await keyForCode("7KQ2M-9XH40-ABCDE-FGH1J-KMNPR")).not.toBe(key);
  });
});

describe("merging with the online copy", () => {
  const stats = (matches: number, turns: number) => ({ ...EMPTY_STATS, matches, turns });

  it("keeps the stats with more play behind them", () => {
    expect(newerStats(stats(3, 40), stats(5, 10)).matches).toBe(5);
    expect(newerStats(stats(5, 60), stats(5, 50)).turns).toBe(60);
  });

  it("keeps every achievement from both sides with its earliest date", () => {
    expect(mergeUnlocked({ a: 5, b: 9 }, { b: 3, c: 7 })).toEqual({ a: 5, b: 3, c: 7 });
  });

  it("takes the server's name unless it was changed on this device", () => {
    const local = { name: "Here", stats: stats(1, 5), unlocked: { a: 1 } };
    const remote = { name: "There", stats: stats(4, 20), unlocked: { b: 2 } };
    expect(mergeProfile(local, remote, false)).toEqual({ name: "There", stats: stats(4, 20), unlocked: { a: 1, b: 2 } });
    expect(mergeProfile(local, remote, true).name).toBe("Here");
    expect(mergeProfile({ ...local, name: "" }, remote, true).name).toBe("There");
    expect(mergeProfile(local, { ...remote, stats: null }, false).stats).toEqual(local.stats);
  });
});
