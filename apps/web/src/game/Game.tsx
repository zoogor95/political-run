import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardData } from "@majority-map/board";
import ukBoard from "@majority-map/content/maps/uk.json";
import { boardStyles } from "./model";
import { GroupsPanel, PartyPanel, PlanPanel, Results, RivalsPanel, TABS, TopBar, TrackCard, type Tab } from "./panels";
import { BreakingCard, RecapPanel, SummaryView, Ticker } from "./recap";
import { useGame, type GameApi } from "./useGame";

const board = ukBoard as unknown as BoardData;

declare global {
  interface Window {
    __game?: { view: BoardView; game: GameApi; ready: boolean } | undefined;
  }
}

export function Game() {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed")) || undefined;
  const ai = params.get("ai");
  const game = useGame(seed, ai === "easy" || ai === "hard" ? ai : "normal");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);
  // Recap: regions are revealed one by one, the board showing last turn's state until each is revealed.
  const report = game.report;
  const recapRegions = useMemo(() => (report ? report.summary.changedRegions.filter((id) => board.regions.some((r) => r.id === id)) : []), [report]);
  const [recapIndex, setRecapIndex] = useState(0);
  const [speed, setSpeed] = useState<1 | 2>(1);
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

  const styles = useMemo(() => {
    if (!recapping) return boardStyles(game.state, game.plan, highlight);
    const before = boardStyles(report.before, {}, null);
    const after = boardStyles(report.after, {}, null);
    const shown = new Set(recapRegions.slice(0, recapIndex + 1));
    return Object.fromEntries(board.regions.map((r) => [r.id, shown.has(r.id) ? after[r.id]! : before[r.id]!]));
  }, [recapping, report, recapRegions, recapIndex, game.state, game.plan, highlight]);
  const endBreaking = useCallback(() => setBreakingDone(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (document.fonts) await Promise.race([document.fonts.load('16px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]);
      if (cancelled || !host.current) return;
      const view = await BoardView.create(host.current, board);
      if (cancelled) return view.destroy();
      viewRef.current = view;
      view.onTap((id) => setSelected((cur) => (cur === id ? null : id)));
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
    const isRegion = selected !== null && board.regions.some((r) => r.id === selected);
    view.select(isRegion ? selected : null);
  }, [selected, styles, ready, recapping, breaking, recapRegions, recapIndex]);

  useEffect(() => {
    if (viewRef.current) window.__game = { view: viewRef.current, game, ready: true };
  });

  return (
    <div className="game">
      <Ticker headlines={game.ticker} />
      <TopBar game={game} />
      {game.secondRound && <div className="banner">Tie for most seats! Second round: everyone loses 5 pips in every region and the campaign goes on.</div>}
      <main className="game-body">
        <div className="board" ref={host} data-testid="board" />
        <aside className="panel game-panel">
          {recapping ? (
            <RecapPanel
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
              {tab === "plan" && <PlanPanel game={game} onOpen={setSelected} />}
              {tab === "party" && <PartyPanel game={game} />}
              {tab === "groups" && <GroupsPanel game={game} onOpen={setSelected} />}
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
      </main>
      {breaking && <BreakingCard headline={breaking} onDone={endBreaking} />}
      {game.stage === "summary" && report && <SummaryView game={game} />}
      {game.result && game.stage === "planning" && <Results game={game} />}
    </div>
  );
}
