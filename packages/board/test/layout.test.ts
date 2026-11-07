import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutBoard } from "../src/layout.js";
import { parseRings, parseShapes, ringArea } from "../src/path.js";
import { EMPTY, ramp, shadeFor, tint } from "../src/palette.js";
import type { BoardData } from "../src/types.js";

const load = (id: string) => JSON.parse(readFileSync(new URL(`../../content/maps/${id}.json`, import.meta.url), "utf8")) as BoardData;

describe("paths", () => {
  it("parses rings and treats a ring inside another as a hole", () => {
    const d = "M0 0L10 0L10 10L0 10ZM2 2L4 2L4 4L2 4ZM20 20L22 20L22 22Z";
    expect(parseRings(d)).toHaveLength(3);
    const shapes = parseShapes(d);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.holes).toHaveLength(1);
    expect(ringArea(shapes[0]!.outer)).toBe(100);
  });

  it("reads every region of every board", () => {
    for (const id of ["uk", "pk", "in", "my", "us"]) {
      for (const r of load(id).regions) expect(parseShapes(r.d).length).toBeGreaterThan(0);
    }
  });
});

describe("palette", () => {
  it("leaves unentered regions unpainted and darkens with the leader's pips", () => {
    const purple = 0x6a3fc8;
    expect(shadeFor(purple, 0)).toBe(EMPTY);
    expect([1, 3, 6, 11, 15].map((s) => shadeFor(purple, s))).toEqual([ramp(purple)[0], ramp(purple)[1], ramp(purple)[2], purple, purple]);
    expect(tint(0x000000, 0.5)).toBe(0x808080);
  });
});

// The options each board is drawn with. Pakistan's main board shows badges for districts with 4+ seats (as in the
// designs); its close-up inset shows every district at half size.
const CASES: [string, Parameters<typeof layoutBoard>[1]][] = [
  ["uk", {}],
  ["pk", { minBadgeSeats: 4 }],
  ["pk", { badgeScale: 0.5 }],
  ["in", {}],
  ["my", {}],
  ["us", {}],
];

describe.each(CASES)("%s layout %j", (id, opts) => {
  const board = load(id);
  const layout = layoutBoard(board, opts);
  const min = opts?.minBadgeSeats ?? 0;

  it("gives every region a badge (above the minimum seats, small regions always)", () => {
    const expected = board.regions.filter((r) => r.small || r.seats >= min).map((r) => r.id);
    expect(layout.badges.map((b) => b.id).sort()).toEqual(expected.sort());
  });

  it("never overlaps two badges", () => {
    const overlaps: string[] = [];
    for (let i = 0; i < layout.badges.length; i++) {
      for (let j = i + 1; j < layout.badges.length; j++) {
        const a = layout.badges[i]!, b = layout.badges[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) overlaps.push(`${a.id}/${b.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("keeps badges on the board and enlarges every small region", () => {
    for (const b of layout.badges) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(-0.5);
      expect(b.y - b.r).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.r).toBeLessThanOrEqual(board.width + 0.5);
      expect(b.y + b.r).toBeLessThanOrEqual(board.height + 0.5);
    }
    for (const p of layout.pieces) expect(Boolean(p.enlarge)).toBe(p.small);
  });
});

describe("badge options", () => {
  it("can show badges only for bigger regions, with small regions always shown", () => {
    const pk = load("pk");
    const layout = layoutBoard(pk, { minBadgeSeats: 4 });
    const shown = new Set(layout.badges.map((b) => b.id));
    for (const r of pk.regions) expect(shown.has(r.id)).toBe(r.seats >= 4 || r.small);
  });
});
