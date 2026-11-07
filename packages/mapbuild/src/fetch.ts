/** Downloads every boundary file into .cache/map-sources and checks its hash. Files already present and correct are kept. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCES } from "./sources.ts";
import { CACHE_DIR } from "./paths.ts";

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

mkdirSync(CACHE_DIR, { recursive: true });
for (const s of SOURCES) {
  const path = join(CACHE_DIR, s.file);
  if (existsSync(path) && sha256(readFileSync(path)) === s.sha256) {
    console.log(`ok      ${s.file}`);
    continue;
  }
  console.log(`fetch   ${s.url}`);
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`${s.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== s.sha256) throw new Error(`${s.file}: expected sha256 ${s.sha256}, got ${got}`);
  writeFileSync(path, buf);
  console.log(`saved   ${s.file} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
