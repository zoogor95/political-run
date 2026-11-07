import { moveCost, playerById } from "./costs.js";
import { controlChanges, controllers, grantIncome, isRegion, pay, trackIds } from "./economy.js";
import { seedRng } from "./rng.js";
import { allInContention, inContention, meterOf } from "./standing.js";
import type { GameState, MapPack, Plan, PlayerSetup, TurnEvent } from "./types.js";

export interface MatchSetup {
  players: PlayerSetup[];
  seed: number;
}

/** Starts a match on an empty board. Every player gets the first turn's base money. */
export function createMatch(pack: MapPack, setup: MatchSetup): GameState {
  if (setup.players.length < 2 || setup.players.length > 5) throw new Error("A match needs 2 to 5 players");
  const ids = new Set(setup.players.map((p) => p.id));
  if (ids.size !== setup.players.length) throw new Error("Player ids must be unique");
  const colors = new Set(setup.players.map((p) => p.party.color.toLowerCase()));
  const emblems = new Set(setup.players.map((p) => p.party.emblem));
  if (colors.size !== setup.players.length || emblems.size !== setup.players.length) {
    throw new Error("Each party needs its own colour and emblem");
  }
  for (const p of setup.players) {
    if (!pack.candidates.some((c) => c.id === p.leaderId)) throw new Error(`Unknown leader "${p.leaderId}"`);
  }
  const meters: GameState["meters"] = {};
  for (const id of trackIds(pack)) {
    meters[id] = {};
    for (const p of setup.players) meters[id]![p.id] = { steps: 0, reached: [], entered: false };
  }
  const wallets = () => Object.fromEntries(pack.groups.map((g) => [g.id, 0]));
  return {
    packId: pack.id,
    turn: 1,
    round: 1,
    phase: "campaign",
    players: setup.players.map((p) => ({
      id: p.id,
      leaderId: p.leaderId,
      party: { ...p.party },
      members: [],
      money: pack.rules.baseIncome,
      wallets: wallets(),
      spent: 0,
    })),
    meters,
    locked: {},
    rng: seedRng(setup.seed),
  };
}

export function isPickTurn(pack: MapPack, state: GameState): boolean {
  const every = pack.rules.memberPickEvery;
  return every > 0 && state.turn % every === 0;
}

/** True when the player may pick a party member this turn: a pick turn on which they haven't used their pick. */
export function canPick(pack: MapPack, state: GameState, playerId: string): boolean {
  if (!isPickTurn(pack, state)) return false;
  const allowed = Math.floor(state.turn / pack.rules.memberPickEvery);
  return playerById(state, playerId).members.length < allowed;
}

/** Candidates a player may pick as a member: anyone except themselves, other parties' leaders and members they already have. */
export function pickPool(pack: MapPack, state: GameState, playerId: string): string[] {
  const player = playerById(state, playerId);
  const taken = new Set([...state.players.map((p) => p.leaderId), ...player.members.map((m) => m.candidateId)]);
  return pack.candidates.map((c) => c.id).filter((id) => !taken.has(id));
}

export interface PlanIssue {
  code:
    | "not_campaigning"
    | "unknown_track"
    | "locked"
    | "not_higher"
    | "over_top"
    | "entry_limit"
    | "not_enough_money"
    | "not_pick_turn"
    | "bad_pick"
    | "bad_assign";
  message: string;
}

