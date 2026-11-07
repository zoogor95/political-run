/**
 * Board layout, worked out once per board: small regions enlarged in place, and seat badges placed so none overlap.
 * Big seat counts are placed first and keep their spot; a badge that would overlap moves to the nearest free spot
 * with a short leader line back to its region. Pure maths, no drawing, so it can be tested.
 */
import { boundsOf, parseShapes, type Shape } from "./path.js";
import type { BoardData } from "./types.js";

export interface LayoutOptions {
  /** Scales every badge (insets use smaller badges). */
  badgeScale?: number;
  /** Only regions with at least this many seats get a badge (small regions always do). */
  minBadgeSeats?: number;
  /** Small pieces are enlarged until their longest side is about this many board units. */
  smallTarget?: number;
}

export interface PieceLayout {
  id: string;
  shapes: Shape[];
  small: boolean;
  /** For small regions: the enlarged copy is drawn at cx, cy scaled by k. */
  enlarge?: { cx: number; cy: number; k: number };
}

export interface BadgeLayout {
  id: string;
  seats: number;
  x: number;
  y: number;
  r: number;
  /** Where the badge's region is; a leader line joins it when the badge had to move. */
  anchor: [number, number];
  leader: boolean;
}

export interface BoardLayout {
  pieces: PieceLayout[];
  badges: BadgeLayout[];
}

const ANGLES = [0, 180, -90, 90, -45, 45, -135, 135].map((a) => (a * Math.PI) / 180);

export function badgeRadius(seats: number, scale = 1, small = false): number {
  return (seats >= 100 ? 16 : seats >= 10 && !small ? 14 : small ? 10.5 : 11.5) * scale;
}

export function layoutBoard(board: BoardData, opts: LayoutOptions = {}): BoardLayout {
  const bs = opts.badgeScale ?? 1;
  const minSeats = opts.minBadgeSeats ?? 0;
  const target = (opts.smallTarget ?? 26) * bs;
  const placed: [number, number, number][] = [];
  const free = (x: number, y: number, r: number, gap = 2) => placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > pr + r + gap);
  const inside = (x: number, y: number, r: number) => x - r >= 0 && y - r >= 0 && x + r <= board.width && y + r <= board.height;

  const pieces: PieceLayout[] = board.regions.map((r) => ({ id: r.id, shapes: parseShapes(r.d), small: r.small }));
  const badges: BadgeLayout[] = [];

  // Enlarged small pieces claim their space first so no badge lands on them.
  for (const p of pieces) {
    if (!p.small) continue;
    const b = boundsOf(p.shapes.map((s) => s.outer));
    const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 0.1);
    const k = Math.max(1, Math.min(6, target / size));
    p.enlarge = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k };
    placed.push([p.enlarge.cx, p.enlarge.cy, (size * k) / 2]);
  }

  // Regular badges, biggest seat counts first: on the region when free, otherwise the nearest free spot.
  const regular = board.regions.filter((r) => !r.small && r.seats >= minSeats).sort((a, b) => b.seats - a.seats);
  for (const r of regular) {
    const rad = badgeRadius(r.seats, bs);
    const room = rad + 3 * bs;
    const [x, y] = r.label;
    let spot: [number, number] | null = free(x, y, room) ? [x, y] : null;
    for (let d = room * 0.9; !spot && d <= room * 10; d += room * 0.5) {
      for (const t of ANGLES) {
        const nx = x + Math.cos(t) * d, ny = y + Math.sin(t) * d;
        if (inside(nx, ny, rad) && free(nx, ny, room)) {
          spot = [nx, ny];
          break;
        }
      }
    }
    spot ??= [x, y];
    placed.push([spot[0], spot[1], room]);
    badges.push({ id: r.id, seats: r.seats, x: spot[0], y: spot[1], r: rad, anchor: [x, y], leader: Math.hypot(spot[0] - x, spot[1] - y) > room * 0.6 });
  }

  // Small regions: badge right beside the enlarged piece when there is room, further out with a line when crowded.
  for (const p of pieces) {
    if (!p.enlarge) continue;
    const region = board.regions.find((r) => r.id === p.id)!;
    const rad = badgeRadius(region.seats, bs, true);
    const { cx, cy, k } = p.enlarge;
    const b = boundsOf(p.shapes.map((s) => s.outer));
    const reach = (Math.max(b.x1 - b.x0, b.y1 - b.y0) * k) / 2 + 14 * bs;
    let best: [number, number] | null = null;
    let usedM = 1;
    for (let m = 1; m <= 4.2 && !best; m += 0.6) {
      for (const t of ANGLES) {
        const x = cx + Math.cos(t) * reach * m, y = cy + Math.sin(t) * reach * m;
        if (inside(x, y, rad + 2) && free(x, y, rad + 1.5 * bs, 0)) {
          best = [x, y];
          usedM = m;
          break;
        }
      }
    }
    if (!best) {
      best = [Math.min(board.width - rad, cx + reach * 4), cy];
      usedM = 4;
    }
    placed.push([best[0], best[1], rad + 1.5 * bs]);
    badges.push({ id: p.id, seats: region.seats, x: best[0], y: best[1], r: rad, anchor: [cx, cy], leader: usedM > 1 });
  }

  return { pieces, badges };
}
