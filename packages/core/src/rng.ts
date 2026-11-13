/** Small seeded random generator (mulberry32). The state is one 32-bit number stored in GameState.rng, so matches replay exactly. */

export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** Returns a number in [0, 1) and the next generator state. */
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** A 32-bit hash of a string (FNV-1a), for seeding a generator from names. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
