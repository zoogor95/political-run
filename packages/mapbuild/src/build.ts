/** Builds every board from the cached boundary files (run fetch.ts first) into packages/content/maps/<id>.json. */
import { geoAlbersUsa } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as topo from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import usAtlas from "us-atlas/states-10m.json" with { type: "json" };
import { type Board, type RegionFeature, type Shape, buildBoard, shiftLongitude } from "./geometry.ts";
import { buildPakistan } from "./pakistan.ts";
import { CACHE_DIR, MAPS_DIR } from "./paths.ts";
import { source, US_ATLAS_CREDIT } from "./sources.ts";
import { EXPECTED_SEATS, INDIA, MALAYSIA, MALAYSIA_EAST, UK, US } from "./tables.ts";

const read = (id: string) => JSON.parse(readFileSync(join(CACHE_DIR, source(id).file), "utf8")) as FeatureCollection;
const admin1 = read("natural-earth-admin1");
const ne = source("natural-earth-admin1").credit;

type Props = Record<string, unknown>;
function fromAdmin1(a3: string, key: string, table: Record<string, [string, number] | [string, string, number]>): RegionFeature[] {
  const out: RegionFeature[] = [];
  for (const f of admin1.features) {
    const p = f.properties as Props;
    if (p.adm0_a3 !== a3) continue;
    const row = table[String(p[key])];
    if (!row) continue;
    const [id, name, seats] = row.length === 3 ? row : [row[0], String(p[key]), row[1]];
    out.push({ type: "Feature", properties: { id, name, seats }, geometry: f.geometry as Shape });
  }
  return out;
}

const boards: Board[] = [];

boards.push(buildBoard("uk", fromAdmin1("GBR", "region", UK), { width: 640, height: 760, pad: 20, weight: 1.2, speck: 8, small: 300 }, { credits: [ne] }));

boards.push(
  buildBoard("in", fromAdmin1("IND", "name", INDIA), { width: 760, height: 820, pad: 20, weight: 1.2, speck: 3, small: 260 }, {
    credits: [ne],
    notes: ["Placeholder outline for development only. The released India map must use official Survey of India boundaries."],
  }),
);

const malaysia = fromAdmin1("MYS", "name", MALAYSIA).map((f) => (MALAYSIA_EAST.includes(f.properties.id) ? { ...f, geometry: shiftLongitude(f.geometry, -4.6) } : f));
boards.push(
  buildBoard("my", malaysia, { width: 980, height: 520, pad: 14, weight: 0.8, speck: 3, small: 250 }, {
    credits: [ne],
    notes: ["Sabah, Sarawak and Labuan are moved closer to the peninsula to fit the screen; the sea between them is not to scale."],
  }),
);

boards.push(buildPakistan(read("geoboundaries-pak-adm2"), admin1, [source("geoboundaries-pak-adm2").credit, ne]));

const atlas = usAtlas as unknown as Topology;
const states = topo.feature(atlas, atlas.objects.states as GeometryCollection) as FeatureCollection;
const usFeatures: RegionFeature[] = states.features.flatMap((f) => {
  const row = US[String(f.id)];
  return row ? [{ type: "Feature" as const, properties: { id: row[0], name: row[1], seats: row[2] }, geometry: f.geometry as Shape }] : [];
});
boards.push(
  buildBoard("us", usFeatures, { width: 975, height: 610, pad: 10, weight: 0.6, speck: 2, small: 120, projection: geoAlbersUsa() }, {
    credits: [US_ATLAS_CREDIT],
    notes: ["Alaska and Hawaii are drawn as insets. Maine and Nebraska are played as whole states."],
  }),
);

mkdirSync(MAPS_DIR, { recursive: true });
let failed = false;
for (const b of boards) {
  const expected = EXPECTED_SEATS[b.id];
  const ok = b.seats === expected;
  if (!ok) failed = true;
  const json = JSON.stringify(b);
  writeFileSync(join(MAPS_DIR, `${b.id}.json`), json + "\n");
  const small = b.regions.filter((r) => r.small).map((r) => r.id);
  console.log(
    `${ok ? "ok  " : "FAIL"} ${b.id}: ${b.regions.length} regions, ${b.seats} seats${ok ? "" : ` (expected ${expected})`}, ${(json.length / 1024).toFixed(0)} KB, small: ${small.join(" ") || "none"}`,
  );
}
if (failed) process.exit(1);
