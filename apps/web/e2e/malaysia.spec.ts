import { expect, test } from "@playwright/test";

type HookWindow = { __game?: { ready: boolean; game: { state: { packId: string } } } };

test("choose Malaysia in setup: its leaders, 222 seats, ringgit and 112 for a majority", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-my").click();
  await expect(page.getByTestId("map-my")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("setup")).toContainText("Malaysia · Parliamentary · 222 seats");
  await expect(page.getByTestId("pick-leader-you")).toHaveAttribute("data-leader", "anwar-ibrahim");
  await page.getByTestId("start-match").click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as HookWindow).__game!.game.state.packId)).toBe("my");
  await expect(page.getByTestId("turn")).toContainText("Malaysia");
  await expect(page.locator(".topbar")).toContainText("112 FOR A MAJORITY");
  await expect(page.locator("body")).toContainText("RM ");
});
