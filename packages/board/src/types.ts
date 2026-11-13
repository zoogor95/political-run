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

/** A drawn piece of the results map holding some of a region's seats (a constituency holds one). */
export interface BoardUnit {
  id: string;
  name: string;
  region: string;
  seats: number;
  d: string;
  label: [number, number];
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
  /** Real shapes drawn on the results map in place of seat hexes. */
  units?: BoardUnit[];
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
  /** Your plan this turn adds steps here: the badge gets a gold ring. */
  planned?: boolean;
}

export interface Point {
  x: number;
  y: number;
}
