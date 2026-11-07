/** Parses the board's SVG paths (absolute M, L and Z only, as written by the map build tool) into polygons with holes. */

export type Ring = number[]; // flat [x0, y0, x1, y1, ...]

export interface Shape {
  outer: Ring;
  holes: Ring[];
}

export function parseRings(d: string): Ring[] {
  const rings: Ring[] = [];
  let cur: Ring | null = null;
  const re = /([MLZ])\s*([^MLZ]*)/gi;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const cmd = m[1]!.toUpperCase();
    const nums = (m[2]!.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (cmd === "M") {
      if (cur && cur.length >= 6) rings.push(cur);
      cur = nums.slice(0, 2);
      for (let i = 2; i + 1 < nums.length; i += 2) cur.push(nums[i]!, nums[i + 1]!);
    } else if (cmd === "L" && cur) {
      for (let i = 0; i + 1 < nums.length; i += 2) cur.push(nums[i]!, nums[i + 1]!);
    } else if (cmd === "Z" && cur) {
      if (cur.length >= 6) rings.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length >= 6) rings.push(cur);
  return rings;
}

export function ringArea(r: Ring): number {
  let s = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    s += r[i]! * r[j + 1]! - r[j]! * r[i + 1]!;
  }
  return Math.abs(s / 2);
}

export function pointInRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, yi = r[i + 1]!, xj = r[j]!, yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Groups rings into shapes: a ring inside a bigger ring is a hole in it (a lake), otherwise it starts a new shape (an island). */
export function parseShapes(d: string): Shape[] {
  const rings = parseRings(d).sort((a, b) => ringArea(b) - ringArea(a));
  const shapes: Shape[] = [];
  for (const r of rings) {
    const host = shapes.find((s) => pointInRing(r[0]!, r[1]!, s.outer) && !s.holes.some((h) => pointInRing(r[0]!, r[1]!, h)));
    if (host) host.holes.push(r);
    else shapes.push({ outer: r, holes: [] });
  }
  return shapes;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boundsOf(rings: Ring[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      b.x0 = Math.min(b.x0, r[i]!);
      b.x1 = Math.max(b.x1, r[i]!);
      b.y0 = Math.min(b.y0, r[i + 1]!);
      b.y1 = Math.max(b.y1, r[i + 1]!);
    }
  }
  return b;
}
