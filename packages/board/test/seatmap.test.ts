import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hexLayout, seatMapLayout, unitLayout } from "../src/seatmap.js";
import type { BoardData } from "../src/types.js";

const load = (id: string) => JSON.parse(readFileSync(new URL(`../../content/maps/${id}.json`, import.meta.url), "utf8")) as BoardData;

describe.each(["uk", "pk", "us"])("%s seat map", (id) => {
  const board = load(id);
  const layout = hexLayout(board);

  it("draws one hex per seat, each region holding exactly its seats", () => {
    expect(layout.cells).toHaveLength(board.seats);
    expect(new Set(layout.cells.map((c) => c.id)).size).toBe(board.seats);
    for (const r of board.regions) {
      const mine = layout.cells.filter((c) => c.region === r.id);
      expect(mine).toHaveLength(r.seats);
      expect(mine.map((c) => c.rank).sort((a, b) => a - b)).toEqual(Array.from({ length: r.seats }, (_, i) => i));
      expect(layout.borders[r.id]).toMatch(/^M/);
    }
  });

  it("keeps every hex inside the view box", () => {
    const [x, y, w, h] = layout.viewBox;
    for (const c of layout.cells) {
      expect(c.x).toBeGreaterThan(x);
      expect(c.x).toBeLessThan(x + w);
      expect(c.y).toBeGreaterThan(y);
      expect(c.y).toBeLessThan(y + h);
    }
  });

  it("is the same every time", () => {
    expect(hexLayout(board)).toEqual(layout);
  });
});

describe("unit layout", () => {
  it("is used when the board has units, one cell per unit", () => {
    const uk = load("uk");
    const board: BoardData = {
      ...uk,
      units: uk.regions.map((r) => ({ id: `u-${r.id}`, name: r.name, region: r.id, seats: r.seats, d: r.d, label: r.label })),
    };
    const layout = seatMapLayout(board);
    expect(layout.kind).toBe("units");
    expect(layout).toEqual(unitLayout(board));
    expect(layout.cells.reduce((a, c) => a + c.seats, 0)).toBe(uk.seats);
    expect(seatMapLayout(uk).kind).toBe("hex");
  });
});
