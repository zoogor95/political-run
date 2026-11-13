/**
 * Pakistan division board with real seat counts: each region is a division (33, Islamabad counted as one) and holds the
 * 266 general seats of its districts (Election Commission of Pakistan, 2023 delimitation). A constituency shared by
 * two districts always lies in one division; the build checks that.
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
  type BoardUnit,
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
  simplifyFeatures,
  tidyPath,
} from "./geometry.ts";
import { DIVISION, NA_CONSTITUENCIES, constituencyDistricts } from "./pakistan-seats.ts";

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
    feats.push({ type: "Feature", properties: { id: "", name, seats: 0, area: prov }, geometry: f.geometry });
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

  // Each division is one region holding the constituencies of its districts.
  const parent = projected.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const provOf = (i: number) => projected[i]!.properties.area!;
  const indexOf = (district: string) => {
    const i = fileName.indexOf(district);
    if (i < 0) throw new Error(`Constituency district "${district}" is not on the board`);
    return i;
  };
  const constituencies = NA_CONSTITUENCIES.map((name) => constituencyDistricts(name).map(indexOf));
  const divisionOf = (i: number) => {
    const d = DIVISION[fileName[i]!];
    if (!d) throw new Error(`No division for district "${fileName[i]}"`);
    return d;
  };
  for (const ds of constituencies) {
    if (new Set(ds.map(divisionOf)).size > 1) throw new Error(`A constituency crosses divisions: ${ds.map((i) => fileName[i]).join(", ")}`);
  }
  projected.forEach((_, i) => {
    const first = projected.findIndex((_, j) => divisionOf(j) === divisionOf(i));
    parent[find(i)] = find(first);
  });
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

  const regions: BoardRegion[] = roots.map((g) => {
    const members = projected.map((_, i) => i).filter((i) => find(i) === g);
    const shape = mergeRegion(s, members, { speck: opts.speck, small: opts.small });
    return {
      id: divisionOf(g).toLowerCase().replace(/[^a-z]+/g, "-"),
      name: divisionOf(g),
      seats: seats.get(g)!,
      area: provOf(g),
      ...shape,
      small: shape.small || ALWAYS_SMALL.has(divisionOf(g)),
    };
  });

  // Result units: districts, with districts that share a constituency joined so no seat is split between two units.
  const uparent = projected.map((_, i) => i);
  const ufind = (i: number): number => (uparent[i] === i ? i : (uparent[i] = ufind(uparent[i]!)));
  for (const ds of constituencies) for (const i of ds) uparent[ufind(i)] = ufind(ds[0]!);
  const useats = new Map<number, number>();
  for (const ds of constituencies) useats.set(ufind(ds[0]!), (useats.get(ufind(ds[0]!)) ?? 0) + 1);
  const regionId = (i: number) => divisionOf(i).toLowerCase().replace(/[^a-z]+/g, "-");
  const kebab = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  const unitRoots = [...new Set(projected.map((_, i) => ufind(i)))];
  const units: BoardUnit[] = [];
  for (const u of unitRoots) {
    const members = projected.map((_, i) => i).filter((i) => ufind(i) === u);
    const seatsHere = useats.get(u) ?? 0;
    if (seatsHere === 0) {
      // A district with no constituency of its own: drawn with its region's biggest unit (handled below).
      continue;
    }
    const names = members.map((i) => fileName[i]!).sort();
    const shape = mergeRegion(s, members, { speck: opts.speck, small: 0 });
    units.push({ id: kebab(names[0]!), name: names.join(" & "), region: regionId(u), seats: seatsHere, d: shape.d, label: shape.label });
  }
  const unplaced = unitRoots.filter((u) => !useats.get(u));
  if (unplaced.length) throw new Error(`Districts with no constituency: ${unplaced.map((u) => fileName[u]).join(", ")}`);
  units.sort((a, b) => a.region.localeCompare(b.region) || b.seats - a.seats || a.id.localeCompare(b.id));
  if (new Set(units.map((u) => u.id)).size !== units.length) throw new Error("Two result units share an id");

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
    units,
    credits,
    notes: [
      `Areas: ${Object.entries(PROVINCE_NAME).map(([k, v]) => `${k} = ${v}`).join(", ")}.`,
      "Regions are divisions. Seats are the 266 general National Assembly seats of the Election Commission of Pakistan's 2023 delimitation; districts created since the boundary file was drawn count in the district that holds them.",
      "Jammu and Kashmir is shown grey and is not in play.",
      "Election results are drawn by district: each district (districts that share a constituency are joined) goes to one party with all its seats.",
    ],
  };
}
