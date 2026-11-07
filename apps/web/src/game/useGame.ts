/** Match state for the play screen: your plan for this turn, submitting it against the AI, and the election. */
import { useCallback, useMemo, useState } from "react";
import { finishElection, planAi, resolveTurn, validatePlan, type AiLevel, type ElectionResult, type GameState, type Plan, type TurnEvent } from "@majority-map/core";
import { newGame, pack, YOU } from "./model";

export interface GameApi {
  state: GameState;
  plan: Plan;
  issues: ReturnType<typeof validatePlan>;
  lastEvents: TurnEvent[];
  result: ElectionResult | null;
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
    let next = resolved.state;
    setSecondRound(false);
    if (next.phase === "election") {
      const done = finishElection(pack, next);
      next = done.state;
      if (done.result.secondRound) setSecondRound(true);
      else setResult(done.result);
    }
    setState(next);
    setPlan({});
    setLastEvents(events);
  }, [state, plan, level]);

  const restart = useCallback((next?: AiLevel) => {
    if (next) setLevel(next);
    setState(newGame());
    setPlan({});
    setLastEvents([]);
    setResult(null);
    setSecondRound(false);
  }, []);

  return { state, plan, issues, lastEvents, result, secondRound, level, setTarget, setPick, setAssign, submit, restart };
}
