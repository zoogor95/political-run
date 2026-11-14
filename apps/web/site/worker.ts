/**
 * The game's public web site: a Worker serving the built game (packed into files.gen.ts by build.mjs). Hashed assets
 * are cached for good; the page itself is always fresh, so a new deploy reaches players on their next visit.
 */
import files from "./files.gen";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export default {
  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    // Any page path is the game (it reads ?join= and the like itself); missing assets are a real 404.
    const path = files[url.pathname] ? url.pathname : url.pathname.startsWith("/assets/") ? null : "/index.html";
    const file = path ? files[path] : undefined;
    if (!path || !file) return new Response("Not found", { status: 404 });
    const type = TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream";
    const headers = {
      "content-type": type,
      "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    };
    return new Response(req.method === "HEAD" ? null : file.text ?? bytes(file.base64!), { headers });
  },
};
