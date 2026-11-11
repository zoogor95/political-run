import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MapPack } from "@majority-map/core";
import ukJson from "../packs/uk/pack.json" with { type: "json" };

interface Board {
  id: string;
  width: number;
  height: number;
  seats: number;
  regions: { id: string; name: string; seats: number; d: string; label: [number, number]; small: boolean; area?: string }[];
  outline: string;
  areaBorders?: string;
  greyed?: { d: string; label: [number, number]; name: string };
  sampleSeats?: boolean;
  credits: string[];
  notes: string[];
}

const load = (id: string) => JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url), "utf8")) as Board;
const EXPECTED: Record<string, number> = { uk: 650, in: 543, pk: 266, my: 222, us: 538 };

describe.each(Object.keys(EXPECTED))("%s board", (id) => {
  const board = load(id);

  it("has the expected seats in total and per region", () => {
    expect(board.seats).toBe(EXPECTED[id]);
    expect(board.regions.reduce((a, r) => a + r.seats, 0)).toBe(EXPECTED[id]);
    board.regions.forEach((r) => expect(Number.isInteger(r.seats) && r.seats >= 1).toBe(true));
  });

  it("has unique lowercase region ids, real geometry and labels on the board", () => {
    const ids = board.regions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of board.regions) {
      expect(r.id).toMatch(/^[a-z0-9-]+$/);
      expect(r.d).toMatch(/^M[\d.\- LZM]+Z$/);
      expect(r.label[0]).toBeGreaterThanOrEqual(0);
      expect(r.label[0]).toBeLessThanOrEqual(board.width);
      expect(r.label[1]).toBeGreaterThanOrEqual(0);
      expect(r.label[1]).toBeLessThanOrEqual(board.height);
    }
    expect(board.outline.length).toBeGreaterThan(100);
  });

  it("credits its sources", () => {
    expect(board.credits.length).toBeGreaterThan(0);
  });
});

describe("board specifics", () => {
  it("UK board matches the UK pack's regions and seats", () => {
    const pack = ukJson as MapPack;
    const board = load("uk");
    expect(Object.fromEntries(board.regions.map((r) => [r.id, r.seats]))).toEqual(Object.fromEntries(pack.regions.map((r) => [r.id, r.seats])));
  });

  it("Pakistan uses its 33 divisions with the real 2023 seat counts and greys out Jammu and Kashmir", () => {
    const pk = load("pk");
    expect(pk.regions.length).toBe(33);
    expect(pk.sampleSeats).toBe(false);
    expect(pk.greyed?.name).toBe("Jammu and Kashmir");
    expect(pk.areaBorders?.length).toBeGreaterThan(100);
    const byName = (n: string) => pk.regions.find((r) => r.name === n)!;
    expect([byName("Karachi").seats, byName("Lahore").seats, byName("Islamabad").seats, byName("Faisalabad").seats]).toEqual([22, 24, 3, 18]);
    expect(byName("Larkana").seats).toBe(8);
    expect(byName("Islamabad").small).toBe(true);
    const provinceSeats: Record<string, number> = {};
    pk.regions.forEach((r) => (provinceSeats[r.area!] = (provinceSeats[r.area!] ?? 0) + r.seats));
    expect(provinceSeats).toEqual({ pb: 141, sd: 61, kp: 45, ba: 16, is: 3 });
  });

  it("India is flagged as a placeholder until official boundaries are used", () => {
    expect(load("in").notes.join(" ")).toMatch(/Survey of India/);
  });
});
