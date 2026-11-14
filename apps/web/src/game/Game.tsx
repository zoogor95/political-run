import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView } from "@majority-map/board";
import { controllers, regionSeats, reservedScope } from "@majority-map/core";
import { board, boardStyles, electionStyles, pack, playerOf, presidential, votesWord } from "./model";
import { play } from "./audio";
import { useSettings } from "./settings";
import { Countdown } from "./Online";
import { ElectionNightView, type NightPhase } from "./election";
import { RankCards, ReplayStrip, ResultsBanner, ResultsBar, ResultsPanel } from "./results";
import { GroupDetail, GroupsPanel, LeadersCard, PartyPanel, PlanPanel, RivalsPanel, TABS, TopBar, TrackCard, type Tab } from "./panels";
import { BreakingCard, RecapPanel, SummaryView, Ticker } from "./recap";
import { Coach } from "./Coach";
import { SeatMap } from "./SeatMap";
import { useGame, type GameApi, type GameStart } from "./useGame";

declare global {
  interface Window {
    __game?: { view: BoardView; game: GameApi; ready: boolean } | undefined;
  }
}

export function Game({ start, onMenu, onSettings }: { start: GameStart; onMenu: () => void; onSettings: () => void }) {
  const game = useGame(start);
  const settings = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [highlight, setHighlight] = useState<string | null>(null);
  // A region group picked in the Groups tab: its regions stay lit on the board.
  const [groupFocus, setGroupFocus] = useState<string | null>(null);
  // Region groups this player leads, for the badge on the board's groups button.
  const ownedGroups = useMemo(() => Object.values(controllers(pack, game.state)).filter((o) => o === game.viewer).length, [game.state, game.viewer]);
  const focusRegions = useMemo(() => (groupFocus ? (pack.groups.find((g) => g.id === groupFocus)?.regions ?? null) : null), [groupFocus]);
  useEffect(() => {
    if (tab !== "groups") setGroupFocus(null);
  }, [tab]);
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  // Recap: regions are revealed one by one, the board showing last turn's state until each is revealed.
  const report = game.report;
  const recapRegions = useMemo(() => (report ? report.summary.changedRegions.filter((id) => board.regions.some((r) => r.id === id)) : []), [report]);
  const [recapIndex, setRecapIndex] = useState(0);
  const [speed, setSpeed] = useState<1 | 2>(settings.recapSpeed);
  const [breakingDone, setBreakingDone] = useState(false);
  const recapping = game.stage === "recap" && report !== null;
  const breaking = recapping && !breakingDone ? report.headlines.find((h) => h.breaking) : undefined;

  useEffect(() => {
    setRecapIndex(0);
    setBreakingDone(false);
  }, [report]);

  useEffect(() => {
    if (!recapping || breaking) return;
    if (recapRegions.length === 0) {
      game.endRecap();
      return;
    }
    const t = setTimeout(() => {
      if (recapIndex + 1 >= recapRegions.length) game.endRecap();
      else setRecapIndex((i) => i + 1);
    }, (recapIndex + 1 >= recapRegions.length ? 1400 : 1100) / speed);
    return () => clearTimeout(t);
  }, [recapping, breaking, recapIndex, recapRegions, speed, game]);

  // Election night: a suspense card, then regions called one at a time; faster once someone passes the majority.
  const night = game.election;
  const onNight = game.stage === "election" && night !== null;
  const [nightPhase, setNightPhase] = useState<NightPhase>("suspense");
  const [called, setCalled] = useState(0);
  // Election night at 2× (the design's speed button): every pause halves.
  const [nightSpeed, setNightSpeed] = useState<1 | 2>(1);
  // The results' replay slider: null means the final result, so the results open on it without waiting for an effect.
  const [replayAt, setReplay] = useState<number | null>(null);
  const replay = replayAt ?? game.boards.length - 1;
  const [coaching, setCoaching] = useState(() => game.config.tutorial === true);
  // Election night and results show the seat map; results can switch back to the campaign board.
  // Presidential: each state goes whole to its winner, so the real map is the results map.
  const [seatView, setSeatView] = useState(() => !presidential());
  const [litGroup, setLitGroup] = useState<string | null>(null);
  // A new count (a new night, or the deciding count once the computer candidates finish the race) starts afresh.
  useEffect(() => {
    if (!onNight) return;
    setNightPhase("suspense");
    setCalled(0);
  }, [onNight, night]);
  useEffect(() => {
    if (!onNight || !night) return;
    if (nightPhase === "suspense") {
      const t = setTimeout(() => setNightPhase("calling"), 1800 / nightSpeed);
      return () => clearTimeout(t);
    }
    if (nightPhase !== "calling") return;
    if (called >= night.calls.length) {
      const t = setTimeout(() => setNightPhase("done"), 1200 / nightSpeed);
      return () => clearTimeout(t);
    }
    const passed = night.calls.slice(0, called).some((c) => c.majorityFor);
    const t = setTimeout(() => setCalled((c) => c + 1), (called === 0 ? 300 : passed ? 350 : 1000) / nightSpeed);
    return () => clearTimeout(t);
  }, [onNight, night, nightPhase, called, nightSpeed]);
  // Replay map: the strip over the map that plays the board turn by turn.
  const [replaying, setReplaying] = useState(false);
  useEffect(() => {
    if (game.stage === "results") setReplay(null);
    setReplaying(false);
  }, [game.stage, game.boards.length]);
  const skipNight = useCallback(() => {
    if (!night) return;
    setCalled(night.calls.length);
    setNightPhase("done");
  }, [night]);

  const styles = useMemo(() => {
    if (onNight) return electionStyles(night.state, night.calls, called);
    if (game.stage === "results" && night) {
      if (replay >= game.boards.length - 1) return electionStyles(night.state, night.calls, night.calls.length);
      return boardStyles(game.boards[replay]!, {}, null, null);
    }
    // Pass and play: the hand-off screen shows the board but nobody's plan.
    if (game.stage === "handoff") return boardStyles(game.state, {}, null, null);
    if (!recapping) return boardStyles(game.state, game.plan, highlight, game.viewer, focusRegions);
    const before = boardStyles(report.before, {}, null, null);
    const after = boardStyles(report.after, {}, null, null);
    const shown = new Set(recapRegions.slice(0, recapIndex + 1));
    return Object.fromEntries(board.regions.map((r) => [r.id, shown.has(r.id) ? after[r.id]! : before[r.id]!]));
  }, [recapping, report, recapRegions, recapIndex, game.state, game.plan, highlight, focusRegions, onNight, night, called, game.stage, game.boards, replay]);
  const endBreaking = useCallback(() => setBreakingDone(true), []);

  // The seat map: regions fill as they are declared; in the results, the replay slider shows the seats each turn's board
  // would have won.
  const results = game.stage === "results" && night !== null;
  const showSeats = (onNight || results) && seatView;
  const seatMap = useMemo(() => {
    if (!night || !(onNight || results)) return null;
    const finalBoard = !results || replay >= game.boards.length - 1;
    const shown = onNight ? night.calls.slice(0, called) : night.calls;
    if (!finalBoard) return { state: game.boards[replay]!, seats: regionSeats(pack, game.boards[replay]!), reservedWon: {} as Record<string, Record<string, number>> };
    const seats: Record<string, Record<string, number>> = {};
    const reservedWon: Record<string, Record<string, number>> = {};
    for (const c of shown) (c.reserved ? reservedWon : seats)[c.regionId] = c.seats;
    return { state: night.state, seats, reservedWon };
  }, [night, onNight, results, called, replay, game.boards]);
  // The picked region group's card sits above the board, which shrinks to fit under it.
  const showGroupCard = game.stage === "planning" && tab === "groups" && groupFocus !== null && !selected;
  const nightCall = onNight && nightPhase === "calling" && called > 0 ? night.calls[called - 1]! : null;
  const seatHighlight = useMemo(() => {
    if (nightCall?.reserved) {
      const def = pack.reservedSeats?.find((d) => d.id === nightCall.regionId);
      return [nightCall.regionId, ...(def ? reservedScope(pack, def) : [])];
    }
    if (nightCall) return [nightCall.regionId];
    if (results && litGroup) return pack.groups.find((g) => g.id === litGroup)?.regions ?? [];
    return [];
  }, [nightCall, results, litGroup]);
  useEffect(() => {
    if (!results) setLitGroup(null);
  }, [results]);

  // Sound cues: submitting, BREAKING cards, election calls and a majority.
  useEffect(() => {
    if (game.stage === "recap") play("submit");
  }, [game.stage]);
  useEffect(() => {
    if (breaking) play("breaking");
  }, [breaking]);
  useEffect(() => {
    if (!onNight || called === 0 || !night) return;
    play(night.calls[called - 1]?.majorityFor ? "majority" : "call");
  }, [onNight, called, night]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (document.fonts) await Promise.race([document.fonts.load('16px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]);
      if (cancelled || !host.current) return;
      const view = await BoardView.create(host.current, board);
      if (cancelled) return view.destroy();
      viewRef.current = view;
      view.onTap((id) => {
        play("tap");
        setSelected((cur) => (cur === id ? null : id));
      });
      view.setStyles(styles);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // The board is created once; styles and selection are pushed by the effects below.
  }, []);

  useEffect(() => {
    viewRef.current?.setStyles(styles);
  }, [styles, ready]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (recapping) {
      view.select(breaking ? null : (recapRegions[recapIndex] ?? null));
      return;
    }
    if (onNight || game.stage === "results") {
      const call = onNight && nightPhase === "calling" && called > 0 ? night!.calls[called - 1]! : null;
      view.select(call && !call.reserved ? call.regionId : null);
      return;
    }
    const isRegion = selected !== null && board.regions.some((r) => r.id === selected);
    view.select(isRegion ? selected : null);
  }, [selected, styles, ready, recapping, breaking, recapRegions, recapIndex, onNight, nightPhase, called, night, game.stage]);

  useEffect(() => {
    if (viewRef.current) window.__game = { view: viewRef.current, game, ready: true };
  });

  return (
    <div className={`game${onNight ? " night" : ""}${results ? ` results-stage${presidential() ? "" : " parl"}` : ""}`} data-testid={results ? "results" : undefined}>
      {!results && <Ticker headlines={game.ticker} />}
      {onNight ? (
        <ElectionNightView
          night={night}
          called={called}
          phase={nightPhase}
          onSkip={skipNight}
          onDone={game.endElection}
          you={game.solo ? game.humans[0]! : null}
          humans={game.humans}
          speed={nightSpeed}
          onSpeed={() => setNightSpeed((v) => (v === 1 ? 2 : 1))}
        />
      ) : results ? (
        <ResultsBanner game={game} />
      ) : (
        <TopBar game={game} onMenu={onMenu} onSettings={onSettings} />
      )}
      {game.secondRound && <div className="banner">Tie for most seats! Second round: everyone loses 5 pips in every region and the campaign goes on.</div>}
      {game.eliminated && (
        <div className="banner" data-testid="eliminated-banner">
          No majority: {game.label(game.eliminated)} {game.solo && game.eliminated === game.humans[0] ? "are" : "is"} out of the race. Their pips are off the map and the
          campaign goes on.
        </div>
      )}
      {game.online && game.stage === "planning" && <OnlineBanner game={game} />}
      <main className="game-body">
        <div className={`board-wrap${showGroupCard ? " with-card" : ""}`}>
          <div className={`board${showSeats ? " under" : ""}`} ref={host} data-testid="board" />
          {showSeats && seatMap && (
            <SeatMap
              state={seatMap.state}
              seats={seatMap.seats}
              highlight={seatHighlight}
              night={onNight}
              reserved={(pack.reservedSeats ?? []).map((d) => ({ ...d, ...(seatMap.reservedWon[d.id] ? { won: seatMap.reservedWon[d.id]! } : {}) }))}
            />
          )}
          {results && (
            <button type="button" className="seat-toggle" onClick={() => setSeatView((v) => !v)} aria-pressed={seatView} data-testid="seatmap-toggle">
              {seatView ? "Show the campaign board" : "Show the seat map"}
            </button>
          )}
          {results && replaying && (
            <ReplayStrip
              game={game}
              replay={replay}
              onReplay={setReplay}
              onClose={() => {
                setReplaying(false);
                setReplay(null);
              }}
            />
          )}
          {coaching && game.stage !== "results" && <Coach context={{ game, selected, tab }} onClose={() => setCoaching(false)} />}
          {showGroupCard && (
            <GroupDetail game={game} groupId={groupFocus!} onClose={() => setGroupFocus(null)} />
          )}
          {game.stage === "planning" && !onNight && (
            <div className="group-buttons">
              <button
                type="button"
                className={`round${tab === "groups" && !selected ? " on" : ""}`}
                onClick={() => {
                  setSelected(null);
                  setTab("groups");
                }}
                data-testid="groups-button"
              >
                {presidential() ? "State" : "Region"}
                <br />
                groups
                {ownedGroups > 0 && (
                  <span className="round-badge" aria-label={`You lead ${ownedGroups}`}>
                    {ownedGroups}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
        <div className={`game-side${selected && !recapping && !onNight && game.stage !== "results" ? " card-open" : ""}`}>
        <aside className="panel game-panel">
          {game.stage === "results" && night ? (
            <ResultsPanel
              game={game}
              litGroup={litGroup}
              onGroup={(id) => {
                setLitGroup((g) => (g === id ? null : id));
                setSeatView(true);
              }}
            />
          ) : recapping ? (
            <RecapPanel
              label={game.label}
              report={report}
              regionId={breaking ? null : (recapRegions[recapIndex] ?? null)}
              controls={{
                index: recapIndex,
                total: recapRegions.length,
                speed,
                setSpeed,
                replay: () => {
                  setRecapIndex(0);
                  setBreakingDone(true);
                },
                skip: game.endRecap,
              }}
            />
          ) : selected ? (
            <TrackCard key={selected} game={game} trackId={selected} onClose={() => setSelected(null)} />
          ) : (
            <>
              <nav className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
                    {t.label}
                  </button>
                ))}
              </nav>
              {tab === "plan" && (
                <label className="find">
                  <span>Go to a region</span>
                  <select value="" onChange={(e) => e.target.value && setSelected(e.target.value)} data-testid="find-region">
                    <option value="">Choose a region or group…</option>
                    {pack.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.seats} {votesWord()})
                      </option>
                    ))}
                    {pack.groups
                      .filter((g) => g.kind === "national")
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} (national group)
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {tab === "plan" && <PlanPanel game={game} onOpen={setSelected} />}
              {tab === "party" && <PartyPanel game={game} />}
              {tab === "groups" && <GroupsPanel game={game} onOpen={setSelected} focus={groupFocus} onFocus={setGroupFocus} />}
              {tab === "rivals" && <RivalsPanel game={game} highlight={highlight} onHighlight={setHighlight} />}
              {tab === "plan" && report && (
                <section className="last" data-testid="last-turn">
                  <h3>Last turn</h3>
                  <p className="small">{report.headlines[0]?.text}</p>
                  <button type="button" onClick={game.showSummary} data-testid="open-summary">
                    Turn summary
                  </button>
                </section>
              )}
            </>
          )}
        </aside>
        {!onNight && game.stage !== "results" && <LeadersCard game={game} highlight={highlight} onHighlight={setHighlight} />}
        </div>
        {results && !presidential() && <RankCards game={game} />}
      </main>
      {results && (
        <ResultsBar
          game={game}
          onMenu={onMenu}
          onReplay={() => {
            setReplay(0);
            setReplaying(true);
          }}
        />
      )}
      {breaking && <BreakingCard headline={breaking} onDone={endBreaking} />}
      {game.stage === "summary" && report && <SummaryView game={game} />}
      {game.stage === "handoff" && <Handoff game={game} />}

    </div>
  );
}

