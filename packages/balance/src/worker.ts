/** Plays a slice of the schedule on its own thread and sends each record back. */
import { parentPort, workerData } from "node:worker_threads";
import type { MapPack } from "@majority-map/core";
import { playMatch, type ScheduledMatch } from "./sim.js";

const { pack, matches, luck } = workerData as { pack: MapPack; matches: ScheduledMatch[]; luck: boolean };
for (const m of matches) parentPort!.postMessage(playMatch(pack, m.entrants, m.seed, luck));
