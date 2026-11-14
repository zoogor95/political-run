/**
 * Autosave: the whole match is saved in this browser after every change, so it can be closed and resumed on
 * another day. One slot; starting a new match replaces it. Every storage call is guarded, because private
 * windows and full storage can refuse.
 */
import type { ElectionResult, GameState, Headline, Plan, TurnSummary } from "@majority-map/core";
import type { MatchConfig } from "./setup";
import type { ElectionNight, Stage, TurnReport } from "./useGame";

const KEY = "mm.save.v1";
export const SAVE_VERSION = 1;

export interface SavedMatch {
  version: number;
  savedAt: number;
  config: MatchConfig;
  state: GameState;
  plans: Record<string, Plan>;
  /** Humans who have already submitted this turn (pass and play). */
  submitted: string[];
  current: string;
  stage: Stage;
  report: TurnReport | null;
  election: ElectionNight | null;
  result: ElectionResult | null;
  secondRound: boolean;
  /** Presidential: the candidate eliminated at the last count, while the campaign goes on (absent in older saves). */
  eliminated?: string | null;
  boards: GameState[];
  summaries: TurnSummary[];
  ticker: Headline[];
  matchHeadline: Headline | null;
  newsRng: number;
}

export function saveMatch(match: Omit<SavedMatch, "version" | "savedAt">): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...match, version: SAVE_VERSION, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as SavedMatch;
    return save.version === SAVE_VERSION && save.state && save.config ? save : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
