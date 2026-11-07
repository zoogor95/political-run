import { groupModifier } from "./costs.js";
import { meterOf, regionLeader, regionRanking } from "./standing.js";
import type { GameState, GroupDef, MapPack, PlayerState, TurnEvent } from "./types.js";

/** Every meter on the board: regions first, then national groups, in pack order. Payments follow this order. */
export function trackIds(pack: MapPack): string[] {
  return [...pack.regions.map((r) => r.id), ...pack.groups.filter((g) => g.kind === "national").map((g) => g.id)];
}

export function isRegion(pack: MapPack, trackId: string): boolean {
  return pack.regions.some((r) => r.id === trackId);
}

export function nationalGroup(pack: MapPack, trackId: string): GroupDef | undefined {
  return pack.groups.find((g) => g.id === trackId && g.kind === "national");
}

/** Group wallets that can pay for steps on a track: the region's state groups and every national group. Base money always can. */
export function eligibleWallets(pack: MapPack, trackId: string): string[] {
  const region = isRegion(pack, trackId);
  return pack.groups.filter((g) => g.kind === "national" || (region && g.regions.includes(trackId))).map((g) => g.id);
}

/** The order wallets pay for a step: eligible group wallets with money, smallest balance first, then base money. */
export function paymentOrder(pack: MapPack, player: PlayerState, trackId: string): string[] {
  const groupOrder = pack.groups.map((g) => g.id);
  const groups = eligibleWallets(pack, trackId)
    .filter((id) => (player.wallets[id] ?? 0) > 0)
    .sort((a, b) => (player.wallets[a] ?? 0) - (player.wallets[b] ?? 0) || groupOrder.indexOf(a) - groupOrder.indexOf(b));
  return [...groups, "base"];
}

/** Money a player can put into a track this turn, across every eligible wallet. */
export function spendable(pack: MapPack, player: PlayerState, trackId: string): number {
  return eligibleWallets(pack, trackId).reduce((a, id) => a + (player.wallets[id] ?? 0), player.money);
}

/** A player's money in every wallet. */
export function totalMoney(player: PlayerState): number {
  return Object.values(player.wallets).reduce((a, b) => a + b, player.money);
}

/**
 * Takes a cost from the player's wallets in payment order, changing the player. Returns how much came from each wallet
 * ("base" for base money), or null without changing anything if the eligible wallets can't cover it.
 */
export function pay(pack: MapPack, player: PlayerState, trackId: string, amount: number): Record<string, number> | null {
  if (spendable(pack, player, trackId) < amount) return null;
  const paidFrom: Record<string, number> = {};
  let left = amount;
  for (const id of paymentOrder(pack, player, trackId)) {
    if (left === 0) break;
    const balance = id === "base" ? player.money : (player.wallets[id] ?? 0);
    const take = Math.min(balance, left);
    if (take === 0) continue;
    if (id === "base") player.money -= take;
    else player.wallets[id] = balance - take;
    paidFrom[id] = take;
    left -= take;
  }
  return paidFrom;
}

/** Sum of the group's regions' campaign costs; control needs leads worth more than half of it. */
export function groupCampaignCost(pack: MapPack, group: GroupDef): number {
  return pack.regions.filter((r) => group.regions.includes(r.id)).reduce((a, r) => a + r.baseCost, 0);
}

/**
 * Who controls a group, or null. State group: the player leading regions worth more than half of the group's total
 * campaign cost (any lead counts, in contention or not; exactly half is nobody). National group: the player leading
 * its meter with at least 3 steps (the contention threshold).
 */
export function groupController(pack: MapPack, state: GameState, groupId: string): string | null {
  const group = pack.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Unknown group "${groupId}"`);
  if (group.kind === "national") {
    const top = regionRanking(state, groupId)[0];
    return top !== undefined && meterOf(state, groupId, top).steps >= pack.rules.contentionAt ? top : null;
  }
  const half = groupCampaignCost(pack, group) / 2;
  const led: Record<string, number> = {};
  for (const r of pack.regions) {
    if (!group.regions.includes(r.id)) continue;
    const leader = regionLeader(state, r.id);
    if (leader !== null) led[leader] = (led[leader] ?? 0) + r.baseCost;
  }
  const winner = Object.entries(led).find(([, cost]) => cost > half);
  return winner ? winner[0] : null;
}

export function controllers(pack: MapPack, state: GameState): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const g of pack.groups) out[g.id] = groupController(pack, state, g.id);
  return out;
}

/** Income multiplier from a player's modifier on a group: +25% turns 50K into 62.5K. Clamped like step costs. */
export function incomeMultiplier(pack: MapPack, player: PlayerState, groupId: string): number {
  const m = 1 + groupModifier(pack, player, groupId) / 100;
  return Math.min(pack.rules.costClampMax, Math.max(pack.rules.costClampMin, m));
}

/** Gives every player base money and income from each group they control right now. Unspent money of every kind carries over. */
export function grantIncome(pack: MapPack, state: GameState, events: TurnEvent[]): void {
  const ctrl = controllers(pack, state);
  for (const player of state.players) {
    player.money += pack.rules.baseIncome;
    const groups: Record<string, number> = {};
    for (const g of pack.groups) {
      if (ctrl[g.id] !== player.id) continue;
      const amount = Math.round(g.income * incomeMultiplier(pack, player, g.id));
      player.wallets[g.id] = (player.wallets[g.id] ?? 0) + amount;
      groups[g.id] = amount;
    }
    events.push({ type: "income", playerId: player.id, base: pack.rules.baseIncome, groups });
  }
}

/** Events for groups that changed hands between two moments. Money already in a wallet stays when control is lost. */
export function controlChanges(before: Record<string, string | null>, after: Record<string, string | null>): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (const [groupId, now] of Object.entries(after)) {
    const was = before[groupId] ?? null;
    if (was === now) continue;
    if (was !== null) events.push({ type: "control_lost", groupId, playerId: was });
    if (now !== null) events.push({ type: "control_gained", groupId, playerId: now });
  }
  return events;
}
