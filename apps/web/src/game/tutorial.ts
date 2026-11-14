/**
 * Learn to play: a real UK match against one Easy computer party, with a coach that teaches by doing. Each step says
 * what to do and points at where; it moves on by itself when the player does it (read from the match), or with Next
 * for steps that only explain. Progress is saved, so the tutorial survives a reload.
 */
import { pack } from "./model";
import { humanSeat, aiSeat, type MatchConfig, type Seat } from "./setup";
import type { Tab } from "./panels";
import type { GameApi } from "./useGame";

export interface CoachContext {
  game: GameApi;
  selected: string | null;
  tab: Tab;
}

export interface CoachStep {
  id: string;
  title: string;
  text: string;
  /** data-testid of what the step points at. */
  target?: string;
  /** The step is done once this holds; steps without it have a Next button. */
  done?: (c: CoachContext) => boolean;
}

const planned = (c: CoachContext) => Object.keys(c.game.plan.steps ?? {});
const isNational = (id: string) => pack.groups.some((g) => g.id === id && g.kind === "national");

export const TUTORIAL: CoachStep[] = [
  {
    id: "welcome",
    title: "Win the most seats",
    text: "Parliament has 650 seats and 326 is a majority. The bar at the top shows what each party would win if the election were today. You campaign region by region, and every party plans in secret at the same time.",
    target: "tally",
  },
  {
    id: "tap-region",
    title: "Pick a region",
    text: "Tap London on the map. You can also choose any region from Go to a region in the panel.",
    target: "board",
    done: (c) => c.selected !== null,
  },
  {
    id: "add-steps",
    title: "Campaign there",
    text: "Each region has a meter of 15 steps. Seats are shared out by how many steps each party has, so more steps means more seats. Press + to plan a step, and + again for a second: a first visit can be up to 2 steps.",
    target: "region-card",
    done: (c) => planned(c).length > 0,
  },
  {
    id: "spread",
    title: "Spread your money",
    text: "Each step costs 10% more than the one before, so a few steps in many regions go further than a pile in one. Add two more regions to your plan. Your plan and money are in the Plan tab.",
    target: "plan-list",
    done: (c) => planned(c).length >= 3,
  },
  {
    id: "submit",
    title: "Reveal your plan",
    text: "Press Submit turn. Everyone's plans are revealed together.",
    target: "submit",
    done: (c) => c.game.stage !== "planning",
  },
  {
    id: "recap",
    title: "What happened",
    text: "The recap shows each region that changed. If two parties aim for the same step in a region, that's a clash: both pay and neither moves. Watch it, or press Skip.",
    target: "recap",
    done: (c) => c.game.stage === "summary" || (c.game.stage === "planning" && c.game.state.turn > 1),
  },
  {
    id: "summary",
    title: "The turn in numbers",
    text: "The summary shows projected seats, the groups each party won, and your income for next turn. Press Continue.",
    target: "summary",
    done: (c) => c.game.stage === "planning" && c.game.state.turn > 1,
  },
  {
    id: "groups",
    title: "Groups pay income",
    text: "Open the Groups tab. Leading enough of a region group's regions wins it, and every group you hold pays you money each turn.",
    target: "tab-groups",
    done: (c) => c.tab === "groups",
  },
  {
    id: "national",
    title: "Voter groups",
    text: "Voter groups like Trade unions have their own meter. Lead one with at least 5 steps to win its income. Tap one and add a step or two to your plan.",
    target: "groups-panel",
    done: (c) => planned(c).some(isNational),
  },
  {
    id: "contention",
    title: "When the campaign ends",
    text: "A region is in contention once anyone has 5 steps there; this box counts them. When every region is in contention, one final turn follows, then the election.",
    target: "contention",
  },
  {
    id: "to-turn-5",
    title: "Play a few turns",
    text: "Keep planning and submitting. On turn 5 you can pick your first party member.",
    target: "submit",
    done: (c) => c.game.state.turn >= 5 && c.game.stage === "planning",
  },
  {
    id: "pick",
    title: "Pick a party member",
    text: "Open the Party tab and pick a member from any party. Their bonuses make some groups and regions cheaper for you.",
    target: "tab-party",
    done: (c) => Boolean(c.game.plan.pick),
  },
  {
    id: "assign",
    title: "Send them out",
    text: "Assign your new member to a region you've campaigned in. Every 3 turns they add a free step there.",
    target: "party-panel",
    done: (c) => Object.keys(c.game.plan.assign ?? {}).length > 0,
  },
  {
    id: "ready",
    title: "You're ready",
    text: "That's the game: plan in secret, win groups for money, push regions into contention, and take the most seats on election night. Play this match out, or start a new one from the menu.",
  },
];

/** You against one Easy computer party on the UK map. */
export function tutorialConfig(): MatchConfig {
  const seats: Seat[] = [];
  seats.push(humanSeat(seats, 1));
  seats.push(aiSeat(seats, 1, "easy"));
  return { mode: "solo", map: "uk", seats, tutorial: true };
}

const KEY = "mm.tutorial.v1";

interface Progress {
  step: number;
  done: boolean;
}

function read(): Progress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Progress | null;
    if (v && typeof v.step === "number") return v;
  } catch {
    // Private windows can refuse storage.
  }
  return { step: 0, done: false };
}

function write(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // The tutorial still runs; it just starts over next time.
  }
}

export const tutorialDone = () => read().done;
export const savedStep = () => Math.min(read().step, TUTORIAL.length - 1);
export const saveStep = (step: number) => write({ ...read(), step });
/** Finishing or skipping both count: the menu stops suggesting it. The next run starts from the beginning. */
export const finishTutorial = () => write({ step: 0, done: true });
export const restartTutorial = () => write({ ...read(), step: 0 });
