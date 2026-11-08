/**
 * Pakistan district board with real seat counts: each region is a district, or districts that share a National Assembly
 * constituency, and holds that many of the 266 general seats (Election Commission of Pakistan, 2023 delimitation).
 * Jammu and Kashmir (Azad Kashmir, Gilgit-Baltistan and the Indian-administered part) has no National Assembly seats; it
 * is drawn grey and not played.
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
import { DISTRICT_DISPLAY, NA_CONSTITUENCIES, constituencyDistricts } from "./pakistan-seats.ts";

/** Natural Earth province name -> province code; X is not played. */
const PROVINCE: Record<string, string> = {
  Punjab: "pb", Sind: "sd", "K.P.": "kp", "F.A.T.A.": "kp", Baluchistan: "ba", "F.C.T.": "is", "Northern Areas": "X", "Azad Kashmir": "X",
};
/** General National Assembly seats per province. */
export const PROVINCE_SEATS: Record<string, number> = { pb: 141, sd: 61, kp: 45, ba: 16, is: 3 };
const PROVINCE_NAME: Record<string, string> = { pb: "Punjab", sd: "Sindh", kp: "Khyber Pakhtunkhwa", ba: "Balochistan", is: "Islamabad" };
/** Districts with no National Assembly seats: Azad Jammu and Kashmir and Gilgit-Baltistan. */
const NO_SEATS = new Set(["Azad Kashmir", "Shigar", "Diamer", "Ghizer", "Hunza", "Gilgit", "Nagar", "Astore", "Kharmang", "Skardu", "Ghanche"]);
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
  /** The boundary file's name for each feature, which constituencies refer to. */
  const fileName: string[] = [];
  for (const f of d2) {
    const name = String(f.properties.shapeName);
    if (NO_SEATS.has(name)) continue;
    const [px, py] = polylabel(biggestPolygon(f.geometry).coordinates as number[][][], 0.01);
    const pt: [number, number] = [px!, py!];
    let prov = name === "Islamabad Capital Territory" ? "is" : undefined;
    if (!prov) prov = PROVINCE[String(provinces.find((p) => geoContains(p, pt))?.properties.name)];
    if (!prov || prov === "X") continue;
    feats.push({ type: "Feature", properties: { id: "", name: DISTRICT_DISPLAY[name] ?? name, seats: 0, area: prov }, geometry: f.geometry });
    km.push(geoArea(f));
    fileName.push(name);
  }
  const grey: AnyFeature[] = [
    ...d2.filter((f) => NO_SEATS.has(String(f.properties.shapeName))),
    ...(admin1.features as AnyFeature[]).filter((f) => f.properties.adm0_a3 === "IND" && ["Jammu and Kashmir", "Ladakh"].includes(String(f.properties.name))),
  ];

  const opts = { width: 760, height: 760, pad: 20, weight: 1.5, speck: 2, small: 150 };
  const proj = fitProjection([...feats, ...grey], opts);
  const projected = feats.map((f) => ({ ...f, geometry: project(f.geometry, proj) }));
  const s = simplifyFeatures(projected, opts.weight);

  // Districts that share a constituency become one region; each region holds the constituencies inside it.
  const parent = projected.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const provOf = (i: number) => projected[i]!.properties.area!;
  const indexOf = (district: string) => {
    const i = fileName.indexOf(district);
    if (i < 0) throw new Error(`Constituency district "${district}" is not on the board`);
    return i;
  };
  const constituencies = NA_CONSTITUENCIES.map((name) => constituencyDistricts(name).map(indexOf));
  for (const ds of constituencies) for (const i of ds.slice(1)) parent[find(i)] = find(ds[0]!);
  const seats = new Map<number, number>();
  for (const ds of constituencies) seats.set(find(ds[0]!), (seats.get(find(ds[0]!)) ?? 0) + 1);
  const roots = [...new Set(projected.map((_, i) => find(i)))];
  for (const g of roots) {
    const members = projected.map((_, i) => i).filter((i) => find(i) === g);
    if (!seats.has(g)) throw new Error(`No constituency in ${members.map((i) => fileName[i]).join(", ")}`);
    if (new Set(members.map(provOf)).size > 1) throw new Error(`A region spans provinces: ${members.map((i) => fileName[i]).join(", ")}`);
  }
  for (const [pv, n] of Object.entries(PROVINCE_SEATS)) {
    const got = roots.filter((g) => provOf(g) === pv).reduce((a, g) => a + seats.get(g)!, 0);
    if (got !== n) throw new Error(`${PROVINCE_NAME[pv]} has ${got} seats on the board, not ${n}`);
  }
  const nameOf = (g: number) => projected[g]!.properties.name;

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
    sampleSeats: false,
    credits,
    notes: [
      `Areas: ${Object.entries(PROVINCE_NAME).map(([k, v]) => `${k} = ${v}`).join(", ")}.`,
      "Seats are the 266 general National Assembly seats of the Election Commission of Pakistan's 2023 delimitation. Districts that share a constituency are one region; districts created since the boundary file was drawn count in the district that holds them.",
      "Jammu and Kashmir is shown grey and is not in play.",
    ],
  };
}
