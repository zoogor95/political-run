/**
 * Pakistan district board. Districts are grouped so no province has more regions than National Assembly seats,
 * Jammu and Kashmir (Azad Kashmir, Gilgit-Baltistan and the Indian-administered part) is drawn grey and not played,
 * and seat counts are sample values: Karachi 22, Lahore 14 and Islamabad 3 are real, the rest of each province's real
 * total is shared out by the square root of area.
 */
import { geoArea, geoContains, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import polylabel from "polylabel";
import * as topo from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import {
  type Board,
  type BoardRegion,
  type RegionFeature,
  type Shape,
  fitProjection,
  largestRemainder,
  mergeRegion,
  outlineOf,
  polygonsOf,
  project,
  rewind,
  ringArea,
  round,
  shortId,
  simplifyFeatures,
  tidyPath,
} from "./geometry.ts";

/** Natural Earth province name -> province code; X is not played. */
const PROVINCE: Record<string, string> = {
  Punjab: "pb", Sind: "sd", "K.P.": "kp", "F.A.T.A.": "kp", Baluchistan: "ba", "F.C.T.": "is", "Northern Areas": "X", "Azad Kashmir": "X",
};
/** General National Assembly seats per province. */
export const PROVINCE_SEATS: Record<string, number> = { pb: 141, sd: 61, kp: 45, ba: 16, is: 3 };
const PROVINCE_NAME: Record<string, string> = { pb: "Punjab", sd: "Sindh", kp: "Khyber Pakhtunkhwa", ba: "Balochistan", is: "Islamabad" };
/** Districts with no National Assembly seats: Azad Jammu and Kashmir and Gilgit-Baltistan. */
const NO_SEATS = new Set(["Azad Kashmir", "Shigar", "Diamer", "Ghizer", "Hunza", "Gilgit", "Nagar", "Astore", "Kharmang", "Skardu", "Ghanche"]);
/** Real seat counts used where known. */
const FIXED: Record<string, number> = { Karachi: 22, Lahore: 14, Islamabad: 3 };
/** Always drawn enlarged: the capital territory is a key region but only a few pixels across. */
const ALWAYS_SMALL = new Set(["Islamabad"]);

type AnyFeature = Feature<Shape, Record<string, unknown>>;

function biggestPolygon(g: Shape): Polygon {
  let best = polygonsOf(g)[0]!;
  let bestArea = 0;
  for (const p of polygonsOf(g)) {
    const a = geoArea({ type: "Polygon", coordinates: p });
    if (a > bestArea) {
      bestArea = a;
      best = p;
    }
  }
  return { type: "Polygon", coordinates: best };
}

export function buildPakistan(districts: FeatureCollection, admin1: FeatureCollection, credits: string[]): Board {
  const d2 = (districts.features as AnyFeature[]).map((f) => ({ ...f, geometry: rewind(f.geometry) }));
  const provinces = (admin1.features as AnyFeature[]).filter((f) => f.properties.adm0_a3 === "PAK");

  const feats: RegionFeature[] = [];
  const km: number[] = [];
  for (const f of d2) {
    const name = String(f.properties.shapeName);
    if (NO_SEATS.has(name)) continue;
    const [px, py] = polylabel(biggestPolygon(f.geometry).coordinates as number[][][], 0.01);
    const pt: [number, number] = [px!, py!];
    let prov = name === "Islamabad Capital Territory" ? "is" : undefined;
    if (!prov) prov = PROVINCE[String(provinces.find((p) => geoContains(p, pt))?.properties.name)];
    if (!prov || prov === "X") continue;
    feats.push({ type: "Feature", properties: { id: "", name: name === "Islamabad Capital Territory" ? "Islamabad" : name, seats: 0, area: prov }, geometry: f.geometry });
    km.push(geoArea(f));
  }
  const grey: AnyFeature[] = [
    ...d2.filter((f) => NO_SEATS.has(String(f.properties.shapeName))),
    ...(admin1.features as AnyFeature[]).filter((f) => f.properties.adm0_a3 === "IND" && ["Jammu and Kashmir", "Ladakh"].includes(String(f.properties.name))),
  ];

  const opts = { width: 760, height: 760, pad: 20, weight: 1.5, speck: 2, small: 150 };
  const proj = fitProjection([...feats, ...grey], opts);
  const projected = feats.map((f) => ({ ...f, geometry: project(f.geometry, proj) }));
  const s = simplifyFeatures(projected, opts.weight);
  const nb = topo.neighbors(s.geometries as Parameters<typeof topo.neighbors>[0]);

  // Merge the smallest group into its smallest same-province neighbour until no province has more groups than seats.
  const parent = projected.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const groupArea = (g: number) => km.reduce((a, k, i) => a + (find(i) === g ? k : 0), 0);
  const provOf = (i: number) => projected[i]!.properties.area!;
  for (const pv of Object.keys(PROVINCE_SEATS)) {
    for (;;) {
      const groups = [...new Set(projected.map((_, i) => i).filter((i) => provOf(i) === pv).map(find))];
      if (groups.length <= PROVINCE_SEATS[pv]!) break;
      groups.sort((a, b) => groupArea(a) - groupArea(b));
      const g = groups[0]!;
      const neighbours = new Set<number>();
      projected.forEach((_, i) => {
        if (find(i) === g) nb[i]!.forEach((j) => provOf(j) === pv && find(j) !== g && neighbours.add(find(j)));
      });
      const target = [...neighbours].sort((a, b) => groupArea(a) - groupArea(b))[0];
      if (target === undefined) break;
      parent[g] = target;
    }
  }
  const roots = [...new Set(projected.map((_, i) => find(i)))];
  const nameOf = (g: number) => projected[g]!.properties.name;

  // Sample seats: fixed real counts first, then each region 1 seat plus a share of the rest by sqrt(area).
  const seats = new Map<number, number>();
  for (const pv of Object.keys(PROVINCE_SEATS)) {
    const all = roots.filter((g) => provOf(g) === pv);
    const fixed = all.filter((g) => FIXED[nameOf(g)] !== undefined);
    fixed.forEach((g) => seats.set(g, FIXED[nameOf(g)]!));
    const rest = all.filter((g) => FIXED[nameOf(g)] === undefined);
    if (rest.length === 0) continue;
    const extra = PROVINCE_SEATS[pv]! - fixed.reduce((a, g) => a + seats.get(g)!, 0) - rest.length;
    const share = largestRemainder(extra, rest.map((g) => Math.sqrt(groupArea(g))));
    rest.forEach((g, i) => seats.set(g, 1 + share[i]!));
  }

  const used = new Set<string>();
  const regions: BoardRegion[] = roots.map((g) => {
    const members = projected.map((_, i) => i).filter((i) => find(i) === g);
    const largest = members.slice().sort((a, b) => km[b]! - km[a]!)[0]!;
    const shape = mergeRegion(s, members, { speck: opts.speck, small: opts.small });
    return {
      id: shortId(projected[largest]!.properties.name, used),
      name: members.map((i) => projected[i]!.properties.name).join(" + "),
      seats: seats.get(g)!,
      area: provOf(g),
      ...shape,
      small: shape.small || ALWAYS_SMALL.has(nameOf(g)),
    };
  });

  const geoms = s.geometries;
  const areaBorders = tidyPath(
    geoPath()(
      topo.mesh(s.topology, s.topology.objects.r as GeometryCollection, (a, b) => a !== b && provOf(geoms.indexOf(a)) !== provOf(geoms.indexOf(b))),
    ),
  );

  const greyProjected: RegionFeature[] = grey.map((f) => ({ type: "Feature", properties: { id: "jk", name: "Jammu and Kashmir", seats: 0 }, geometry: project(f.geometry, proj) }));
  const gs = simplifyFeatures(greyProjected, opts.weight);
  const gm = topo.merge(gs.topology, gs.geometries as Parameters<typeof topo.merge>[1]);
  const gbig = polygonsOf(gm).sort((a, b) => ringArea(b[0]!) - ringArea(a[0]!))[0]!;
  const gl = polylabel(gbig as number[][][], 0.5);

  return {
    id: "pk",
    width: opts.width,
    height: opts.height,
    seats: regions.reduce((a, r) => a + r.seats, 0),
    regions,
    outline: outlineOf(s),
    areaBorders,
    greyed: { d: tidyPath(geoPath()(gm)), label: [round(gl[0]!), round(gl[1]!)], name: "Jammu and Kashmir" },
    sampleSeats: true,
    credits,
    notes: [
      `Areas: ${Object.entries(PROVINCE_NAME).map(([k, v]) => `${k} = ${v}`).join(", ")}.`,
      "Districts are merged so no province has more regions than seats. Karachi 22, Lahore 14 and Islamabad 3 are real seat counts; the rest are sample values.",
      "Jammu and Kashmir is shown grey and is not in play.",
    ],
  };
}
