import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");
export const CACHE_DIR = join(REPO_ROOT, ".cache/map-sources");
export const MAPS_DIR = join(REPO_ROOT, "packages/content/maps");
