/** Board geometry as written by the map build tool (packages/content/maps/<id>.json). */
export interface BoardRegion {
  id: string;
  name: string;
  seats: number;
  area?: string;
  d: string;
  label: [number, number];
  small: boolean;
}

export interface BoardData {
  id: string;
  width: number;
  height: number;
  seats: number;
  regions: BoardRegion[];
  outline: string;
  areaBorders?: string;
  greyed?: { d: string; label: [number, number]; name: string };
  sampleSeats?: boolean;
  credits: string[];
  notes: string[];
}

/** How one region looks right now. The renderer knows nothing about rules; the game works these out. */
export interface RegionStyle {
  /** Top-face colour (the leader's shade for their pip count, or the empty colour). */
  fill: number;
  /** Up to three party colours with their pip shares, for the small bar under the seat badge. */
  shares?: { color: number; share: number }[];
  /** Locked regions get a check mark. */
  locked?: boolean;
  /** One of your party members works here. */
  member?: boolean;
}

export interface Point {
  x: number;
  y: number;
}
