import { useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardData } from "@majority-map/board";
import ukBoard from "@majority-map/content/maps/uk.json";
import { boardStyles } from "./model";
import { GroupsPanel, LastTurn, PartyPanel, PlanPanel, Results, RivalsPanel, TABS, TopBar, TrackCard, type Tab } from "./panels";
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
  const styles = useMemo(() => boardStyles(game.state, game.plan, highlight), [game.state, game.plan, highlight]);

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
    const isRegion = selected !== null && board.regions.some((r) => r.id === selected);
    view.select(isRegion ? selected : null);
  }, [selected, styles, ready]);

  useEffect(() => {
    if (viewRef.current) window.__game = { view: viewRef.current, game, ready: true };
  });

  return (
    <div className="game">
      <TopBar game={game} />
      {game.secondRound && <div className="banner">Tie for most seats! Second round: everyone loses 5 pips in every region and the campaign goes on.</div>}
      <main className="game-body">
        <div className="board" ref={host} data-testid="board" />
        <aside className="panel game-panel">
          {selected ? (
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
              {tab === "plan" && <LastTurn state={game.state} events={game.lastEvents} />}
            </>
          )}
        </aside>
      </main>
      {game.result && <Results game={game} />}
    </div>
  );
}
