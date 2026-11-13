/**
 * The results seat map. On most maps every seat is a hexagon, grouped by region and grown out from the region's label
 * point (a cartogram: crowded regions such as London spill over their real borders). Boards with units (real
 * constituency shapes) draw those instead.
 */
import { type Shape, parseShapes, pointInRing, ringArea } from "./path.js";
import type { BoardData } from "./types.js";

export interface SeatCell {
  /** Hex "q,r" or the unit's id. */
  id: string;
  region: string;
  /** Seats the cell holds: 1 for a hex, the unit's seats for a unit. */
  seats: number;
  d: string;
  /** Centre, for labels and focus. */
  x: number;
  y: number;
  /** Order within its region, most central first: the region's biggest party fills the centre. */
  rank: number;
}

export interface SeatMapLayout {
  kind: "hex" | "units";
  cells: SeatCell[];
  /** Outline of each region's cells, for highlighting. */
  borders: Record<string, string>;
  viewBox: [number, number, number, number];
}

const SQ3 = Math.sqrt(3);
/** Axial neighbour offsets in the order of the hex's sides, starting with the right side. */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

const r1 = (v: number) => Math.round(v * 10) / 10;

function corners(x: number, y: number, size: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return [r1(x + size * Math.cos(a)), r1(y + size * Math.sin(a))];
  });
}

function inShapes(shapes: Shape[], x: number, y: number): boolean {
  return shapes.some((s) => pointInRing(x, y, s.outer) && !s.holes.some((h) => pointInRing(x, y, h)));
}

function shapeArea(shapes: Shape[]): number {
  return shapes.reduce((a, s) => a + ringArea(s.outer) - s.holes.reduce((b, h) => b + ringArea(h), 0), 0);
}

