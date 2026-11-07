import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import { buildBoard, largestRemainder, pathOf, rewind, ringArea, round, shiftLongitude, shortId, type RegionFeature } from "../src/geometry.ts";

const square = (x: number, y: number, size: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x, y + size],
      [x + size, y + size],
      [x + size, y],
      [x, y],
    ],
  ],
});

describe("helpers", () => {
  it("measures ring area either way round", () => {
    const ring = square(0, 0, 4).coordinates[0]!;
    expect(ringArea(ring)).toBe(16);
    expect(ringArea(ring.slice().reverse())).toBe(16);
  });

  it("rounds board coordinates to half units", () => {
    expect([round(1.24), round(1.26), round(-0.74)]).toEqual([1, 1.5, -0.5]);
  });

  it("writes closed SVG paths without repeating the closing point", () => {
    expect(pathOf([square(0, 0, 2).coordinates])).toBe("M0 0L0 2L2 2L2 0Z");
  });

  it("reverses ring winding and shifts longitude", () => {
    const sq = square(0, 0, 1);
    expect(rewind(sq).coordinates[0]![1]).toEqual([1, 0]);
    expect((shiftLongitude(sq, -4.5) as Polygon).coordinates[0]![0]).toEqual([-4.5, 0]);
  });

  it("splits a total by largest remainder and always hands it all out", () => {
    expect(largestRemainder(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(largestRemainder(7, [5, 3, 0])).toEqual([4, 3, 0]);
    expect(largestRemainder(5, [0, 0])).toEqual([0, 0]);
  });

  it("makes short unique lowercase ids", () => {
    const used = new Set<string>();
    expect(["Karachi", "Karak", "Kark", "D.I. Khan", "Ab"].map((n) => shortId(n, used))).toEqual(["kar", "kaa", "kab", "dik", "abx"]);
  });
});

describe("buildBoard", () => {
  // Three squares near the equator; the two "west" pieces share an id and are merged into one region.
  const features: RegionFeature[] = [
    { type: "Feature", properties: { id: "west", name: "West", seats: 5 }, geometry: square(0, 0, 1) },
    { type: "Feature", properties: { id: "west", name: "West", seats: 5 }, geometry: square(0, 1, 1) },
    { type: "Feature", properties: { id: "east", name: "East", seats: 3 }, geometry: square(1, 0, 0.2) },
  ];
  const board = buildBoard("test", features, { width: 400, height: 400, pad: 10, weight: 0, speck: 1, small: 2000 }, { credits: ["Test data"] });

  it("merges features that share an id and counts seats once per region", () => {
    expect(board.regions.map((r) => r.id)).toEqual(["west", "east"]);
    expect(board.seats).toBe(8);
  });

  it("fits the board and puts each label inside its region", () => {
    const west = board.regions[0]!;
    const nums = west.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    nums.forEach((n) => expect(n >= 0 && n <= 400).toBe(true));
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(west.label[0]).toBeGreaterThan(Math.min(...xs));
    expect(west.label[0]).toBeLessThan(Math.max(...xs));
    expect(west.label[1]).toBeGreaterThan(Math.min(...ys));
    expect(west.label[1]).toBeLessThan(Math.max(...ys));
  });

  it("flags regions too small to tap and keeps credits", () => {
    expect(board.regions.find((r) => r.id === "east")!.small).toBe(true);
    expect(board.regions.find((r) => r.id === "west")!.small).toBe(false);
    expect(board.outline.startsWith("M")).toBe(true);
    expect(board.credits).toEqual(["Test data"]);
  });
});