/** Online: the turn timer, who's still planning, and anyone the computer is playing for. */
function OnlineBanner({ game }: { game: GameApi }) {
  const o = game.online!;
  const me = game.humans[0]!;
  const names = (ids: string[]) => ids.map(game.label).join(", ");
  const others = o.autopilot.filter((id) => id !== me);
  let text: string;
  if (!o.connected) text = "Connection lost. Reconnecting…";
  else if (o.error) text = o.error;
  else if (o.spectating) text = `You're out of the race. Watching the others${o.waitingFor.length ? `: waiting for ${names(o.waitingFor)}` : ""}.`;
  else if (o.sent) text = o.waitingFor.length ? `Plan sent. Waiting for ${names(o.waitingFor)}.` : "Plan sent. Resolving the turn…";
  else if (o.autopilot.includes(me)) text = "You missed 3 turns, so the computer has been playing for you. Send a plan to take your seat back.";
  else if (o.deadline) text = (o.missed[me] ?? 0) > 0 ? `You missed the last turn. Plan before the timer runs out.` : "Plan before the timer runs out.";
  else return null;
  return (
    <div className="banner online-banner" data-testid="online-banner" role="status">
      {o.deadline && !o.spectating && state(game) && (
        <span className="timer">
          <Countdown deadline={o.deadline} /> left
        </span>
      )}
      <span>{text}</span>
      {others.length > 0 && <small> The computer is playing for {names(others)} (missed turns).</small>}
    </div>
  );
}

const state = (game: GameApi) => game.state.phase === "campaign" || game.state.phase === "final";

/** Pass and play: cover the screen between players so nobody sees anyone else's plan. */
function Handoff({ game }: { game: GameApi }) {
  const seat = game.config.seats.find((x) => x.id === game.viewer);
  const party = playerOf(game.state, game.viewer).party;
  return (
    <div className="overlay handoff" data-testid="handoff">
      <div className="handoff-card">
        <i className="chip big" style={{ background: party.color }} />
        <h2>Pass the device to {seat?.label ?? party.name}</h2>
        <p className="muted">
          {party.name} plans turn {game.state.turn} in secret. Everyone else, look away.
        </p>
        <button type="button" className="primary" onClick={game.ready} data-testid="ready">
          I'm {seat?.label ?? party.name}: show my turn
        </button>
      </div>
    </div>
  );
}
