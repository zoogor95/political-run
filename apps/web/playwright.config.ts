import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://localhost:4173" },
  webServer: [
    { command: "pnpm build && pnpm preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    // The game server with a local database, for the online tests (e2e/online.spec.ts).
    {
      command: "cd ../../packages/server && pnpm exec wrangler d1 migrations apply majority-map --local && pnpm exec wrangler dev --port 8787 --ip 127.0.0.1",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { CI: "1", WRANGLER_SEND_METRICS: "false" },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7 landscape"] } },
  ],
});
