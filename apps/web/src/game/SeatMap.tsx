/**
 * The results seat map: one cell per seat (hexes, or real constituency shapes where the board has them), filled in party colours as regions
 * are declared. A highlighted set of regions is outlined and everything else dimmed: the region being called on election
 * night, or a group picked in the results.
 */
import { memo, useMemo, useRef, useState } from "react";
import { seatMapLayout, type SeatMapLayout } from "@majority-map/board";
import type { GameState } from "@majority-map/core";
import { board, playerOf, trackName } from "./model";

const UNCALLED = "#e8e0c9";

/** Colours every cell: each region's parties fill its cells biggest first, most central cells first. Regions not in `seats` stay uncalled. */
export function cellColors(layout: SeatMapLayout, state: GameState, seats: Record<string, Record<string, number>>): Map<string, string> {
  const out = new Map<string, string>();
  const byRegion = new Map<string, typeof layout.cells>();
  for (const c of layout.cells) byRegion.set(c.region, [...(byRegion.get(c.region) ?? []), c]);
  for (const [region, cells] of byRegion) {
    const split = seats[region];
    if (!split) continue;
    // Splits list players in standing order, so equal seat counts keep that order.
    const queue = Object.entries(split)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id, n]) => Array<string>(n).fill(playerOf(state, id).party.color));
    let i = 0;
    for (const c of [...cells].sort((a, b) => a.rank - b.rank)) {
      out.set(c.id, queue[i] ?? "#fff");
      i += c.seats;
    }
  }
  return out;
}

/** A shorter name for a region's label on the map. */
const shortRegion = (name: string) =>
  name
    .replace("Yorkshire and the Humber", "Yorkshire")
    .replace("Northern Ireland", "N. Ireland")
    .replace("East of England", "East")
    .replace(/^(North|South|East|West) (East|West|Midlands)$/, (_m, a: string, b: string) => `${a[0]}. ${b}`)
    .replace("Scotland, Wales and ", "");

/** Where each region's label goes: the middle of its hexes, sized from the hexes themselves. */
export function regionLabels(layout: SeatMapLayout): { id: string; x: number; y: number; size: number }[] {
  if (layout.kind !== "hex" || layout.cells.length === 0) return [];
  const first = layout.cells[0]!;
  const m = /^M([-\d.]+) ([-\d.]+)/.exec(first.d);
  const hex = m ? Math.hypot(Number(m[1]) - first.x, Number(m[2]) - first.y) : 6;
  const by = new Map<string, { x: number; y: number; n: number }>();
  for (const c of layout.cells) {
    const a = by.get(c.region) ?? { x: 0, y: 0, n: 0 };
    by.set(c.region, { x: a.x + c.x, y: a.y + c.y, n: a.n + 1 });
  }
  return [...by].map(([id, a]) => ({ id, x: a.x / a.n, y: a.y / a.n, size: hex * 2.1 }));
}

const MAX_ZOOM = 8;

/** How the seat map is zoomed and moved: its contents are drawn as translate(x y) scale(z) in the map's own units. */
interface View {
  z: number;
  x: number;
  y: number;
}

/** Keeps the zoomed map covering its frame, so it can't be dragged out of sight. */
function clampView(v: View, box: [number, number, number, number]): View {
  const [bx, by, bw, bh] = box;
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  const fit = (t: number, lo: number, size: number) => Math.min(lo * (1 - z), Math.max((lo + size) * (1 - z), t));
  return { z, x: fit(v.x, bx, bw), y: fit(v.y, by, bh) };
}

/** Labels that fit: biggest regions first, each kept only if it doesn't run into one already placed. Zooming in makes room for more. */
function visibleLabels(labels: ReturnType<typeof regionLabels>, names: Map<string, string>, weight: Map<string, number>, z: number) {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: (typeof labels[number] & { text: string })[] = [];
  for (const l of [...labels].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0))) {
    const text = names.get(l.id) ?? l.id;
    const size = l.size / z;
    const box = { x: l.x, y: l.y, w: text.length * size * 0.6, h: size * 1.1 };
    if (placed.some((q) => Math.abs(q.x - box.x) * 2 < q.w + box.w && Math.abs(q.y - box.y) * 2 < q.h + box.h)) continue;
    placed.push(box);
    out.push({ ...l, size, text });
  }
  return out;
}

interface Props {
  state: GameState;
  /** Seats by region for the regions declared so far. */
  seats: Record<string, Record<string, number>>;
  /** Regions to outline; everything else is dimmed. Empty: nothing highlighted. */
  highlight: string[];
  /** Reserved seat lists below the map: seats by player once declared. */
  reserved?: { id: string; name: string; seats: number; won?: Record<string, number> }[];
  onRegion?: (regionId: string) => void;
  /** Election night: leave room at the top for the call banner. */
  night?: boolean;
}

