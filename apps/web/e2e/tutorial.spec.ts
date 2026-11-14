import { expect, test, type Page } from "@playwright/test";

type HookWindow = { __game?: { ready: boolean; game: { stage: string; state: { turn: number } } } };
const coach = (page: Page) => page.getByTestId("coach");
const turn = (page: Page) => page.evaluate(() => (window as unknown as HookWindow).__game!.game.state.turn);

/** Clicks through the BREAKING card, recap and summary until the next turn is ready to plan. */
async function finishTurn(page: Page) {
  await page.waitForFunction(() => (window as unknown as HookWindow).__game?.game.stage !== "planning");
  for (let i = 0; i < 80; i++) {
    if ((await page.evaluate(() => (window as unknown as HookWindow).__game!.game.stage)) === "planning") return;
    for (const id of ["breaking", "skip", "continue"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("turn did not finish");
}

async function addRegion(page: Page, id: string) {
  await page.getByTestId("tab-plan").click();
  await page.getByTestId("find-region").selectOption(id);
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();
}

test("a new player follows the coach from the menu to the end of Learn to play", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  // First visit: Learn to play leads the menu.
  const learn = page.getByTestId("learn");
  await expect(learn).toContainText("New here?");
  await learn.click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  await expect(coach(page)).toContainText("Win the most seats");
  await expect(page.getByTestId("tally")).toHaveAttribute("data-coach", "on");
  // The card shrinks to a bar so it doesn't hide the map, and opens again on request.
  await page.getByTestId("coach-hide").click();
  await expect(page.getByTestId("coach-show")).toContainText("Win the most seats");
  await page.getByTestId("coach-show").click();
  await page.getByTestId("coach-next").click();

  await expect(coach(page)).toContainText("Pick a region");
  await page.getByTestId("find-region").selectOption("lon");
  await expect(coach(page)).toContainText("Campaign there");
  // Nothing is planned until + is pressed; each press plans one more step.
  await expect(page.getByTestId("target")).toHaveText("Step 0");
  await page.getByRole("button", { name: "One step more" }).click();
  await page.getByRole("button", { name: "One step more" }).click();
  await expect(page.getByTestId("target")).toHaveText("Step 2");
  await page.getByRole("button", { name: "Close" }).click();

  await expect(coach(page)).toContainText("Spread your money");
  await addRegion(page, "nw");
  await addRegion(page, "se");

  await expect(coach(page)).toContainText("Reveal your plan");
  await expect(page.getByTestId("submit")).toHaveAttribute("data-coach", "on");
  await page.getByTestId("submit").click();
  await finishTurn(page);

  await expect(coach(page)).toContainText("Groups pay income");
  await page.getByTestId("tab-groups").click();
  await expect(coach(page)).toContainText("Voter groups");
  await page.getByTestId("groups-panel").getByText("Trade unions").click();
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(coach(page)).toContainText("When the campaign ends");
  await page.getByTestId("coach-next").click();
  await expect(coach(page)).toContainText("Play a few turns");
  while ((await turn(page)) < 5) {
    await addRegion(page, (await turn(page)) % 2 ? "ee" : "wm");
    await page.getByTestId("submit").click();
    await finishTurn(page);
  }

  await expect(coach(page)).toContainText("Pick a party member");
  await page.getByTestId("tab-party").click();
  await page.getByTestId("pick").selectOption({ index: 1 });
  await expect(coach(page)).toContainText("Send them out");
  await page.getByTestId("party-panel").locator('select[data-testid^="assign-"]').first().selectOption({ index: 1 });

  await expect(coach(page)).toContainText("You're ready");
  await page.getByTestId("coach-next").click();
  await expect(coach(page)).toHaveCount(0);
  await expect(page.getByTestId("achievement-toast")).toContainText("First steps");

  // Done: the menu no longer leads with it, and the match carries on from the menu.
  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("learn")).not.toContainText("New here?");
  await expect(page.getByTestId("continue-match")).toBeVisible();
  // The profile shows the achievement and the turns played.
  await page.getByTestId("open-profile").click();
  await expect(page.getByTestId("ach-first-steps")).toHaveAttribute("aria-label", "First steps: unlocked");
  await expect(page.getByTestId("profile")).toContainText("Turns played");
});

test("the tutorial survives a reload and can be skipped", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("learn").click();
  await page.getByTestId("coach-next").click();
  await expect(coach(page)).toContainText("Pick a region");
  await page.reload();
  await page.getByTestId("continue-match").click();
  await expect(coach(page)).toContainText("Pick a region");
  await page.getByTestId("coach-skip").click();
  await expect(coach(page)).toHaveCount(0);
  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("learn")).toHaveText("Tutorial");
});
