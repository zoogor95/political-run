import type { GameType, MapPack, RulesConfig } from "./types.js";

export const PARLIAMENTARY_RULES: RulesConfig = {
  steps: 15,
  contentionAt: 3,
  firstEntryMax: 2,
  costGrowth: 1.1,
  costClampMin: 0.5,
  costClampMax: 1.5,
  baseIncome: 250_000,
  memberPickEvery: 5,
  memberSharePct: 20,
  freePipEvery: 3,
  secondRoundPipLoss: 5,
  turnCap: 40,
};

export const PRESIDENTIAL_RULES: RulesConfig = {
  ...PARLIAMENTARY_RULES,
  steps: 10,
  costGrowth: 1,
  memberPickEvery: 0,
  runningMateTurn: 5,
};

export function defaultRules(gameType: GameType): RulesConfig {
  return gameType === "parliamentary" ? PARLIAMENTARY_RULES : PRESIDENTIAL_RULES;
}

export interface PackIssue {
  path: string;
  message: string;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Checks a map pack for mistakes that would break a match. Returns every issue found; an empty list means the pack is valid. */
export function validatePack(pack: MapPack): PackIssue[] {
  const issues: PackIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!ID.test(pack.id)) add("id", "must be lowercase letters, digits and hyphens");
  if (!pack.name) add("name", "is required");
  if (pack.gameType !== "parliamentary" && pack.gameType !== "presidential") add("gameType", "must be parliamentary or presidential");
  if (!pack.currency) add("currency", "is required");

  const r = pack.rules;
  const positiveInt = (key: keyof RulesConfig) => {
    const v = r[key] ?? 0;
    if (!Number.isInteger(v) || v < 1) add(`rules.${key}`, "must be a whole number of at least 1");
  };
  (["steps", "contentionAt", "firstEntryMax", "baseIncome", "freePipEvery", "turnCap"] as const).forEach(positiveInt);
  if (r.contentionAt > r.steps) add("rules.contentionAt", "can't be more than the number of steps");
  if (r.moneyStep !== undefined && (!Number.isInteger(r.moneyStep) || r.moneyStep < 1)) add("rules.moneyStep", "must be a whole number of at least 1");
  const step = r.moneyStep ?? 1000;
  const wholeSteps = (v: number | undefined) => v === undefined || v % step === 0;
  if (!wholeSteps(r.baseIncome)) add("rules.baseIncome", `must be a whole number of ${step}`);
  if (r.firstEntryMax >= r.contentionAt) add("rules.firstEntryMax", "must be below contentionAt, so no region reaches contention in one turn");
  if (!(r.costGrowth >= 1)) add("rules.costGrowth", "must be at least 1");
  if (!(r.costClampMin > 0 && r.costClampMin <= 1 && r.costClampMax >= 1)) add("rules.costClamp", "min must be in (0, 1] and max at least 1");
  if (!Number.isInteger(r.memberPickEvery) || r.memberPickEvery < 0) add("rules.memberPickEvery", "must be a whole number, 0 for none");
  if (!(r.memberSharePct >= 0 && r.memberSharePct <= 100)) add("rules.memberSharePct", "must be between 0 and 100");
  if (!Number.isInteger(r.secondRoundPipLoss) || r.secondRoundPipLoss < 0) add("rules.secondRoundPipLoss", "must be a whole number");

  const regionIds = new Set<string>();
  pack.regions.forEach((reg, i) => {
    const p = `regions[${i}]`;
    if (!ID.test(reg.id)) add(`${p}.id`, "must be lowercase letters, digits and hyphens");
    if (regionIds.has(reg.id)) add(`${p}.id`, `duplicate region id "${reg.id}"`);
    regionIds.add(reg.id);
    if (!reg.name) add(`${p}.name`, "is required");
    if (!Number.isInteger(reg.seats) || reg.seats < 1) add(`${p}.seats`, "must be a whole number of at least 1");
    if (!Number.isInteger(reg.baseCost) || reg.baseCost < 1) add(`${p}.baseCost`, "must be a whole number of at least 1");
    else if (!wholeSteps(reg.baseCost)) add(`${p}.baseCost`, `must be a whole number of ${step}`);
    if (reg.voters !== undefined && (!Number.isInteger(reg.voters) || reg.voters < 1)) add(`${p}.voters`, "must be a whole number of at least 1");
  });
  if (pack.regions.length < 2) add("regions", "needs at least 2 regions");