export const SeatMap = memo(function SeatMap({ state, seats, highlight, reserved, onRegion, night }: Props) {
  const layout = useMemo(() => seatMapLayout(board), []);
  const colors = useMemo(() => cellColors(layout, state, seats), [layout, state, seats]);
  const allLabels = useMemo(() => (night ? [] : regionLabels(layout)), [layout, night]);
  const names = useMemo(() => new Map(board.regions.map((r) => [r.id, shortRegion(r.name)])), []);
  const weight = useMemo(() => new Map(board.regions.map((r) => [r.id, r.seats])), []);
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const labels = useMemo(() => visibleLabels(allLabels, names, weight, view.z), [allLabels, names, weight, view.z]);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  /** A point of the screen as a point of the map's own units. */
  const toMap = (cx: number, cy: number) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM()!.inverse();
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const r = pt.matrixTransform(m);
    return { x: r.x, y: r.y };
  };
  /** Zooms by a factor keeping the map point under (cx, cy) where it is. */
  const zoomAt = (factor: number, at?: { x: number; y: number }) => {
    const box = layout.viewBox as [number, number, number, number];
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, v.z * factor));
      const k = z / v.z;
      const p = at ?? { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
      return clampView({ z, x: p.x - k * (p.x - v.x), y: p.y - k * (p.y - v.y) }, box);
    });
  };
  const gesture = {
    onWheel: (e: React.WheelEvent) => {
      const p = toMap(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p);
    },
    onPointerDown: (e: React.PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) moved.current = 0;
      else moved.current = 99;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      const now = { x: e.clientX, y: e.clientY };
      const box = layout.viewBox as [number, number, number, number];
      const scale = svgRef.current!.getScreenCTM()!.a; // screen pixels per map unit at zoom 1
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        pointers.current.set(e.pointerId, now);
        const [c, d] = [...pointers.current.values()];
        const after = Math.hypot(c!.x - d!.x, c!.y - d!.y);
        if (before > 0) zoomAt(after / before, toMap((c!.x + d!.x) / 2, (c!.y + d!.y) / 2));
        return;
      }
      pointers.current.set(e.pointerId, now);
      moved.current += Math.hypot(now.x - prev.x, now.y - prev.y);
      if (moved.current > 6) setView((v) => (v.z > 1 ? clampView({ ...v, x: v.x + (now.x - prev.x) / scale, y: v.y + (now.y - prev.y) / scale }, box) : v));
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
    },
  };
  const lit = new Set(highlight);
  const declared = Object.keys(seats).length;
  const [x, y, w, h] = layout.viewBox;
  const label = `Seat map: ${declared} of ${board.regions.length} regions declared${highlight.length ? `; showing ${highlight.map(trackName).join(", ")}` : ""}.`;
  return (
    <div className={`seat-map${night ? " night" : ""}`} data-testid="seat-map" data-kind={layout.kind}>
      <svg ref={svgRef} viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label} style={{ touchAction: "none" }} {...gesture}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`} data-testid="seat-zoom" data-zoom={view.z.toFixed(2)}>
        {layout.kind === "units" && board.greyed && <path d={board.greyed.d} className="seat-grey" />}
        {board.regions.map((r) => (
          <g
            key={r.id}
            className={`seat-region${lit.size && !lit.has(r.id) ? " dim" : ""}`}
            data-region={r.id}
            data-called={seats[r.id] ? "true" : "false"}
            onClick={onRegion ? () => moved.current <= 6 && onRegion(r.id) : undefined}
          >
            <title>{`${r.name}: ${r.seats} seats`}</title>
            {layout.cells
              .filter((c) => c.region === r.id)
              .map((c) => (
                <path key={c.id} d={c.d} fill={colors.get(c.id) ?? UNCALLED} className="seat-cell" />
              ))}
          </g>
        ))}
        {board.regions.map((r) => (
          <path key={r.id} d={layout.borders[r.id]} className={`seat-border${lit.has(r.id) ? " lit" : ""}`} />
        ))}
        {labels.map((l) => (
          <text key={l.id} x={l.x} y={l.y} fontSize={l.size} className="seat-label" textAnchor="middle" dominantBaseline="central" data-testid={`seat-label-${l.id}`}>
            {l.text}
          </text>
        ))}
        {/* Lit borders again on top, so neighbours' borders don't cover them. */}
        {highlight.map((id) => (layout.borders[id] ? <path key={`lit-${id}`} d={layout.borders[id]} className="seat-border lit" data-testid="seat-lit" /> : null))}
        </g>
      </svg>
      <div className="zoom-controls" role="group" aria-label="Zoom the seat map">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.5)} data-testid="seat-zoom-in">
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5)} data-testid="seat-zoom-out">
          −
        </button>
        {view.z > 1.001 && (
          <button type="button" aria-label="Show the whole map" onClick={() => setView({ z: 1, x: 0, y: 0 })} data-testid="seat-zoom-reset">
            ⤢
          </button>
        )}
      </div>
      {reserved && reserved.length > 0 && (
        <ul className="seat-reserved" data-testid="seat-reserved">
          {reserved.map((set) => {
            const colors = set.won
              ? Object.entries(set.won)
                  .filter(([, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1])
                  .flatMap(([id, n]) => Array<string>(n).fill(playerOf(state, id).party.color))
              : [];
            return (
              <li key={set.id} className={lit.size && !lit.has(set.id) ? "dim" : ""}>
                <span>{set.name}</span>
                <span className="seat-dots">
                  {Array.from({ length: set.seats }, (_, i) => (
                    <i key={i} style={{ background: colors[i] ?? UNCALLED }} />
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
