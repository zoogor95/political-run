/**
 * Match state for the play screen: each human's plan for this turn (one in solo, several in pass and play),
 * submitting against the computer parties, the recap, the summary, election night and the results.
 * The whole match is autosaved after every change.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createMatch,
  electionCalls,
  headlinesForTurn,
  planComputers,
  playOut as playOutMatch,
  playTurn,
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
import { nudge } from "./notify";
import { configOf, type MatchLink, type RoomView, type TurnLog } from "./online";


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
  /** Presidential: the campaign goes on after this count (someone was eliminated and no one has won yet). */
  continues?: boolean;
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
  /** A private online match: the live link and the server's view when the play screen opened. */
  online?: { link: MatchLink; view: RoomView };
}

/** Online: where this device stands in the turn. */
export interface OnlineInfo {
  /** This turn's plan has gone to the server. */
  sent: boolean;
  /** People still to send a plan this turn. */
  waitingFor: string[];
  /** This device's candidate is out of the race (Presidential): watching the rest. */
  spectating: boolean;
  connected: boolean;
  error: string | null;
  /** When this turn's plans are due, on this device's clock (with a turn timer). */
  deadline: number | null;
  /** Seats the computer is playing for after missed turns. */
  autopilot: string[];
  /** Turns missed in a row, by seat. */
  missed: Record<string, number>;
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
  /** Presidential: the candidate eliminated at the last count, while the campaign goes on. */
  eliminated: string | null;
  /** Difficulty of the computer parties, for the rematch picker (the first computer seat's level). */
  level: AiLevel;
  /** Online matches only. */
  online: OnlineInfo | null;
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

const levelsOf = (config: MatchConfig) => Object.fromEntries(config.seats.filter((s) => s.kind === "ai").map((s) => [s.id, s.level])) as Record<string, AiLevel>;

export function useGame(start: GameStart): GameApi {
  const save = start.save;
  const online = start.online;
  const [config, setConfig] = useState<MatchConfig>(() => (online ? configOf(online.view) : (save?.config ?? start.config ?? defaultConfig("solo"))));
  const [state, setState] = useState<GameState>(() => online?.view.state ?? save?.state ?? startState(start, config));
  // Online, this device plays one seat; the other people are like computer parties whose plans come from the server.
  const humans = useMemo(() => (online ? [online.view.you!] : config.seats.filter((s) => s.kind === "human").map((s) => s.id)), [config, online]);
  const onlineHumans = useMemo(() => config.seats.filter((s) => s.kind === "human").map((s) => s.id), [config]);
  const [plans, setPlans] = useState<Record<string, Plan>>(() => (online?.view.yourPlan ? { [online.view.you!]: online.view.yourPlan } : (save?.plans ?? {})));
  const [submitted, setSubmitted] = useState<string[]>(() => (online?.view.yourPlan ? [online.view.you!] : (save?.submitted ?? [])));
  const [current, setCurrent] = useState<string>(() => save?.current ?? humans[0]!);
  // Test scenarios start on the final turn with a prepared board; the computer parties sit that one turn out.
  const [idleAi, setIdleAi] = useState(Boolean(start.scenario));
  const [lastEvents, setLastEvents] = useState<TurnEvent[]>([]);
  const [result, setResult] = useState<ElectionResult | null>(() => online?.view.result ?? save?.result ?? null);
  const [secondRound, setSecondRound] = useState(() => save?.secondRound ?? false);
  // Presidential: the candidate eliminated at the last count, shown while the campaign goes on.
  const [eliminated, setEliminated] = useState<string | null>(() => save?.eliminated ?? null);
  const [report, setReport] = useState<TurnReport | null>(() => save?.report ?? null);
  // Pass and play opens on the hand-off screen, so even the first player's plan starts private.
  const [stage, setStage] = useState<Stage>(() => (online ? (online.view.result ? "results" : "planning") : (save?.stage ?? (config.seats.filter((x) => x.kind === "human").length > 1 ? "handoff" : "planning"))));
  const [ticker, setTicker] = useState<Headline[]>(() => save?.ticker ?? openingHeadlines(state, humans[0]!));
  const [matchHeadline, setMatchHeadline] = useState<Headline | null>(() => save?.matchHeadline ?? null);
  const [election, setElection] = useState<ElectionNight | null>(() => {
    // Opening a finished online match: straight to the results, counted on the final board.
    if (online?.view.result && online.view.state) {
      const s = online.view.state;
      return { state: s, calls: electionCalls(pack, s), result: online.view.result, tie: false, turn: s.turn };
    }
    return save?.election ?? null;
  });
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

  // Autosave after every change. Scenarios are test boards and are never saved; online matches live on the server.
  useEffect(() => {
    if (start.scenario || online) return;
    saveMatch({ config, state, plans, submitted, current, stage, report, election, result, secondRound, eliminated, boards, summaries, ticker, matchHeadline, newsRng });
  }, [start.scenario, online, config, state, plans, submitted, current, stage, report, election, result, secondRound, eliminated, boards, summaries, ticker, matchHeadline, newsRng]);

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

  /**
   * Plays a turn from the people's plans. On this device the computers plan here; online, `given` carries every plan
   * and the random stream from the server, so the turn plays exactly as it did there.
   */
  const resolve = useCallback((humanPlans: Record<string, Plan>, given?: { plans: Record<string, Plan>; rng: number }) => {
    let all: Record<string, Plan>;
    let rng: number;
    if (given) {
      all = given.plans;
      rng = given.rng;
    } else if (idleAi) {
      all = { ...Object.fromEntries(state.players.filter((p) => !humans.includes(p.id)).map((p) => [p.id, {}])), ...humanPlans };
      rng = state.rng;
    } else {
      const ai = planComputers(pack, state, levelsOf(config));
      all = { ...ai.plans, ...humanPlans };
      rng = ai.rng;
    }
    const played = playTurn(pack, state, all, rng);
    const resolved = { state: played.resolved, events: played.events };
    const events = resolved.events;
    const summary = summarizeTurn(pack, state, resolved.state, events);
    const next = played.next;
    let tie = false;
    let finalResult: ElectionResult | null = null;
    setSecondRound(false);
    setEliminated(null);
    if (played.election) {
      const done = played.election;
      const calls = electionCalls(pack, done.atCount);
      const continues = !done.result.secondRound && next.phase !== "finished";
      setElection({ state: done.atCount, calls, result: done.result, tie: done.result.secondRound, continues, turn: state.turn });
      tie = done.result.secondRound || continues;
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
        const match = afterMatch(table, finalResult, stats, { clashed, secondRound: pack.gameType === "parliamentary" && next.round > 1 });
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
    setCurrent(humans.find((h) => playerOf(next, h).eliminated === undefined) ?? humans[0]!);
    setLastEvents(events);
  }, [state, humans, idleAi, newsRng, start.scenario, config, summaries]);

  // Online: the turns the server has resolved, applied one at a time when this device is ready for them.
  const [queue, setQueue] = useState<TurnLog[]>([]);
  const applied = useRef(online?.view.turnsPlayed ?? 0);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!online) return;
    const offTurn = online.link.onTurn((t) => {
      setQueue((q) => [...q, t]);
      nudge(`Turn ${t.turn} is in. Your move!`);
    });
    const offView = online.link.subscribe(bump);
    return () => {
      offTurn();
      offView();
    };
  }, [online]);
  const me = online?.view.you ?? null;
  const spectating = Boolean(me && playerOf(state, me).eliminated !== undefined && state.phase !== "finished");
  useEffect(() => {
    if (!online || queue.length === 0 || stage !== "planning") return;
    const t = queue[0]!;
    setQueue((q) => q.slice(1));
    if (t.index < applied.current) return; // already on the board (sent again after a reconnect)
    if (t.index > applied.current) {
      // A turn went missing (this device was away): jump to the server's board.
      const v = online.link.view;
      if (v?.state) {
        applied.current = v.turnsPlayed;
        setState(v.state);
        setBoards((b) => [...b, v.state!]);
        setPlans({});
        setSubmitted([]);
        if (v.result) setResult(v.result);
      }
      return;
    }
    applied.current = t.index + 1;
    resolve(me ? { [me]: t.plans[me] ?? {} } : {}, { plans: t.plans, rng: t.rng });
  }, [online, queue, stage, resolve, me]);
  // Back from a dropped connection with turns missed and none on the way: catch up with the server's board.
  const view = online?.link.view;
  useEffect(() => {
    if (!online || !view?.state || stage !== "planning" || queue.length > 0) return;
    if (view.turnsPlayed > applied.current) {
      applied.current = view.turnsPlayed;
      setState(view.state);
      setBoards((b) => [...b, view.state!]);
      setPlans({});
      setSubmitted([]);
      if (view.result) setResult(view.result);
    }
  }, [online, view, stage, queue.length]);

  const submit = useCallback(() => {
    if (validatePlan(pack, state, current, plan).length > 0) return;
    if (online) {
      if (online.link.submit(state.turn, plan)) setSubmitted([current]);
      return;
    }
    const done = [...submitted, current];
    // Eliminated candidates (Presidential) don't plan any more.
    const waiting = humans.filter((h) => !done.includes(h) && playerOf(state, h).eliminated === undefined);
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
  // Only from the recap: a recap timer firing after the player already skipped ahead must not reopen the summary.
  const endRecap = useCallback(() => setStage((s) => (s === "recap" ? "summary" : s)), []);
  // After the summary of the final turn, election night comes before planning (or the results).
  const backToPlanning = useCallback(() => setStage(election ? "election" : humans.length > 1 ? "handoff" : "planning"), [election, humans]);
  const showSummary = useCallback(() => setStage((s) => (s === "planning" ? "summary" : s)), []);
  const endElection = useCallback(() => {
    if (!election) return;
    if (election.tie) {
      setSecondRound(true);
      setElection(null);
      setStage(humans.length > 1 ? "handoff" : "planning");
      return;
    }
    if (!election.continues) {
      setStage("results");
      return;
    }
    // Presidential, no majority: the campaign goes on without the eliminated candidate.
    const out = election.result.eliminated;
    // Online, anyone still in the race keeps the campaign going (this device watches if its candidate is out).
    const left = (online ? onlineHumans : humans).filter((h) => playerOf(state, h).eliminated === undefined);
    if (left.length > 0) {
      setEliminated(out);
      setElection(null);
      setCurrent(online ? me! : left[0]!);
      setStage(left.length > 1 ? "handoff" : "planning");
      return;
    }
    // Every human is out of the race: the computer candidates play it to the end, and the deciding count is shown.
    const played = playOutMatch(pack, state, levelOf);
    if (!start.scenario) {
      const table: Table = {
        pack,
        humans,
        ai: config.seats.filter((x) => x.kind === "ai").map((x) => x.level),
        passAndPlay: humans.length > 1,
        ownCandidate: humans.some((h) => pack.candidates.some((c) => c.id === playerOf(state, h).leaderId && "custom" in c)),
      };
      const clashed = summaries.some((x) => x.parties.some((p) => humans.includes(p.playerId) && p.conflicts.length > 0));
      const match = afterMatch(table, played.result, loadProfile().stats, { clashed, secondRound: false });
      record(match.stats, match.earned);
    }
    setState(played.state);
    setResult(played.result);
    setElection({ state: played.atCount, calls: electionCalls(pack, played.atCount), result: played.result, tie: false, continues: false, turn: played.atCount.turn - 1 });
    setBoards((b) => [...b, played.atCount]);
    setStage("election");
  }, [election, humans, onlineHumans, online, me, state, levelOf, start.scenario, config, summaries]);

  const restart = useCallback((next?: AiLevel) => {
    if (online) return; // a rematch online is a new lobby
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
    setEliminated(null);
    setReport(null);
    setStage(humans.length > 1 ? "handoff" : "planning");
    setTicker(openingHeadlines(fresh, humans[0]!));
    setMatchHeadline(null);
    setElection(null);
    setBoards([fresh]);
    setSummaries([]);
    setIdleAi(false);
  }, [config, humans, online]);

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
    eliminated,
    level,
    online: online
      ? {
          // The server's word counts too: a plan it holds for this turn has been sent, whatever this screen remembers.
          sent: submitted.includes(current) || Boolean(online.link.view?.yourPlan && online.link.view.turnsPlayed === applied.current && online.link.view.state?.turn === state.turn),
          waitingFor: online.link.view ? onlineHumans.filter((h) => playerOf(state, h).eliminated === undefined && !online.link.view!.submitted.includes(h) && h !== me) : [],
          spectating,
          connected: online.link.status === "open",
          error: online.link.error,
          deadline: online.link.deadline(),
          autopilot: online.link.view?.autopilot ?? [],
          missed: online.link.view?.missed ?? {},
        }
      : null,
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
