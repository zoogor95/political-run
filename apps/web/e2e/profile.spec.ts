import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
  await page.getByRole("button", { name: "Back", exact: true }).click();

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

test("create your party: a name of your own (not a real party's), colour and emblem, offered first in every Parliamentary match", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-profile").click();
  await page.getByTestId("edit-party").click();
  const screen = page.getByTestId("create-party");
  await expect(screen).toBeVisible();
  // A real party's name is turned down.
  await page.getByTestId("party-name").fill("New Labour Party");
  await expect(page.getByTestId("party-problem")).toContainText("real party (Labour)");
  await expect(page.getByTestId("party-save")).toBeDisabled();
  await page.getByTestId("party-name").fill("Zara Rising");
  await screen.getByRole("radio", { name: "Gold" }).click();
  await screen.getByRole("radio", { name: "Lighthouse" }).click();
  await expect(page.getByTestId("party-preview")).toContainText("Zara Rising");
  await expect(page.getByTestId("party-preview")).toContainText("Lighthouse emblem");
  const axe = await new AxeBuilder({ page }).include('[data-testid="create-party"]').analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await page.getByTestId("party-save").click();
  await expect(page.getByTestId("party-save")).toHaveText("Saved!");
  await page.getByTestId("party-back").click();
  await expect(page.getByTestId("your-party")).toContainText("Zara Rising");

  // A new match starts with it.
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-uk").click();
  await expect(page.getByLabel("Player 1 party name")).toHaveValue("Zara Rising");
  await expect(page.getByRole("radio", { name: "Gold", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("save-party")).toHaveText("Saved as your party");
  // Change it in setup and save it from there.
  await page.getByLabel("Player 1 party name").fill("Zara Rising Again");
  await page.getByTestId("save-party").click();
  await expect(page.getByTestId("save-party")).toHaveText("Saved as your party");
});
