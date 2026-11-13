/** Map pack data: everything that differs between countries and game types. */

export type GameType = "parliamentary" | "presidential";

export interface RulesConfig {
  /** Steps on each region meter: 15 in Parliamentary, 10 in Presidential. */
  steps: number;
  /** A region is in contention once any player has at least this many steps. */
  contentionAt: number;
  /** Most steps allowed on a player's first investment in a region. */
  firstEntryMax: number;
  /** Each step costs this many times the previous one (1.1 in Parliamentary, 1 in Presidential). */
  costGrowth: number;
  /** Modifiers move step costs to this range of the base cost, as fractions (0.5 to 1.5). */
  costClampMin: number;
  costClampMax: number;
  /** Base money given every turn, including turn 1. */
  baseIncome: number;
  /** A party member pick on every Nth turn (Parliamentary). 0 turns picks off. */
  memberPickEvery: number;
  /** Share of a member's modifiers that counts, in percent. */
  memberSharePct: number;
  /** An assigned member adds a free pip every Nth turn after assignment. */
  freePipEvery: number;
  /** Pips every player loses in every region when a second round starts. */
  secondRoundPipLoss: number;
  /** Safety cap: the campaign goes to the election after this turn even if not every region is in contention. */
  turnCap: number;
  /** Every cost and income is rounded to a whole number of this (1,000: £1K, Rs 1K). Absent: 1,000. */
  moneyStep?: number;
}

export interface RegionDef {
  id: string;
  name: string;
  /** Seats (Parliamentary) or electoral votes (Presidential). */
  seats: number;
  /** Campaign cost of the first step, in whole currency units. */
  baseCost: number;
  /** Registered voters, for the popular vote shown on election night. Optional; it never affects the result. */
  voters?: number;
}

export interface GroupDef {
  id: string;
  name: string;
  /** State groups are sets of regions; national groups are nationwide meters. */
  kind: "state" | "national";
  /** Regions in a state group. Empty for national groups. */
  regions: string[];
  /** Income per turn for the player who controls the group, in whole currency units. */
  income: number;
  /** National groups only: cost of the first step on the group's own meter. */
  baseCost?: number;
}

/**
 * Seats filled after the count rather than won in a region, shared out by general seats won (Pakistan's seats reserved
 * for women, per province, and for non-Muslims, nationwide). Largest remainder; a party with no general seats in the
 * scope gets none.
 */
export interface ReservedSeatsDef {
  id: string;
  name: string;
  seats: number;
  /** A state group: shared by general seats won in that group's regions. Absent: by general seats won everywhere. */
  group?: string;
}

export interface CandidateDef {
  id: string;
  name: string;
  /** Real party shown as the candidate's affiliation; never a competitor on the board. */
  affiliation: string;
  /** Bonuses (positive) and penalties (negative) in percent, keyed by group id. */
  modifiers: Record<string, number>;
  /** Short reason for each modifier, shown on the candidate card. */
  notes?: Record<string, string>;
}

export interface MapPack {
  id: string;
  name: string;
  gameType: GameType;
  /** Currency symbol shown in the UI, for example "£". */
  currency: string;
  rules: RulesConfig;
  regions: RegionDef[];
  groups: GroupDef[];
  candidates: CandidateDef[];
  /** Comical made-up party names for AI players. Never a parody of a real party, religion or community. */
  aiPartyNames: string[];
  /** Order regions are called on election night (every region once). Defaults to map order. */
  callOrder?: string[];
  /** Reserved seats, declared after every region on election night. */
  reservedSeats?: ReservedSeatsDef[];
  /** Points a custom candidate's bonuses may cost on this map (see custom.ts). */
  customBudget?: number;
}

/** Match state. Plain JSON so it can be saved, sent over the network and replayed. */

export interface PartyIdentity {
  name: string;
  color: string;
  emblem: string;
}

export interface PlayerSetup {
  id: string;
  leaderId: string;
  party: PartyIdentity;
}

export interface Member {
  candidateId: string;
  /** Region the member works in, or null while waiting to be assigned. */
  regionId: string | null;
  /** Turn the member was assigned on; free pips count from here. */
  assignedTurn: number | null;
}

export interface PlayerState {
  id: string;
  leaderId: string;
  party: PartyIdentity;
  members: Member[];
  /** Base money: spendable anywhere. */
  money: number;
  /** Group money by group id. State group money is spendable only in that group's regions; national group money anywhere. */
  wallets: Record<string, number>;
  /** Total money spent so far, including money lost in conflicts. Used for tiebreaks. */
  spent: number;
}

/**
 * A moment in the match, used to decide who reached a step first.
 * Paid moves land at turn * 2, free pips at turn * 2 + 1, so free pips always come after paid moves of the same turn.
 */
export type Stamp = number;

export interface Meter {
  steps: number;
  /** reached[i] is when this player reached step i + 1. */
  reached: Stamp[];
  /** True once the player has invested here, including a first entry lost to a conflict. */
  entered: boolean;
}

export type Phase = "campaign" | "final" | "election" | "finished";

export interface GameState {
  packId: string;
  turn: number;
  /** 1 for the first campaign, 2 or more after a tie for most seats. */
  round: number;
  phase: Phase;
  players: PlayerState[];
  /** meters[trackId][playerId]. A track is a region or a national group, which has its own meter. */
  meters: Record<string, Record<string, Meter>>;
  /** Player who filled the track's meter, or absent while open. */
  locked: Record<string, string>;
  /** Seeded random state, for AI and anything else that needs randomness. */
  rng: number;
  /** The match's seed, which never changes (absent in saves from before it was kept). */
  seed?: number;
  /**
   * Luck factor: at the count every seat is drawn at random instead of shared out by pip share. A party's chance of each
   * seat in a region is 2 x its pips - the fewest pips any party there has (see luckWeights).
   */
  luck?: boolean;
}

/** What a player submits for one turn. */
export interface Plan {
  /** Target step per region or national group (the step the player wants to reach, not how many to add). */
  steps?: Record<string, number>;
  /** Candidate picked as a new party member on a pick turn. */
  pick?: string;
  /** Member candidate id to region id. */
  assign?: Record<string, string>;
}

export type TurnEvent =
  | { type: "moved"; regionId: string; playerId: string; from: number; to: number; cost: number; paidFrom: Record<string, number> }
  | { type: "conflict"; regionId: string; step: number; playerIds: string[]; costs: Record<string, number> }
  | { type: "income"; playerId: string; base: number; groups: Record<string, number> }
  | { type: "control_gained"; groupId: string; playerId: string }
  | { type: "control_lost"; groupId: string; playerId: string }
  | { type: "picked"; playerId: string; candidateId: string }
  | { type: "assigned"; playerId: string; candidateId: string; regionId: string }
  | { type: "free_pip"; regionId: string; playerId: string; candidateId: string; to: number }
  | { type: "locked"; regionId: string; playerId: string }
  | { type: "contention"; regionId: string }
  | { type: "final_turn" }
  | { type: "election" };
