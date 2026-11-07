import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import polylabel from "polylabel";
import * as topo from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { GeometryCollection, Topology } from "topojson-specification";

export type Shape = Polygon | MultiPolygon;
export interface RegionProps {
  id: string;
  name: string;
  seats: number;
  /** Optional wider area (a province), used for borders drawn thicker between areas. */
  area?: string;
}
export type RegionFeature = Feature<Shape, RegionProps>;

export interface BoardRegion {
  id: string;
  name: string;
  seats: number;
  area?: string;
  /** SVG path in board coordinates. */
  d: string;
  /** Best spot for the seat badge: the point deepest inside the region's largest piece. */
  label: [number, number];
  /** Too small to tap comfortably; the renderer draws these enlarged in place. */
  small: boolean;
}

export interface Board {
  id: string;
  width: number;
  height: number;
  seats: number;
  regions: BoardRegion[];
  /** Outline of the whole playable country, for the raised base under the pieces. */
  outline: string;
  /** Thicker borders between wider areas (Pakistan's provinces). */
  areaBorders?: string;
  /** Land shown but not in play (Jammu and Kashmir on the Pakistan board). */
  greyed?: { d: string; label: [number, number]; name: string };
  /** True when region seat counts are sample values, not real ones. */
  sampleSeats?: boolean;
  credits: string[];
  notes: string[];
}

export interface BuildOptions {
  width: number;
  height: number;
  pad: number;
  /** Simplification weight in square board units; bigger removes more detail. */
  weight: number;
  /** Islands smaller than this (square board units) are dropped, except a region's largest piece. */
  speck: number;
  /** Regions whose total area is under this are flagged small. */
  small: number;
  /** Optional projection; defaults to Mercator fitted to the features. */
  projection?: GeoProjection;
}

/** Shoelace area of a ring, always positive. */
export function ringArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  return Math.abs(s / 2);
}

/** Board coordinates are rounded to half units: plenty for a board drawn about 1,000 units wide, and much smaller files. */
export const round = (n: number) => Math.round(n * 2) / 2;

export function polygonsOf(g: Shape): Position[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** GeoJSON from RFC 7946 sources winds rings the opposite way to what d3-geo expects; this flips them. */
export function rewind(g: Shape): Shape {
  const flip = (r: Position[]) => r.slice().reverse();
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(flip) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(flip)) };
}

/** Moves a shape sideways in longitude before projecting: a layout inset (Malaysia's east brought closer), not geography. */
export function shiftLongitude(g: Shape, dlon: number): Shape {
  const ring = (r: Position[]) => r.map(([x, y]) => [x! + dlon, y!]);
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(ring)) };
}

export function project(g: Shape, p: GeoProjection): Shape {
  const ring = (r: Position[]) => r.map((c) => p(c as [number, number]) as Position);
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((poly) => poly.map(ring)) };
}

/** SVG path for already-projected polygons, closing each ring. */
export function pathOf(polys: Position[][][]): string {
  return polys.map((p) => p.map((r) => "M" + r.slice(0, -1).map(([x, y]) => `${round(x!)} ${round(y!)}`).join("L") + "Z").join("")).join("");
}

/** Shortens long decimals in a d3-generated path. */
export const tidyPath = (d: string | null) => (d ?? "").replace(/(\d+\.\d)\d+/g, "$1");

export function fitProjection(features: Feature[], opts: BuildOptions): GeoProjection {
  const fc: FeatureCollection = { type: "FeatureCollection", features };
  return (opts.projection ?? geoMercator()).fitExtent(
    [
      [opts.pad, opts.pad],
      [opts.width - opts.pad, opts.height - opts.pad],
    ],
    fc,
  );
}

export interface Simplified {
  topology: Topology;
  geometries: GeometryCollection["geometries"];
}

/** Builds a topology from projected features (so shared borders stay shared) and simplifies it. */
export function simplifyFeatures(projected: RegionFeature[], weight: number): Simplified {
  const collection: FeatureCollection = { type: "FeatureCollection", features: projected };
  // The topojson typings disagree on property types between packages; the objects are the same at runtime.
  const raw = topology({ r: collection }, 1e5) as unknown as Parameters<typeof presimplify>[0];
  const t = simplify(presimplify(raw), weight) as Topology;
  return { topology: t, geometries: (t.objects.r as GeometryCollection).geometries };
}

/** Merges the pieces of one region (by index), drops specks and finds its label point. */
export function mergeRegion(s: Simplified, indexes: number[], opts: Pick<BuildOptions, "speck" | "small">): Pick<BoardRegion, "d" | "label" | "small"> {
  const merged = topo.merge(s.topology, indexes.map((i) => s.geometries[i]!) as Parameters<typeof topo.merge>[1]);
  const polys = polygonsOf(merged);
  const areas = polys.map((p) => ringArea(p[0]!));
  const maxA = Math.max(...areas);
  const keep = polys.filter((_, i) => areas[i]! > opts.speck || areas[i] === maxA);
  const biggest = polys[areas.indexOf(maxA)]!;
  const lp = polylabel(biggest as number[][][], 0.5);
  const total = keep.reduce((a, p) => a + ringArea(p[0]!), 0);
  return { d: pathOf(keep), label: [round(lp[0]!), round(lp[1]!)], small: total < opts.small };
}

export function outlineOf(s: Simplified): string {
  return tidyPath(geoPath()(topo.merge(s.topology, s.geometries as Parameters<typeof topo.merge>[1])));
}

/**
 * Builds a board from features that already carry game region ids. Several features may share an id
 * (for example the four Scottish areas in Natural Earth); they are merged into one region.
 */
export function buildBoard(id: string, features: RegionFeature[], opts: BuildOptions, extra: { credits: string[]; notes?: string[] }): Board {
  const proj = fitProjection(features, opts);
  const projected = features.map((f) => ({ ...f, geometry: project(f.geometry, proj) }));
  const s = simplifyFeatures(projected, opts.weight);
  const ids = [...new Set(projected.map((f) => f.properties.id))];
  const regions: BoardRegion[] = ids.map((rid) => {
    const indexes = projected.map((f, i) => (f.properties.id === rid ? i : -1)).filter((i) => i >= 0);
    const props = projected[indexes[0]!]!.properties;
    return { id: rid, name: props.name, seats: props.seats, ...(props.area ? { area: props.area } : {}), ...mergeRegion(s, indexes, opts) };
  });
  return {
    id,
    width: opts.width,
    height: opts.height,
    seats: regions.reduce((a, r) => a + r.seats, 0),
    regions,
    outline: outlineOf(s),
    credits: extra.credits,
    notes: extra.notes ?? [],
  };
}

/** Splits a total among weights by the largest-remainder method (used for Pakistan's sample seat counts). */
export function largestRemainder(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, rem: x - Math.floor(x) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length]!.i]! += 1;
  return out;
}

/** Short lowercase id from a name, made unique against ids already used: "Karachi" -> "kar", then "kaa", "kab"... */
export function shortId(name: string, used: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3).padEnd(3, "x");
  let id = base;
  for (let n = 0; used.has(id); n++) id = base.slice(0, 2) + String.fromCharCode(97 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : "");
  used.add(id);
  return id;
}
