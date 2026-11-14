import { expect, test, type Browser, type Page } from "@playwright/test";

/** The local game server Playwright starts (packages/server, wrangler dev). */
const API = "http://127.0.0.1:8787";

type HookWindow = { __game?: { ready: boolean } };

async function device(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  return context.newPage();
}

const boards = (page: Page) => page.evaluate(() => (window as unknown as { __game: { game: { boards: unknown[] } } }).__game.game.boards.length);

/** Clicks through the recap, the summary and election night until the turn has played and the device is planning again, or at the results. */
async function catchUp(page: Page, before: number) {
  for (let i = 0; i < 400; i++) {
    if ((await page.getByTestId("results").count()) > 0) return;
    // Stage and board count read together: a turn landing between two reads would look like a finished one.
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game: { game: { stage: string; boards: unknown[] } } }).__game.game;
      return { stage: g.stage, boards: g.boards.length };
    });
    if (now.stage === "planning" && now.boards > before) return;
    for (const id of ["breaking", "skip", "continue", "night-skip", "night-done"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("device did not get back to planning");
}

test("two friends on different devices play a private match to the end", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it plays a whole match on two devices");
  test.setTimeout(300_000);
  const host = await device(browser);
  const friend = await device(browser);

  // The host sets up the table and opens a lobby.
  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await expect(host.getByRole("heading", { name: "Play with friends" })).toBeVisible();
  await host.getByTestId("start-match").click();
  await expect(host.getByTestId("lobby")).toBeVisible();
  const code = (await host.getByTestId("invite-code").textContent())!;
  expect(code).toMatch(/^[0-9A-Z]{6}$/);
  await expect(host.getByTestId("lobby-start")).toBeDisabled();
  await expect(host.getByTestId("lobby-start")).toHaveText("Waiting for 1 more friend");

  // A friend types the code (sloppily) and takes the free seat.
  await friend.goto("/");
  await friend.getByTestId("new-online").click();
  await friend.getByTestId("join-code").fill(` ${code.toLowerCase()} `);
  await friend.getByTestId("join-go").click();
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");
  await expect(friend.getByText("Waiting for the host to start")).toBeVisible();
  await expect(host.getByTestId("lobby-start")).toBeEnabled();
  await host.getByTestId("lobby-start").click();

  for (const page of [host, friend]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  // Each turn: the host sends a plan and waits; the friend's plan resolves the turn on both devices.
  let turns = 0;
  while ((await host.getByTestId("results").count()) === 0 && turns < 30) {
    const before = [await boards(host), await boards(friend)] as const;
    await host.getByTestId("submit").click();
    await expect(host.getByTestId("online-banner")).toContainText("Waiting for");
    await expect(host.getByTestId("submit")).toBeDisabled();
    await friend.getByTestId("submit").click();
    await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1])]);
    turns++;
  }
  await expect(host.getByTestId("results")).toBeVisible();
  await expect(friend.getByTestId("results")).toBeVisible();
  // Both devices agree on the result.
  const result = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as { __game: { game: { result: unknown } } }).__game.game.result));
  expect(await result(friend)).toBe(await result(host));
});

test("a turn timer moves the match on without a friend who's away, and the ongoing list shows whose move it is", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it waits out a real one-minute timer");
  test.setTimeout(240_000);
  const host = await device(browser);
  const friend = await device(browser);

  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await host.getByTestId("setup-timer").selectOption("60");
  await host.getByTestId("start-match").click();
  await expect(host.getByTestId("lobby")).toContainText("1:00 per turn");
  const code = (await host.getByTestId("invite-code").textContent())!;
  await friend.goto(`/?join=${code}`);
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");
  await host.getByTestId("lobby-start").click();
  for (const page of [host, friend]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  // The clock is running for both; only the host plans.
  await expect(friend.getByTestId("online-banner")).toContainText("Plan before the timer runs out");
  await expect(friend.getByTestId("online-banner")).toContainText(/0:\d\d left/);
  const before = [await boards(host), await boards(friend)] as const;
  await host.getByTestId("submit").click();
  await expect(host.getByTestId("online-banner")).toContainText("Waiting for");

  // A minute later the server plays the turn anyway; the friend sat it out.
  await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1])]);
  await expect(friend.getByTestId("online-banner")).toContainText("You missed the last turn");

  // The host steps out to the menu: the match is listed with their move waiting, and opens again.
  await host.goto("/");
  await host.getByTestId("open-ongoing").click();
  const row = host.getByTestId(`ongoing-${code}`);
  await expect(row).toContainText("Turn 2 · Your move!");
  await row.click();
  await host.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await expect(host.getByTestId("turn")).toContainText("Turn 2");
});