/** Checks one player's plan against the board at the start of the turn. An empty list means the plan can be submitted. */
export function validatePlan(pack: MapPack, state: GameState, playerId: string, plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (code: PlanIssue["code"], message: string) => issues.push({ code, message });
  const player = playerById(state, playerId);
  if (state.phase !== "campaign" && state.phase !== "final") {
    add("not_campaigning", "The campaign is over");
    return issues;
  }

  // Picks come first so a member picked this turn already shapes this turn's costs.
  const members = player.members.map((m) => m.candidateId);
  if (plan.pick !== undefined) {
    const picksSoFar = player.members.length;
    const picksAllowed = pack.rules.memberPickEvery > 0 ? Math.floor(state.turn / pack.rules.memberPickEvery) : 0;
    if (!isPickTurn(pack, state)) add("not_pick_turn", `Party members are picked every ${pack.rules.memberPickEvery} turns`);
    else if (picksSoFar >= picksAllowed) add("bad_pick", "You've already picked a member this turn");
    else if (!pack.candidates.some((c) => c.id === plan.pick)) add("bad_pick", "Unknown candidate");
    else if (plan.pick === player.leaderId) add("bad_pick", "Your leader can't also be a member");
    else if (state.players.some((p) => p.id !== playerId && p.leaderId === plan.pick)) add("bad_pick", "Another party's leader can't be picked");
    else if (members.includes(plan.pick)) add("bad_pick", "Already in your party");
    else members.push(plan.pick);
  }
  // A scratch copy of the player pays for the plan in the same order resolution will, so "can afford" means exactly that.
  const payer = structuredClone(player);
  payer.members = members.map((candidateId) => ({ candidateId, regionId: null, assignedTurn: null }));
  const tracks = trackIds(pack);
  let total = 0;
  let short = false;
  const ordered = Object.entries(plan.steps ?? {}).sort(([a], [b]) => tracks.indexOf(a) - tracks.indexOf(b));
  for (const [regionId, target] of ordered) {
    if (!tracks.includes(regionId)) {
      add("unknown_track", `Unknown region or group "${regionId}"`);
      continue;
    }
    const meter = meterOf(state, regionId, playerId);
    if (state.locked[regionId] !== undefined) add("locked", `${regionId} is locked`);
    else if (!Number.isInteger(target) || target <= meter.steps) add("not_higher", `${regionId}: the target must be above your current ${meter.steps} steps`);
    else if (target > pack.rules.steps) add("over_top", `${regionId}: the meter has ${pack.rules.steps} steps`);
    else if (!meter.entered && target > pack.rules.firstEntryMax) add("entry_limit", `${regionId}: your first investment is limited to ${pack.rules.firstEntryMax} steps`);
    else {
      const cost = moveCost(pack, payer, regionId, meter.steps, target);
      total += cost;
      if (pay(pack, payer, regionId, cost) === null) short = true;
    }
  }
  if (short) add("not_enough_money", `This plan costs ${total}, more than the money you can spend in those places`);

  const usedRegions = new Set(player.members.map((m) => m.regionId).filter((r): r is string => r !== null));
  for (const [candidateId, regionId] of Object.entries(plan.assign ?? {})) {
    const existing = player.members.find((m) => m.candidateId === candidateId);
    const isNewPick = plan.pick === candidateId && members.includes(candidateId);
    if (!existing && !isNewPick) add("bad_assign", `${candidateId} isn't one of your members`);
    else if (existing && existing.regionId !== null) add("bad_assign", "Members can't be moved once assigned");
    else if (!isRegion(pack, regionId)) add("bad_assign", `Members can only be assigned to regions`);
    else if (!meterOf(state, regionId, playerId).entered) add("bad_assign", `Members can only go to regions you've entered`);
    else if (usedRegions.has(regionId)) add("bad_assign", `You already have a member in ${regionId}`);
    else if (state.locked[regionId] !== undefined) add("bad_assign", `${regionId} is locked`);
    else usedRegions.add(regionId);
  }
  return issues;
}

/**
 * Resolves a turn: picks and assignments, then all paid moves together with conflicts, then free pips,
 * then locks, the contention check and the next turn's income. Plans must already be valid.
 */
