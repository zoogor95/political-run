import { expect, test, type Page } from "@playwright/test";

type HookWindow = { __game?: { ready: boolean; game: { stage: string } } };

async function finishTurn(page: Page) {
  await page.waitForFunction(() => (window as unknown as HookWindow).__game?.game.stage !== "planning");
  for (let i = 0; i < 120; i++) {
    if ((await page.getByTestId("results").count()) > 0) return;
    if ((await page.evaluate(() => (window as unknown as HookWindow).__game!.game.stage)) === "planning") return;
    for (const id of ["breaking", "skip", "continue", "night-skip", "night-done"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("turn did not finish");
}

test("a finished match counts in the profile's stats", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByTestId("open-profile").click();
  await expect(page.getByTestId("profile")).toContainText("Achievements · 0 of 18");
  await page.getByLabel("Your name").fill("Zoogor");
  await page.getByRole("button", { name: "Back" }).click();

  // An empty campaign: the computer parties win, and the match still counts as played.
  await page.goto("/?seed=11&ai=easy");
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  for (let i = 0; i < 60 && (await page.getByTestId("results").count()) === 0; i++) {
    await page.getByTestId("submit").click();
    await finishTurn(page);
  }
  await expect(page.getByTestId("results")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("open-profile").click();
  const profile = page.getByTestId("profile");
  await expect(page.getByLabel("Your name")).toHaveValue("Zoogor");
  await expect(profile.locator(".stat", { hasText: "Matches" })).toContainText("1");
  await expect(profile.locator(".stat", { hasText: "Wins" })).toContainText("0");
  await expect(profile).toContainText("United Kingdom 0 won of 1");
});
