import { useEffect, useMemo, useRef, useState } from "react";
import { BoardView, type BoardData, type BoardViewOptions } from "@majority-map/board";
import uk from "@majority-map/content/maps/uk.json";
import pk from "@majority-map/content/maps/pk.json";
import india from "@majority-map/content/maps/in.json";
import my from "@majority-map/content/maps/my.json";
import us from "@majority-map/content/maps/us.json";
import { makeSample, regionDetail, type Sample } from "./sample";

const BOARDS: { id: string; label: string; data: BoardData; opts: BoardViewOptions }[] = [
  { id: "uk", label: "United Kingdom", data: uk as unknown as BoardData, opts: {} },
  { id: "pk", label: "Pakistan", data: pk as unknown as BoardData, opts: { rotate: 30, minBadgeSeats: 4, lineWidth: 0.7, depth: 3.5 } },
  { id: "in", label: "India", data: india as unknown as BoardData, opts: { lineWidth: 1 } },
  { id: "my", label: "Malaysia", data: my as unknown as BoardData, opts: {} },
  { id: "us", label: "United States", data: us as unknown as BoardData, opts: { lineWidth: 1 } },
];

declare global {
  interface Window {
    __board?: { view: BoardView; boardId: string; ready: boolean } | undefined;
  }
}

async function fontsReady() {
  if (!document.fonts) return;
  await Promise.race([document.fonts.load('16px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]);
}

export function App() {
  const [boardId, setBoardId] = useState(() => new URLSearchParams(location.search).get("board") ?? "uk");
  const [selected, setSelected] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const entry = BOARDS.find((b) => b.id === boardId) ?? BOARDS[0]!;
  const sample: Sample = useMemo(() => makeSample(entry.data), [entry]);

  useEffect(() => {
    let view: BoardView | null = null;
    let cancelled = false;
    setSelected(null);
    (async () => {
      await fontsReady();
      if (cancelled || !host.current) return;
      view = await BoardView.create(host.current, entry.data, entry.opts);
      if (cancelled) return view.destroy();
      view.setStyles(sample.styles);
      view.onTap((id) => {
        const next = view!.selection === id ? null : id;
        view!.select(next);
        setSelected(next);
      });
      window.__board = { view, boardId: entry.id, ready: true };
    })();
    const timer = setInterval(() => view && setFps(Math.round(view.fps)), 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.__board = undefined;
      view?.destroy();
    };
  }, [entry, sample]);

  const detail = selected ? regionDetail(sample, selected) : null;
  const totals = sample.parties.map((p) => ({ party: p, seats: sample.seats[p.id] ?? 0 })).sort((a, b) => b.seats - a.seats);
  const total = entry.data.seats;

  return (
    <div className="lab">
      <header className="bar">
        <span className="brand">Board lab</span>
        <nav className="boards" aria-label="Board">
          {BOARDS.map((b) => (
            <button key={b.id} type="button" aria-pressed={b.id === boardId} onClick={() => setBoardId(b.id)}>
              {b.label}
            </button>
          ))}
        </nav>
        <span className="fps" data-testid="fps">
          {fps > 0 ? `${fps} fps` : "idle"}
        </span>
      </header>
      <main className="body">
        <div className="board" ref={host} data-testid="board" />
        <aside className="panel">
          {detail ? (
            <section data-testid="region-card">
              <h2>{detail.region.name}</h2>
              <p className="muted">{detail.region.seats} seats</p>
              <table>
                <tbody>
                  {detail.rows.map((r) => (
                    <tr key={r.party.id}>
                      <td>
                        <i style={{ background: r.party.color }} />
                        {r.party.name}
                      </td>
                      <td>{r.pips} pips</td>
                      <td>
                        <b>{r.seats}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <section>
              <h2>Sample standings</h2>
              <p className="muted">Tap a region or its seat badge.</p>
              <div className="tally">
                {totals.map((t) => (
                  <div key={t.party.id} style={{ width: `${(100 * t.seats) / total}%`, background: t.party.color }} title={`${t.party.name}: ${t.seats}`} />
                ))}
              </div>
              <table>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.party.id}>
                      <td>
                        <i style={{ background: t.party.color }} />
                        {t.party.name}
                      </td>
                      <td>
                        <b>{t.seats}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <footer className="credits">
            {entry.data.notes.concat(entry.data.credits).map((c) => (
              <p key={c}>{c}</p>
            ))}
          </footer>
        </aside>
      </main>
    </div>
  );
}
