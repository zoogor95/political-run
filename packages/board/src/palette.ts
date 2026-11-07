/** Tabletop colours and the four-shade ramp each party gets from its one chosen colour. */

export const INK = 0x2b2440;
export const CREAM = 0xfff7e2;
export const WATER = 0x79c9da;
export const EMPTY = 0xf4ecd2;
export const GOLD = 0xffd34d;
export const GREY_LAND = 0xc8c8d0;

export function hexToNumber(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return parseInt(full, 16);
}

/** Mixes a colour toward white by t (0 = unchanged, 1 = white). */
export function tint(color: number, t: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** Four shades from light to full strength. */
export function ramp(color: number): [number, number, number, number] {
  return [tint(color, 0.72), tint(color, 0.45), tint(color, 0.2), color];
}

/**
 * Map shading: an unentered region is unpainted; otherwise colour strength shows the leader's pip count.
 * Shades step up at 3 (contention), 6 and 11 steps on a 15-step meter, scaled for other meter lengths.
 */
export function shadeFor(color: number, leaderSteps: number, meterSteps = 15): number {
  if (leaderSteps <= 0) return EMPTY;
  const f = leaderSteps / meterSteps;
  const tier = f >= 11 / 15 ? 3 : f >= 6 / 15 ? 2 : f >= 3 / 15 ? 1 : 0;
  return ramp(color)[tier];
}
