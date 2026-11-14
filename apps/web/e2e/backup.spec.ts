import { expect, test, type BrowserContext } from "@playwright/test";

/** A stand-in for the game's API, kept in memory and shared by every "device" (browser context) in a test. */
function fakeServer() {
  type Account = { name: string; settings: unknown; stats: unknown; achievements: Record<string, number> };
  const byKey = new Map<string, Account>();
  const byToken = new Map<string, Account>();
  let n = 0;
  const view = (a: Account) => ({
    account: { displayName: a.name },
    settings: a.settings,
    party: null,
    stats: a.stats,
    achievements: Object.entries(a.achievements).map(([code, unlockedAt]) => ({ code, unlockedAt })),
  });
  return {
    byKey,
    async attach(context: BrowserContext) {
      await context.route("**/api/**", async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const body = (req.postData() ? JSON.parse(req.postData()!) : {}) as Record<string, unknown>;
        const reply = (status: number, json: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
        if (req.method() === "POST" && path === "/api/accounts/device") {
          let a = byKey.get(body.key as string);
          if (!a && body.create === false) return reply(404, { error: { code: "no_account", message: "No such profile" } });
          const created = !a;
          if (!a) byKey.set(body.key as string, (a = { name: (body.displayName as string) ?? "Player 1234", settings: null, stats: null, achievements: {} }));
          const token = `t${++n}`;
          byToken.set(token, a);
          return reply(created ? 201 : 200, { token, created, ...view(a) });
        }
        const a = byToken.get((req.headers().authorization ?? "").replace("Bearer ", ""));
        if (!a) return reply(401, { error: { code: "unauthorized", message: "Sign in" } });
        if (req.method() === "GET" && path === "/api/me") return reply(200, view(a));
        if (req.method() === "PUT" && path === "/api/me") a.name = body.displayName as string;
        else if (path === "/api/me/settings") a.settings = body.settings;
        else if (path === "/api/me/stats") a.stats = body.stats;
        else if (path === "/api/me/achievements") for (const x of body.achievements as { code: string; unlockedAt: number }[]) a.achievements[x.code] = Math.min(a.achievements[x.code] ?? Infinity, x.unlockedAt);
        else if (path === "/api/sessions/end") byToken.forEach((v, k) => v === a && k === req.headers().authorization?.slice(7) && byToken.delete(k));
        else if (req.method() === "DELETE" && path === "/api/me") {
          byToken.forEach((v, k) => v === a && byToken.delete(k));
          byKey.forEach((v, k) => v === a && byKey.delete(k));
        } else return reply(404, { error: { code: "not_found", message: "?" } });
        return reply(200, { ok: true, ...view(a) });
      });
    },
  };
}

test("backs a profile up, restores it on another device with the recovery code, and keeps both in step", async ({ browser, page, context }) => {
  test.setTimeout(90_000);
  const server = fakeServer();
  await server.attach(context);

  // Device one: a name and an achievement, then turn backup on.
  await page.addInitScript(() => {
    if (!localStorage.getItem("mm.profile.v1")) localStorage.setItem("mm.profile.v1", JSON.stringify({ name: "", stats: {}, unlocked: { "first-steps": 1_700_000_000_000 } }));
  });
  await page.goto("/");
  await page.getByTestId("open-profile").click();
  await page.getByLabel("Your name").fill("Zoogor");
  await expect(page.getByTestId("backup")).toContainText("Your profile lives in this browser only");
  await page.getByTestId("backup-on").click();
  const code = (await page.getByTestId("recovery-code").textContent())!;
  expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  await expect(page.getByTestId("profile")).toContainText("Backed up online");
  await expect(page.getByTestId("backup-status")).toContainText("Backed up · last synced");
  const online = [...server.byKey.values()][0]!;
  expect(online.name).toBe("Zoogor");
  expect(online.achievements["first-steps"]).toBe(1_700_000_000_000);

  // Device two: a mistyped code is refused; the real one, typed sloppily, brings the profile back.
  const other = await browser.newContext();
  await server.attach(other);
  const page2 = await other.newPage();
  await page2.goto("/");
  await page2.getByTestId("open-profile").click();
  await page2.getByTestId("restore-open").click();
  await page2.getByTestId("restore-code").fill("00000-00000-00000-00000-00000");
  await page2.getByTestId("restore-go").click();
  await expect(page2.getByRole("alert")).toContainText("No profile has that recovery code");
  await page2.getByTestId("restore-code").fill(code.toLowerCase().replace(/-/g, " "));
  await page2.getByTestId("restore-go").click();
  await expect(page2.getByLabel("Your name")).toHaveValue("Zoogor");
  await expect(page2.getByTestId("ach-first-steps")).toHaveAttribute("aria-label", /unlocked/);
  await expect(page2.getByTestId("profile")).toContainText("Backed up online");

  // A change on device two goes up by itself, and device one picks it up when it next opens.
  await page2.getByLabel("Your name").fill("Zoogor the Great");
  await expect.poll(() => online.name, { timeout: 10_000 }).toBe("Zoogor the Great");
  await page.reload();
  await page.getByTestId("open-profile").click();
  await expect(page.getByLabel("Your name")).toHaveValue("Zoogor the Great");

  // Deleting the backup turns it off everywhere; this device keeps its own copy.
  await page2.getByTestId("backup-delete").click();
  await page2.getByTestId("backup-delete-yes").click();
  await expect(page2.getByTestId("backup-on")).toBeVisible();
  await expect(page2.getByLabel("Your name")).toHaveValue("Zoogor the Great");
  expect(server.byKey.size).toBe(0);
  await other.close();
});
