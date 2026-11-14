import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type GameHook = { ready: boolean; view: { piecePoint(id: string): { x: number; y: number }; app: { canvas: HTMLCanvasElement } } };
type HookWindow = { __game?: GameHook };

async function boardReady(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
}

async function tapRegion(page: Page, id: string) {
  const p = await page.evaluate((rid) => {
    const v = (window as unknown as HookWindow).__game!.view;
    const q = v.piecePoint(rid);
    const r = v.app.canvas.getBoundingClientRect();
    return { x: r.left + q.x, y: r.top + q.y };
  }, id);
  if (test.info().project.name === "phone") await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Clicks through the recap, summary (and hand-off) after a submit. */
async function finishTurn(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __game?: { game: { stage: string } } }).__game?.game.stage !== "planning");
  for (let i = 0; i < 60; i++) {
    const stage = await page.evaluate(() => (window as unknown as { __game: { game: { stage: string } } }).__game.game.stage);
    if (stage === "planning" || stage === "handoff") return stage;
    for (const id of ["breaking", "skip", "continue"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("turn did not finish");
}

test("the luck factor is chosen at setup and kept with the match", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("setup-luck").check();
  await page.getByTestId("start-match").click();
  await boardReady(page);
  await expect(page.getByTestId("tally")).toContainText("luck factor on");
  await page.reload();
  await page.getByTestId("continue-match").click();
  await boardReady(page);
  await expect(page.getByTestId("tally")).toContainText("luck factor on");
});

test("solo setup: choose the table, start, and the match survives closing the browser", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByTestId("main-menu")).toBeVisible();
  await expect(page.getByTestId("continue-match")).toHaveCount(0);
  await page.getByTestId("new-solo").click();
  await expect(page.getByTestId("setup")).toBeVisible();

  // First come, first served: a colour already taken by another seat can't be picked.
  const you = page.getByTestId("seat-you");
  await expect(you.getByRole("radio", { name: /taken by/ }).first()).toBeDisabled();
  await page.getByTestId("seat-ai2").getByLabel(/difficulty/).selectOption("easy");
  await page.getByTestId("add-seat").click();
  await expect(page.locator("[data-testid^=seat-]")).toHaveCount(4);
  await expect(page.getByTestId("setup-luck")).not.toBeChecked();
  await page.getByTestId("start-match").click();
  await boardReady(page);
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await expect(page.getByTestId("tally")).toContainText("Projected seats"); // luck factor off

  // Play a turn, start planning the next, then close the browser.
  await tapRegion(page, "lon");
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("submit").click();
  await finishTurn(page);
  await expect(page.getByTestId("turn")).toContainText("Turn 2");
  await page.getByTestId("find-region").selectOption("nw");
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();
  const storage = await page.context().storageState();
  await page.close();

  // Another day: a fresh browser with the same saved data.
  const later = await browser.newContext({ storageState: storage, baseURL: "http://localhost:4173" });
  const again = await later.newPage();
  await again.goto("/");
  await expect(again.getByTestId("continue-match")).toContainText("Turn 2");
  await again.getByTestId("continue-match").click();
  await boardReady(again);
  await expect(again.getByTestId("turn")).toContainText("Turn 2");
  await expect(again.getByTestId("plan-list")).toContainText("North West");
  await expect(again.getByTestId("rivals-panel").or(again.getByTestId("tab-rivals"))).toBeVisible();
  await again.getByTestId("tab-rivals").click();
  await expect(again.getByTestId("rivals-panel")).toContainText("AI · Easy");
  await later.close();
});

test("pass and play: each player plans in secret behind a hand-off screen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-hotseat").click();
  await expect(page.locator("[data-testid^=seat-]")).toHaveCount(3);
  await page.getByTestId("start-match").click();
  await boardReady(page);

  await expect(page.getByTestId("handoff")).toContainText("Pass the device to Player 1");
  await page.getByTestId("ready").click();
  await tapRegion(page, "sco");
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("plan-list")).toContainText("Scotland");
  await page.getByTestId("submit").click();

  // Player 2 can't see Player 1's plan.
  await expect(page.getByTestId("handoff")).toContainText("Pass the device to Player 2");
  await page.getByTestId("ready").click();
  await expect(page.getByTestId("plan-list")).toHaveCount(0);
  await page.getByTestId("submit").click();

  // Both submitted: the turn resolves for everyone, then it's Player 1's turn again.
  await expect(page.getByTestId("handoff")).toHaveCount(0);
  const stage = await finishTurn(page);
  expect(stage).toBe("handoff");
  await expect(page.getByTestId("handoff")).toContainText("Pass the device to Player 1");
  await expect(page.getByTestId("handoff")).toContainText("turn 2");
});

test("settings are remembered: volumes, ticker, text size and motion", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-settings").click();
  await page.getByTestId("music-volume").fill("0");
  await page.getByTestId("sound-volume").fill("40");
  await page.getByTestId("setting-ticker").uncheck();
  await page.getByTestId("text-size").selectOption("1.3");
  await page.getByTestId("motion").selectOption("reduced");
  await page.getByTestId("close-settings").click();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"))).toBe("1.3");
  expect(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion"))).toBe(true);

  await page.reload();
  await page.getByTestId("open-settings").click();
  await expect(page.getByTestId("music-volume")).toHaveValue("0");
  await expect(page.getByTestId("sound-volume")).toHaveValue("40");
  await expect(page.getByTestId("setting-ticker")).not.toBeChecked();
  await page.getByTestId("close-settings").click();
  await page.getByTestId("new-solo").click();
  await page.getByTestId("start-match").click();
  await boardReady(page);
  await expect(page.getByTestId("ticker")).toHaveCount(0);
  await expect(page.getByTestId("ticker-show")).toBeVisible();
});

test("no serious accessibility problems on the menu, setup and game screens", async ({ page }) => {
  const check = async (name: string) => {
    const results = await new AxeBuilder({ page }).exclude("canvas").analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${name}: ${v.id} ${v.help}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.any.map((a) => a.message).join(" ")}`).join("; ")}`)).toEqual([]);
  };
  await page.goto("/");
  await check("menu");
  await page.getByTestId("new-solo").click();
  await check("setup");
  await page.getByTestId("start-match").click();
  await boardReady(page);
  await check("game");
});