export function resolveTurn(pack: MapPack, before: GameState, plans: Record<string, Plan>): { state: GameState; events: TurnEvent[] } {
  for (const p of before.players) {
    const issues = validatePlan(pack, before, p.id, plans[p.id] ?? {});
    if (issues.length > 0) throw new Error(`Invalid plan for ${p.id}: ${issues.map((i) => i.message).join("; ")}`);
  }
  const state = structuredClone(before);
  const events: TurnEvent[] = [];
  const turn = state.turn;
  const paidStamp = turn * 2;
  const freeStamp = turn * 2 + 1;
  const contendedBefore = new Set(pack.regions.filter((r) => inContention(pack, before, r.id)).map((r) => r.id));
  const controlBefore = controllers(pack, before);
  const tracks = trackIds(pack);

  // 1. Picks and assignments.
  for (const player of state.players) {
    const plan = plans[player.id] ?? {};
    if (plan.pick !== undefined) {
      player.members.push({ candidateId: plan.pick, regionId: null, assignedTurn: null });
      events.push({ type: "picked", playerId: player.id, candidateId: plan.pick });
    }
    for (const [candidateId, regionId] of Object.entries(plan.assign ?? {})) {
      const m = player.members.find((x) => x.candidateId === candidateId)!;
      m.regionId = regionId;
      m.assignedTurn = turn;
      events.push({ type: "assigned", playerId: player.id, candidateId, regionId });
    }
  }

  // 2. Paid moves, revealed together, on regions and national group meters. Costs use the start-of-turn steps plus
  // this turn's picks; each player pays track by track in pack order, matching validatePlan.
  for (const region of tracks.map((id) => ({ id }))) {
    const moves = state.players
      .map((p) => ({ player: p, target: plans[p.id]?.steps?.[region.id] }))
      .filter((m): m is { player: (typeof state.players)[number]; target: number } => m.target !== undefined);
    const byTarget = new Map<number, typeof moves>();
    for (const m of moves) byTarget.set(m.target, [...(byTarget.get(m.target) ?? []), m]);

    for (const [target, group] of byTarget) {
      const costs: Record<string, number> = {};
      const paid: Record<string, Record<string, number>> = {};
      for (const { player } of group) {
        const meter = meterOf(state, region.id, player.id);
        const cost = moveCost(pack, player, region.id, meter.steps, target);
        paid[player.id] = pay(pack, player, region.id, cost)!;
        player.spent += cost;
        costs[player.id] = cost;
        meter.entered = true;
      }
      if (group.length > 1) {
        events.push({ type: "conflict", regionId: region.id, step: target, playerIds: group.map((g) => g.player.id), costs });
        continue;
      }
      const { player } = group[0]!;
      const meter = meterOf(state, region.id, player.id);
      const from = meter.steps;
      for (let s = from + 1; s <= target; s++) meter.reached[s - 1] = paidStamp;
      meter.steps = target;
      events.push({ type: "moved", regionId: region.id, playerId: player.id, from, to: target, cost: costs[player.id]!, paidFrom: paid[player.id]! });
    }
    lockIfFull(pack, state, region.id, events);
  }

  // 3. Free pips from assigned members, after conflicts. They can never be part of a conflict.
  for (const player of state.players) {
    for (const m of player.members) {
      if (m.regionId === null || m.assignedTurn === null) continue;
      const since = turn - m.assignedTurn;
      if (since <= 0 || since % pack.rules.freePipEvery !== 0) continue;
      if (state.locked[m.regionId] !== undefined) continue;
      const meter = meterOf(state, m.regionId, player.id);
      if (meter.steps >= pack.rules.steps) continue;
      meter.steps += 1;
      meter.reached[meter.steps - 1] = freeStamp;
      events.push({ type: "free_pip", regionId: m.regionId, playerId: player.id, candidateId: m.candidateId, to: meter.steps });
      lockIfFull(pack, state, m.regionId, events);
    }
  }

  // 4. Contention and the end of the campaign.
  for (const r of pack.regions) {
    if (!contendedBefore.has(r.id) && inContention(pack, state, r.id)) events.push({ type: "contention", regionId: r.id });
  }
  if (state.phase === "final" || turn >= pack.rules.turnCap) {
    state.phase = "election";
    events.push({ type: "election" });
  } else if (allInContention(pack, state)) {
    state.phase = "final";
    events.push({ type: "final_turn" });
  }

  // 5. Groups that changed hands, then the next turn and its income (base money plus every group controlled now).
  events.push(...controlChanges(controlBefore, controllers(pack, state)));
  state.turn = turn + 1;
  if (state.phase === "campaign" || state.phase === "final") grantIncome(pack, state, events);
  return { state, events };
}

function lockIfFull(pack: MapPack, state: GameState, regionId: string, events: TurnEvent[]) {
  if (state.locked[regionId] !== undefined) return;
  const full = state.players.find((p) => meterOf(state, regionId, p.id).steps >= pack.rules.steps);
  if (full) {
    state.locked[regionId] = full.id;
    events.push({ type: "locked", regionId, playerId: full.id });
  }
}
