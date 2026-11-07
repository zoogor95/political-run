/** Match state for the play screen: your plan for this turn, submitting it against the AI, and the election. */
import { useCallback, useMemo, useState } from "react";
import {
  finishElection,
  headlinesForTurn,
  planAi,
  resolveTurn,
  summarizeTurn,
  validatePlan,
  type AiLevel,
  type ElectionResult,
  type GameState,
  type Headline,
  type NewsTemplates,
  type Plan,
  type TurnEvent,
  type TurnSummary,
} from "@majority-map/core";
import ukNews from "@majority-map/content/news/uk.json";
import { candidateName, groupName, money, newGame, pack, playerOf, trackName, YOU } from "./model";

const news = ukNews as NewsTemplates;

/** Everything about the turn just played, for the recap, the summary and the ticker. */
export interface TurnReport {
  before: GameState;
  /** The board right after the turn resolved (before any election count). */
  after: GameState;
  events: TurnEvent[];
  summary: TurnSummary;
  headlines: Headline[];
}

export type Stage = "planning" | "recap" | "summary";

function makeHeadlines(state: GameState, summary: TurnSummary, rng: number, secondRound = false) {
  return headlinesForTurn(news, {
    summary,
    you: YOU,
    partyName: (id) => playerOf(state, id).party.name,
    regionName: trackName,
    groupName,
    candidateName,
    money,
    secondRound,
  }, rng);
}

/** Opening headlines before anything has happened: campaign-world filler. */
function openingHeadlines(state: GameState): Headline[] {
  const empty: TurnSummary = { turn: 0, parties: [], changedRegions: [], newlyContended: [], finalTurnNext: false, electionNext: false };
  return makeHeadlines(state, empty, state.rng ^ 0x5bd1e995).headlines;
}

export interface GameApi {
  state: GameState;
  plan: Plan;
  issues: ReturnType<typeof validatePlan>;
  lastEvents: TurnEvent[];
  report: TurnReport | null;
  stage: Stage;
  /** Headlines on the ticker right now. */
  ticker: Headline[];
  /** The most newsworthy headline of the match so far. */
  matchHeadline: Headline | null;
  result: ElectionResult | null;
  endRecap(): void;
  backToPlanning(): void;
  showSummary(): void;
  secondRound: boolean;
  setTarget(trackId: string, target: number | null): void;
  setPick(candidateId: string | null): void;
  setAssign(candidateId: string, regionId: string | null): void;
  submit(): void;
  /** Difficulty of the computer parties in this match. */
  level: AiLevel;
  restart(level?: AiLevel): void;
}

export function useGame(seed?: number, initialLevel: AiLevel = "normal"): GameApi {
  const [level, setLevel] = useState<AiLevel>(initialLevel);
  const [state, setState] = useState<GameState>(() => newGame(seed));
  const [plan, setPlan] = useState<Plan>({});
  const [lastEvents, setLastEvents] = useState<TurnEvent[]>([]);
  const [result, setResult] = useState<ElectionResult | null>(null);
  const [secondRound, setSecondRound] = useState(false);
  const [report, setReport] = useState<TurnReport | null>(null);
  const [stage, setStage] = useState<Stage>("planning");
  const [ticker, setTicker] = useState<Headline[]>(() => openingHeadlines(state));
  const [matchHeadline, setMatchHeadline] = useState<Headline | null>(null);
  // Headlines have their own random stream, so the news never changes how the match plays.
  const [newsRng, setNewsRng] = useState(() => (state.rng ^ 0x27d4eb2d) >>> 0);

  const issues = useMemo(() => validatePlan(pack, state, YOU, plan), [state, plan]);

  const setTarget = useCallback((trackId: string, target: number | null) => {
    setPlan((p) => {
      const steps = { ...(p.steps ?? {}) };
      if (target === null) delete steps[trackId];
      else steps[trackId] = target;
      return { ...p, steps };
    });
  }, []);

  const setPick = useCallback((candidateId: string | null) => {
    setPlan((p) => {
      const next: Plan = { ...p };
      // Changing or clearing the pick also drops the old pick's assignment.
      if (p.pick && p.pick !== candidateId && next.assign) {
        const rest = { ...next.assign };
        delete rest[p.pick];
        next.assign = rest;
      }
      if (candidateId === null) delete next.pick;
      else next.pick = candidateId;
      return next;
    });
  }, []);

  const setAssign = useCallback((candidateId: string, regionId: string | null) => {
    setPlan((p) => {
      const assign = { ...(p.assign ?? {}) };
      if (regionId === null) delete assign[candidateId];
      else assign[candidateId] = regionId;
      return { ...p, assign };
    });
  }, []);

  const submit = useCallback(() => {
    if (validatePlan(pack, state, YOU, plan).length > 0) return;
    let rng = state.rng;
    const plans: Record<string, Plan> = { [YOU]: plan };
    for (const p of state.players) {
      if (p.id === YOU) continue;
      const r = planAi(pack, state, p.id, level, rng);
      rng = r.rng;
      plans[p.id] = r.plan;
    }
    const resolved = resolveTurn(pack, { ...state, rng }, plans);
    const events = resolved.events;
    const summary = summarizeTurn(pack, state, resolved.state, events);
    let next = resolved.state;
    let tie = false;
    setSecondRound(false);
    if (next.phase === "election") {
      const done = finishElection(pack, next);
      next = done.state;
      tie = done.result.secondRound;
      if (tie) setSecondRound(true);
      else setResult(done.result);
    }
    const made = makeHeadlines(next, summary, newsRng, tie);
    setNewsRng(made.rng);
    setTicker(made.headlines);
    const top = made.headlines[0];
    setMatchHeadline((m) => (top && (!m || top.score > m.score) ? top : m));
    setReport({ before: state, after: resolved.state, events, summary, headlines: made.headlines });
    setStage("recap");
    setState(next);
    setPlan({});
    setLastEvents(events);
  }, [state, plan, level, newsRng]);

  const endRecap = useCallback(() => setStage("summary"), []);
  const backToPlanning = useCallback(() => setStage("planning"), []);
  const showSummary = useCallback(() => setStage((s) => (s === "planning" ? "summary" : s)), []);

  const restart = useCallback((next?: AiLevel) => {
    if (next) setLevel(next);
    const fresh = newGame();
    setState(fresh);
    setTicker(openingHeadlines(fresh));
    setPlan({});
    setLastEvents([]);
    setResult(null);
    setSecondRound(false);
    setReport(null);
    setStage("planning");
    setMatchHeadline(null);
  }, []);

  return {
    state,
    plan,
    issues,
    lastEvents,
    report,
    stage,
    ticker,
    matchHeadline,
    result,
    secondRound,
    level,
    setTarget,
    setPick,
    setAssign,
    submit,
    restart,
    endRecap,
    backToPlanning,
    showSummary,
  };
}
