import { describe, expect, it } from "vitest";
import { MAPS } from "./model";
import { rosterAvatar } from "./Portrait";

const all = Object.values(MAPS).flatMap((m) => m.pack.candidates.map((c) => ({ map: m.id, id: c.id, affiliation: c.affiliation })));

describe("roster characters", () => {
  it("are always the same for the same politician", () => {
    for (const c of all) expect(rosterAvatar(c)).toEqual(rosterAvatar({ ...c }));
  });

  it("say nothing about how the real person looks: one neutral skin tone, only short or long hair", () => {
    const av = all.map(rosterAvatar);
    expect(new Set(av.map((a) => a.skin)).size).toBe(1);
    expect(av.every((a) => a.hairStyle === "short" || a.hairStyle === "long")).toBe(true);
  });

  it("give politicians of one party the same outfit and backdrop, and tell most of them apart", () => {
    const byParty = new Map<string, ReturnType<typeof rosterAvatar>[]>();
    for (const c of all) byParty.set(`${c.map}:${c.affiliation}`, [...(byParty.get(`${c.map}:${c.affiliation}`) ?? []), rosterAvatar(c)]);
    for (const group of byParty.values()) {
      expect(new Set(group.map((a) => a.outfit)).size).toBe(1);
      expect(new Set(group.map((a) => a.bg)).size).toBe(1);
    }
    // Across the whole roster, almost every character is distinct (a few lookalikes are fine).
    const keys = new Set(all.map((c) => JSON.stringify(rosterAvatar(c))));
    expect(keys.size).toBeGreaterThan(all.length * 0.8);
  });
});
