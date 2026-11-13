/**
 * Match state for the play screen: each human's plan for this turn (one in solo, several in pass and play),
 * submitting against the computer parties, the recap, the summary, election night and the results.
 * The whole match is autosaved after every change.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMatch,
  electionCalls,
  finishElection,
  headlinesForTurn,
  planAi,
  resolveTurn,
  summarizeTurn,
  validatePlan,
  type AiLevel,
  type ElectionCall,
  type ElectionResult,
  type GameState,
  type Headline,
  type Plan,
  type TurnEvent,
  type TurnSummary,
} from "@majority-map/core";
import { candidateName, groupName, money, news, pack, playerOf, scenarioGame, trackName, type Scenario } from "./model";
import { saveMatch, type SavedMatch } from "./saves";
import { defaultConfig, playersOf, type MatchConfig } from "./setup";
import { afterMatch, afterTurn, type Table } from "./achievements";
import { loadProfile, record } from "./profile";


/** Everything about the turn just played, for the recap, the summary and the ticker. */
export interface TurnReport {
  before: GameState;
  /** The board right after the turn resolved (before any election count). */
  after: GameState;
  events: TurnEvent[];
  summary: TurnSummary;
  headlines: Headline[];
}

/** "handoff" is the pass-and-play screen between players, which keeps each plan private. */
export type Stage = "planning" | "handoff" | "recap" | "summary" | "election" | "results";

/** The count after the final turn: every call in order, the result, and whether it was a tie. */
export interface ElectionNight {
  /** The board the votes were counted on. */
  state: GameState;
  calls: ElectionCall[];
  result: ElectionResult;
  tie: boolean;
  turn: number;
}

function makeHeadlines(state: GameState, summary: TurnSummary, you: string, rng: number, secondRound = false) {
  return headlinesForTurn(news, { summary, you, partyName: (id) => playerOf(state, id).party.name, regionName: trackName, groupName, candidateName, money, secondRound }, rng);
}

/** Opening headlines before anything has happened: campaign-world filler. */
function openingHeadlines(state: GameState, you: string): Headline[] {
  const empty: TurnSummary = { turn: 0, parties: [], changedRegions: [], newlyContended: [], finalTurnNext: false, electionNext: false };
  return makeHeadlines(state, empty, you, state.rng ^ 0x5bd1e995).headlines;
}

export interface GameStart {
  config?: MatchConfig;
  seed?: number;
  scenario?: Scenario;
  /** Resume a saved match instead of starting one. */
  save?: SavedMatch;
}

export interface GameApi {
  config: MatchConfig;
  state: GameState;
  /** The human whose turn view is on screen (the one planning, or the first human between turns). */
  viewer: string;
  humans: string[];
  /** True when one human plays: then the viewer is called "You". */
  solo: boolean;
  /** How to name a party on screen: "You" for the solo player, otherwise the party name. */
  label(id: string): string;
  levelOf(id: string): AiLevel | null;
  plan: Plan;
  issues: ReturnType<typeof validatePlan>;
  lastEvents: TurnEvent[];
  report: TurnReport | null;
  stage: Stage;
  ticker: Headline[];
  matchHeadline: Headline | null;
  result: ElectionResult | null;
  election: ElectionNight | null;
  boards: GameState[];
  summaries: TurnSummary[];
  secondRound: boolean;
  /** Difficulty of the computer parties, for the rematch picker (the first computer seat's level). */
  level: AiLevel;
  setTarget(trackId: string, target: number | null): void;
  setPick(candidateId: string | null): void;
  setAssign(candidateId: string, regionId: string | null): void;
  submit(): void;
  /** Pass and play: the next player has the device and is ready to plan. */
  ready(): void;
  endRecap(): void;
  endElection(): void;
  backToPlanning(): void;
  showSummary(): void;
  restart(level?: AiLevel): void;
}

function startState(start: GameStart, config: MatchConfig): GameState {
  if (start.scenario) return { ...scenarioGame(start.scenario), ...(config.luck ? { luck: true } : {}) };
  return createMatch(pack, { seed: start.seed ?? Date.now() % 1_000_000, players: playersOf(config), ...(config.luck ? { luck: true } : {}) });
}

