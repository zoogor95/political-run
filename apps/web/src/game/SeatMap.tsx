/**
 * The results seat map: one cell per seat (hexes, or real constituency shapes where the board has them), filled in party colours as regions
 * are declared. A highlighted set of regions is outlined and everything else dimmed: the region being called on election
 * night, or a group picked in the results.
 */
import { memo, useMemo } from "react";
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

interface Props {
  state: GameState;
  /** Seats by region for the regions declared so far. */
  seats: Record<string, Record<string, number>>;
  /** Regions to outline; everything else is dimmed. Empty: nothing highlighted. */
  highlight: string[];
  /** Reserved seat lists below the map: seats by player once declared. */
  reserved?: { id: string; name: string; seats: number; won?: Record<string, number> }[];
  onRegion?: (regionId: string) => void;
}

export const SeatMap = memo(function SeatMap({ state, seats, highlight, reserved, onRegion }: Props) {
  const layout = useMemo(() => seatMapLayout(board), []);
  const colors = useMemo(() => cellColors(layout, state, seats), [layout, state, seats]);
  const lit = new Set(highlight);
  const declared = Object.keys(seats).length;
  const [x, y, w, h] = layout.viewBox;
  const label = `Seat map: ${declared} of ${board.regions.length} regions declared${highlight.length ? `; showing ${highlight.map(trackName).join(", ")}` : ""}.`;
  return (
    <div className="seat-map" data-testid="seat-map" data-kind={layout.kind}>
      <svg viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label}>
        {layout.kind === "units" && board.greyed && <path d={board.greyed.d} className="seat-grey" />}
        {board.regions.map((r) => (
          <g
            key={r.id}
            className={`seat-region${lit.size && !lit.has(r.id) ? " dim" : ""}`}
            data-region={r.id}
            data-called={seats[r.id] ? "true" : "false"}
            onClick={onRegion ? () => onRegion(r.id) : undefined}
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
        {/* Lit borders again on top, so neighbours' borders don't cover them. */}
        {highlight.map((id) => (layout.borders[id] ? <path key={`lit-${id}`} d={layout.borders[id]} className="seat-border lit" data-testid="seat-lit" /> : null))}
      </svg>
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