/** Lays out one hex per seat. Deterministic: the same board always gives the same map. */
export function hexLayout(board: BoardData): SeatMapLayout {
  const shapes = new Map(board.regions.map((r) => [r.id, parseShapes(r.d)]));
  const land = board.regions.reduce((a, r) => a + shapeArea(shapes.get(r.id)!), 0);
  // Hexes cover about as much as the land does.
  const size = Math.sqrt(land / board.seats / ((3 * SQ3) / 2));
  const toPx = (q: number, r: number): [number, number] => [size * SQ3 * (q + r / 2), size * 1.5 * r];
  const toHex = (x: number, y: number): [number, number] => {
    const fq = ((SQ3 / 3) * x - y / 3) / size;
    const fr = ((2 / 3) * y) / size;
    const fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    return [q, r];
  };
  const key = (q: number, r: number) => `${q},${r}`;

  const landOf = new Map<string, string | null>();
  const landAt = (q: number, r: number) => {
    const k = key(q, r);
    if (!landOf.has(k)) {
      const [x, y] = toPx(q, r);
      landOf.set(k, board.regions.find((reg) => inShapes(shapes.get(reg.id)!, x, y))?.id ?? null);
    }
    return landOf.get(k)!;
  };

  const owner = new Map<string, string>();
  const cellsOf = new Map<string, [number, number][]>(board.regions.map((r) => [r.id, []]));
  const seed = new Map<string, [number, number]>();
  const take = (region: string, q: number, r: number) => {
    owner.set(key(q, r), region);
    cellsOf.get(region)!.push([q, r]);
  };
  /** The free cell nearest a point, searching outward ring by ring. */
  const nearestFree = (q0: number, r0: number): [number, number] => {
    for (let k = 0; ; k++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dq = -k; dq <= k; dq++) {
        for (let dr = Math.max(-k, -dq - k); dr <= Math.min(k, -dq + k); dr++) {
          if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== k) continue;
          const q = q0 + dq, r = r0 + dr;
          if (owner.has(key(q, r))) continue;
          const [x, y] = toPx(q, r);
          const [sx, sy] = toPx(q0, r0);
          const d = Math.hypot(x - sx, y - sy);
          if (d < bestD) [best, bestD] = [[q, r], d];
        }
      }
      if (best) return best;
    }
  };

  // Seeds: the biggest regions place first, at their label point.
  for (const reg of [...board.regions].sort((a, b) => b.seats - a.seats || (a.id < b.id ? -1 : 1))) {
    const [q, r] = nearestFree(...toHex(reg.label[0], reg.label[1]));
    seed.set(reg.id, toPx(q, r));
    take(reg.id, q, r);
  }

  // Grow: the region furthest from done takes its best free neighbour cell: on its own land, then empty sea, then a
  // neighbour's land; nearer its seed first.
  const left = new Map(board.regions.map((r) => [r.id, r.seats - 1]));
  for (;;) {
    let next: string | null = null;
    for (const reg of board.regions) {
      const rem = left.get(reg.id)!;
      if (rem <= 0) continue;
      if (next === null || rem / reg.seats > left.get(next)! / board.regions.find((x) => x.id === next)!.seats) next = reg.id;
    }
    if (next === null) break;
    const [sx, sy] = seed.get(next)!;
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (const [q, r] of cellsOf.get(next)!) {
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr;
        if (owner.has(key(nq, nr))) continue;
        const [x, y] = toPx(nq, nr);
        const at = landAt(nq, nr);
        const penalty = at === next ? 0 : at === null ? 1.5 : 3;
        const score = Math.hypot(x - sx, y - sy) / size + penalty;
        if (score < bestScore - 1e-9) [best, bestScore] = [[nq, nr], score];
      }
    }
    // Walled in by other regions: jump to the nearest free cell.
    best ??= nearestFree(...toHex(sx, sy));
    take(next, best[0], best[1]);
    left.set(next, left.get(next)! - 1);
  }

  const cells: SeatCell[] = [];
  const borders: Record<string, string> = {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const reg of board.regions) {
    const list = cellsOf.get(reg.id)!.map(([q, r]) => ({ q, r, xy: toPx(q, r) }));
    const cx = list.reduce((a, c) => a + c.xy[0], 0) / list.length;
    const cy = list.reduce((a, c) => a + c.xy[1], 0) / list.length;
    const ranked = [...list].sort((a, b) => Math.hypot(a.xy[0] - cx, a.xy[1] - cy) - Math.hypot(b.xy[0] - cx, b.xy[1] - cy) || a.q - b.q || a.r - b.r);
    const edges: string[] = [];
    ranked.forEach((c, rank) => {
      const [x, y] = c.xy;
      const pts = corners(x, y, size);
      cells.push({ id: key(c.q, c.r), region: reg.id, seats: 1, d: `M${pts.map((p) => p.join(" ")).join("L")}Z`, x: r1(x), y: r1(y), rank });
      DIRS.forEach(([dq, dr], side) => {
        if (owner.get(key(c.q + dq, c.r + dr)) === reg.id) return;
        const a = pts[side]!, b = pts[(side + 1) % 6]!;
        edges.push(`M${a.join(" ")}L${b.join(" ")}`);
      });
      x0 = Math.min(x0, x - size);
      x1 = Math.max(x1, x + size);
      y0 = Math.min(y0, y - size);
      y1 = Math.max(y1, y + size);
    });
    borders[reg.id] = edges.join("");
  }
  const pad = size;
  return { kind: "hex", cells, borders, viewBox: [r1(x0 - pad), r1(y0 - pad), r1(x1 - x0 + 2 * pad), r1(y1 - y0 + 2 * pad)] };
}

/** Draws each unit in its real shape. */
export function unitLayout(board: BoardData): SeatMapLayout {
  const units = board.units ?? [];
  const cells: SeatCell[] = board.regions.flatMap((reg) =>
    units
      .filter((u) => u.region === reg.id)
      .sort((a, b) => b.seats - a.seats || (a.id < b.id ? -1 : 1))
      .map((u, rank) => ({ id: u.id, region: u.region, seats: u.seats, d: u.d, x: u.label[0], y: u.label[1], rank })),
  );
  return { kind: "units", cells, borders: Object.fromEntries(board.regions.map((r) => [r.id, r.d])), viewBox: [0, 0, board.width, board.height] };
}

const layouts = new WeakMap<BoardData, SeatMapLayout>();

/** The seat map for a board (worked out once per board). */
export function seatMapLayout(board: BoardData): SeatMapLayout {
  let l = layouts.get(board);
  if (!l) layouts.set(board, (l = board.units?.length ? unitLayout(board) : hexLayout(board)));
  return l;
}
