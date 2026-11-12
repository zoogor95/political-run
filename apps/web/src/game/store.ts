/**
 * Purchases. The candidate creator is a one-time unlock. No payment provider is connected yet, so every build uses
 * the test store: buying grants the unlock in this browser and charges nothing, and the purchase screen says so. A
 * real store (web checkout, Steam, Google Play, the App Store) replaces `purchase` later; `owns` stays the check.
 */
import { useSyncExternalStore } from "react";

export type ProductId = "candidate-creator";

export const PRODUCTS: Record<ProductId, { name: string; price: string; about: string }> = {
  "candidate-creator": {
    name: "Candidate creator",
    price: "$9.99",
    about: "Build your own candidates: a cartoon avatar, a name and bio, and bonuses bought from a points budget so they're never stronger than the real leaders.",
  },
};

/** True while purchases are simulated. */
export const TEST_STORE = true;

const KEY = "mm.purchases.v1";
const listeners = new Set<() => void>();
let cache: ProductId[] | null = null;

function read(): ProductId[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = Array.isArray(v) ? (v.filter((x) => x in PRODUCTS) as ProductId[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function owns(product: ProductId): boolean {
  return read().includes(product);
}

/** Buys a product. In the test store this always succeeds at no charge. */
export async function purchase(product: ProductId): Promise<boolean> {
  if (owns(product)) return true;
  cache = [...read(), product];
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Private windows can refuse storage: the unlock then lasts until the page closes.
  }
  listeners.forEach((l) => l());
  return true;
}

export function useOwns(product: ProductId): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => owns(product),
  );
}
