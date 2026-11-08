import { expect, test, type Page } from "@playwright/test";

type GameHook = {
  ready: boolean;
  game: { stage: string; state: { packId: string; turn: number }; election: { calls: { regionId: string; reserved?: boolean }[]; result: { seats: Record<string, number> } } | null };
};
type HookWindow = { __game?: GameHook };
const hook = (page: Page) => page.evaluate(() => (window as unknown as HookWindow).__game!.game);

/** Submits the turn and clicks through whatever follows until the next turn or the results. */
async function submitTurn(page: Page) {
  await page.getByTestId("submit").click();
  await page.waitForFunction(() => (window as unknown as HookWindow).__game?.game.stage !== "planning");
  for (let i = 0; i < 80; i++) {
    if ((await page.getByTestId("results").count()) > 0) return;
    const submit = page.getByTestId("submit");
    if ((await submit.count()) > 0 && (await submit.isEnabled())) {
      if ((await page.getByTestId("summary").count()) === 0 && (await page.getByTestId("night-tally").count()) === 0) return;
    }
    for (const id of ["breaking", "skip", "continue", "night-skip", "night-done"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("turn did not finish");
}

test("choose Pakistan in setup: its leaders, 336 seats, rupees and 169 for a majority", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-pk").click();
  await expect(page.getByTestId("map-pk")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("setup")).toContainText("Pakistan · Parliamentary · 336 seats");
  await expect(page.getByLabel("Player 1 leader")).toHaveValue("shehbaz-sharif");
  await page.getByTestId("start-match").click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  expect((await hook(page)).state.packId).toBe("pk");
  await expect(page.getByTestId("turn")).toContainText("Pakistan");
  await expect(page.locator(".topbar")).toContainText("169 FOR A MAJORITY");
  await expect(page.locator("body")).toContainText("Rs ");

  // Back on the setup screen the last map is still chosen, and the UK brings its own leaders back.
  await page.getByTestId("menu-button").click();
  await page.getByTestId("new-solo").click();
  await expect(page.getByTestId("map-pk")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("map-uk").click();
  await expect(page.getByLabel("Player 1 leader")).toHaveValue("keir-starmer");
});

test("a whole Pakistan match: reserved seats are declared last and the count reaches 336", async ({ page }) => {
  test.setTimeout(300_000); // a whole 96-region match, recaps and election night included
  await page.goto("/?map=pk&seed=5&ai=easy");
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  for (let i = 0; i < 60 && (await page.getByTestId("results").count()) === 0; i++) await submitTurn(page);
  await expect(page.getByTestId("results")).toBeVisible();
  const night = (await hook(page)).election!;
  expect(Object.values(night.result.seats).reduce((a, b) => a + b, 0)).toBe(336);
  const reserved = night.calls.filter((c) => c.reserved).map((c) => c.regionId);
  expect(reserved).toEqual(["women-punjab", "women-sindh", "women-kp", "women-balochistan", "non-muslims"]);
  expect(night.calls.slice(-5).every((c) => c.reserved)).toBe(true);
});