  const groupIds = new Set<string>();
  pack.groups.forEach((g, i) => {
    const p = `groups[${i}]`;
    if (!ID.test(g.id)) add(`${p}.id`, "must be lowercase letters, digits and hyphens");
    if (groupIds.has(g.id) || regionIds.has(g.id)) add(`${p}.id`, `duplicate id "${g.id}"`);
    groupIds.add(g.id);
    if (!g.name) add(`${p}.name`, "is required");
    if (!Number.isInteger(g.income) || g.income < 0) add(`${p}.income`, "must be a whole number");
    else if (!wholeSteps(g.income)) add(`${p}.income`, `must be a whole number of ${step}`);
    if (g.baseCost !== undefined && !wholeSteps(g.baseCost)) add(`${p}.baseCost`, `must be a whole number of ${step}`);
    if (g.kind === "national" && (!Number.isInteger(g.baseCost) || (g.baseCost ?? 0) < 1)) add(`${p}.baseCost`, "a national group needs a whole-number step cost of at least 1");
    if (g.kind === "state" && g.baseCost !== undefined) add(`${p}.baseCost`, "only national groups have their own step cost");
    if (g.kind === "state") {
      if (g.regions.length === 0) add(`${p}.regions`, "a state group needs at least one region");
      g.regions.forEach((rid) => {
        if (!regionIds.has(rid)) add(`${p}.regions`, `unknown region "${rid}"`);
      });
      if (new Set(g.regions).size !== g.regions.length) add(`${p}.regions`, "lists a region twice");
    } else if (g.kind === "national") {
      if (g.regions.length > 0) add(`${p}.regions`, "a national group has no regions");
    } else {
      add(`${p}.kind`, "must be state or national");
    }
  });

  const candidateIds = new Set<string>();
  pack.candidates.forEach((c, i) => {
    const p = `candidates[${i}]`;
    if (!ID.test(c.id)) add(`${p}.id`, "must be lowercase letters, digits and hyphens");
    if (candidateIds.has(c.id)) add(`${p}.id`, `duplicate candidate id "${c.id}"`);
    candidateIds.add(c.id);
    if (!c.name) add(`${p}.name`, "is required");
    if (!c.affiliation) add(`${p}.affiliation`, "is required");
    for (const [gid, pct] of Object.entries(c.modifiers)) {
      if (!groupIds.has(gid)) add(`${p}.modifiers.${gid}`, "unknown group");
      if (!Number.isFinite(pct) || pct < -50 || pct > 50 || pct === 0) add(`${p}.modifiers.${gid}`, "must be a non-zero percent between -50 and 50");
    }
    for (const gid of Object.keys(c.notes ?? {})) {
      if (!(gid in c.modifiers)) add(`${p}.notes.${gid}`, "note for a modifier the candidate doesn't have");
    }
  });
  if (pack.candidates.length < 2) add("candidates", "needs at least 2 candidates");

  if (pack.callOrder) {
    const order = new Set(pack.callOrder);
    if (order.size !== pack.callOrder.length || order.size !== regionIds.size || [...order].some((id) => !regionIds.has(id))) {
      add("callOrder", "must list every region exactly once");
    }
  }

  const reservedIds = new Set<string>();
  (pack.reservedSeats ?? []).forEach((d, i) => {
    const p = `reservedSeats[${i}]`;
    if (!ID.test(d.id)) add(`${p}.id`, "must be lowercase letters, digits and hyphens");
    if (reservedIds.has(d.id) || regionIds.has(d.id) || groupIds.has(d.id)) add(`${p}.id`, `duplicate id "${d.id}"`);
    reservedIds.add(d.id);
    if (!d.name) add(`${p}.name`, "is required");
    if (!Number.isInteger(d.seats) || d.seats < 1) add(`${p}.seats`, "must be a whole number of at least 1");
    if (d.group !== undefined && pack.groups.find((g) => g.id === d.group)?.kind !== "state") add(`${p}.group`, `must be a state group, not "${d.group}"`);
  });

  for (const level of ["normal", "hard"] as const) {
    const noise = pack.aiTuning?.[level]?.noise;
    if (noise !== undefined && !(noise >= 0 && noise <= 1)) add(`aiTuning.${level}.noise`, "must be between 0 and 1");
  }

  if (pack.customBudget !== undefined && (!Number.isInteger(pack.customBudget) || pack.customBudget < 1)) add("customBudget", "must be a whole number of at least 1");

  if (pack.aiPartyNames.length < 4) add("aiPartyNames", "needs at least 4 names, one per AI seat");
  if (new Set(pack.aiPartyNames.map((n) => n.toLowerCase())).size !== pack.aiPartyNames.length) add("aiPartyNames", "lists a name twice");

  return issues;
}