export function useGame(start: GameStart): GameApi {
  const save = start.save;
  const [config, setConfig] = useState<MatchConfig>(() => save?.config ?? start.config ?? defaultConfig("solo"));
  const [state, setState] = useState<GameState>(() => save?.state ?? startState(start, config));
  const humans = useMemo(() => config.seats.filter((s) => s.kind === "human").map((s) => s.id), [config]);
  const [plans, setPlans] = useState<Record<string, Plan>>(() => save?.plans ?? {});
  const [submitted, setSubmitted] = useState<string[]>(() => save?.submitted ?? []);
  const [current, setCurrent] = useState<string>(() => save?.current ?? humans[0]!);
  // Test scenarios start on the final turn with a prepared board; the computer parties sit that one turn out.
  const [idleAi, setIdleAi] = useState(Boolean(start.scenario));
  const [lastEvents, setLastEvents] = useState<TurnEvent[]>([]);
  const [result, setResult] = useState<ElectionResult | null>(() => save?.result ?? null);
  const [secondRound, setSecondRound] = useState(() => save?.secondRound ?? false);
  const [report, setReport] = useState<TurnReport | null>(() => save?.report ?? null);
  // Pass and play opens on the hand-off screen, so even the first player's plan starts private.
  const [stage, setStage] = useState<Stage>(() => save?.stage ?? (config.seats.filter((x) => x.kind === "human").length > 1 ? "handoff" : "planning"));
  const [ticker, setTicker] = useState<Headline[]>(() => save?.ticker ?? openingHeadlines(state, humans[0]!));
  const [matchHeadline, setMatchHeadline] = useState<Headline | null>(() => save?.matchHeadline ?? null);
  const [election, setElection] = useState<ElectionNight | null>(() => save?.election ?? null);
  const [boards, setBoards] = useState<GameState[]>(() => save?.boards ?? [state]);
  const [summaries, setSummaries] = useState<TurnSummary[]>(() => save?.summaries ?? []);
  // Headlines have their own random stream, so the news never changes how the match plays.
  const [newsRng, setNewsRng] = useState(() => save?.newsRng ?? (state.rng ^ 0x27d4eb2d) >>> 0);

  const plan = plans[current] ?? {};
  const issues = useMemo(() => validatePlan(pack, state, current, plan), [state, current, plan]);
  const solo = humans.length === 1;
  const seatOf = useCallback((id: string) => config.seats.find((s) => s.id === id), [config]);
  const label = useCallback((id: string) => (solo && id === humans[0] ? "You" : playerOf(state, id).party.name), [solo, humans, state]);
  const levelOf = useCallback((id: string) => {
    const seat = seatOf(id);
    return seat && seat.kind === "ai" ? seat.level : null;
  }, [seatOf]);
  const level = config.seats.find((s) => s.kind === "ai")?.level ?? "normal";

  // Autosave after every change. Scenarios are test boards and are never saved.
  useEffect(() => {
    if (start.scenario) return;
    saveMatch({ config, state, plans, submitted, current, stage, report, election, result, secondRound, boards, summaries, ticker, matchHeadline, newsRng });
  }, [start.scenario, config, state, plans, submitted, current, stage, report, election, result, secondRound, boards, summaries, ticker, matchHeadline, newsRng]);

  const updatePlan = useCallback((fn: (p: Plan) => Plan) => setPlans((all) => ({ ...all, [current]: fn(all[current] ?? {}) })), [current]);

  const setTarget = useCallback((trackId: string, target: number | null) => {
    updatePlan((p) => {
      const steps = { ...(p.steps ?? {}) };
      if (target === null) delete steps[trackId];
      else steps[trackId] = target;
      return { ...p, steps };
    });
  }, [updatePlan]);

  const setPick = useCallback((candidateId: string | null) => {
    updatePlan((p) => {
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
  }, [updatePlan]);

  const setAssign = useCallback((candidateId: string, regionId: string | null) => {
    updatePlan((p) => {
      const assign = { ...(p.assign ?? {}) };
      if (regionId === null) delete assign[candidateId];
      else assign[candidateId] = regionId;
      return { ...p, assign };
    });
  }, [updatePlan]);

  const resolve = useCallback((humanPlans: Record<string, Plan>) => {
    let rng = state.rng;
    const all: Record<string, Plan> = { ...humanPlans };
    for (const p of state.players) {
      if (humans.includes(p.id)) continue;
      if (idleAi) {
        all[p.id] = {};
        continue;
      }
      const r = planAi(pack, state, p.id, levelOf(p.id) ?? "normal", rng);
      rng = r.rng;
      all[p.id] = r.plan;
    }
    const resolved = resolveTurn(pack, { ...state, rng }, all);
    const events = resolved.events;
    const summary = summarizeTurn(pack, state, resolved.state, events);
    let next = resolved.state;
    let tie = false;
    let finalResult: ElectionResult | null = null;
    setSecondRound(false);
    if (next.phase === "election") {
      const calls = electionCalls(pack, next);
      const done = finishElection(pack, next);
      setElection({ state: next, calls, result: done.result, tie: done.result.secondRound, turn: state.turn });
      next = done.state;
      tie = done.result.secondRound;
      if (!tie) {
        setResult(done.result);
        finalResult = done.result;
      }
    }
    // Stats and achievements, for real matches only (the scripted scenarios don't count).
    if (!start.scenario) {
      const table: Table = {
        pack,
        humans,
        ai: config.seats.filter((s) => s.kind === "ai").map((s) => s.level),
        passAndPlay: humans.length > 1,
        ownCandidate: humans.some((h) => pack.candidates.some((c) => c.id === playerOf(state, h).leaderId && "custom" in c)),
      };
      const turn = afterTurn(table, resolved.state, events, loadProfile().stats);
      let stats = turn.stats;
      const earned = [...turn.earned];
      if (finalResult) {
        const clashed = [...summaries, summary].some((s) => s.parties.some((p) => humans.includes(p.playerId) && p.conflicts.length > 0));
        const match = afterMatch(table, finalResult, stats, { clashed, secondRound: next.round > 1 });
        stats = match.stats;
        earned.push(...match.earned);
      }
      record(stats, earned);
    }
    setIdleAi(false);
    setBoards((b) => [...b, resolved.state]);
    setSummaries((x) => [...x, summary]);
    const made = makeHeadlines(next, summary, humans[0]!, newsRng, tie);
    setNewsRng(made.rng);
    setTicker(made.headlines);
    const top = made.headlines[0];
    setMatchHeadline((m) => (top && (!m || top.score > m.score) ? top : m));
    setReport({ before: state, after: resolved.state, events, summary, headlines: made.headlines });
    setStage("recap");
    setState(next);
    setPlans({});
    setSubmitted([]);
    setCurrent(humans[0]!);
    setLastEvents(events);
  }, [state, humans, idleAi, levelOf, newsRng, start.scenario, config, summaries]);

  const submit = useCallback(() => {
    if (validatePlan(pack, state, current, plan).length > 0) return;
    const done = [...submitted, current];
    const waiting = humans.filter((h) => !done.includes(h));
    if (waiting.length > 0) {
      // Pass and play: hand the device to the next player; nobody sees anyone else's plan.
      setSubmitted(done);
      setCurrent(waiting[0]!);
      setStage("handoff");
      return;
    }
    resolve(plans);
  }, [state, current, plan, submitted, humans, plans, resolve]);

  const ready = useCallback(() => setStage("planning"), []);
  const endRecap = useCallback(() => setStage("summary"), []);
  // After the summary of the final turn, election night comes before planning (or the results).
  const backToPlanning = useCallback(() => setStage(election ? "election" : humans.length > 1 ? "handoff" : "planning"), [election, humans]);
  const showSummary = useCallback(() => setStage((s) => (s === "planning" ? "summary" : s)), []);
  const endElection = useCallback(() => {
    if (!election) return;
    if (election.tie) {
      setSecondRound(true);
      setElection(null);
      setStage(humans.length > 1 ? "handoff" : "planning");
    } else setStage("results");
  }, [election, humans]);

  const restart = useCallback((next?: AiLevel) => {
    const nextConfig: MatchConfig = next ? { ...config, seats: config.seats.map((s) => (s.kind === "ai" ? { ...s, level: next } : s)) } : config;
    const fresh = createMatch(pack, { seed: Date.now() % 1_000_000, players: playersOf(nextConfig), ...(nextConfig.luck ? { luck: true } : {}) });
    setConfig(nextConfig);
    setState(fresh);
    setPlans({});
    setSubmitted([]);
    setCurrent(humans[0]!);
    setLastEvents([]);
    setResult(null);
    setSecondRound(false);
    setReport(null);
    setStage(humans.length > 1 ? "handoff" : "planning");
    setTicker(openingHeadlines(fresh, humans[0]!));
    setMatchHeadline(null);
    setElection(null);
    setBoards([fresh]);
    setSummaries([]);
    setIdleAi(false);
  }, [config, humans]);

  const viewer = stage === "planning" || stage === "handoff" ? current : humans[0]!;

  return {
    config,
    state,
    viewer,
    humans,
    solo,
    label,
    levelOf,
    plan,
    issues,
    lastEvents,
    report,
    stage,
    ticker,
    matchHeadline,
    result,
    election,
    boards,
    summaries,
    secondRound,
    level,
    setTarget,
    setPick,
    setAssign,
    submit,
    ready,
    endRecap,
    endElection,
    backToPlanning,
    showSummary,
    restart,
  };
}
