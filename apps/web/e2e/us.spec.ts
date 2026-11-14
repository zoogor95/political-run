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

test("choose the United States: candidates run under their real party, 538 electoral votes and 270 to win", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-us").click();
  await expect(page.getByTestId("setup")).toContainText("United States · Presidential · 538 electoral votes");
  // No party names, colours or emblems to choose: each seat is a candidate in a shade of their party's colour.
  await expect(page.getByLabel("Player 1 party name")).toHaveCount(0);
  await expect(page.getByTestId("seat-party-you")).toContainText("Runs as an Independent"); // George Washington
  await page.getByLabel("Player 1 leader").selectOption("abraham-lincoln");
  await expect(page.getByTestId("seat-party-you")).toContainText("Runs as the Republican candidate");
  await expect(page.getByTestId("setup-luck")).toHaveCount(0);
  await expect(page.getByTestId("setup-issues")).toHaveCount(0);
  await page.getByTestId("start-match").click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  expect((await hook(page)).state.packId).toBe("us");
  await expect(page.locator(".topbar")).toContainText("270 TO WIN");
  await expect(page.getByTestId("tally")).toContainText("Electoral votes if the election were today");
  await expect(page.locator("body")).toContainText("$");
  await page.getByTestId("tab-party").click();
  await expect(page.getByTestId("party-panel")).toContainText("You pick a running mate on turn 5.");

  // Back to a Parliamentary map: parties are back.
  await page.getByTestId("menu-button").click();
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-uk").click();
  await expect(page.getByLabel("Player 1 party name")).toHaveValue("Zoogor Party");
});

test("a whole US match: a running mate on turn 5, states called on election night, and a president", async ({ page }) => {
  test.setTimeout(400_000); // 51 states, possibly several counts
  await page.goto("/?map=us&seed=5&ai=easy");
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  for (let i = 0; i < 4; i++) await submitTurn(page);
  expect((await hook(page)).state.turn).toBe(5);
  await page.getByTestId("tab-party").click();
  await page.getByTestId("pick").selectOption({ index: 1 });
  await submitTurn(page);
  await page.getByTestId("tab-party").click();
  await expect(page.getByTestId("running-mate")).toBeVisible();

  // Play on (spending nothing) until the race is decided; you may be eliminated and watch the end.
  let sawCall = false;
  for (let i = 0; i < 80 && (await page.getByTestId("results").count()) === 0; i++) {
    if ((await page.getByTestId("submit").count()) === 0) {
      const banner = page.getByTestId("call-banner");
      if (await banner.isVisible().catch(() => false)) sawCall = sawCall || /electoral votes/.test(await banner.innerText());
      for (const id of ["breaking", "skip", "continue", "night-skip", "night-done"]) {
        const el = page.getByTestId(id);
        if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
      }
      await page.waitForTimeout(150);
      continue;
    }
    await submitTurn(page);
  }
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(page.getByTestId("race")).toContainText("270 electoral votes to win");
  const night = (await hook(page)).election!;
  const winner = Object.entries(night.result.seats).sort((a, b) => b[1] - a[1])[0]!;
  expect(winner[1] >= 270 || (await page.getByTestId("race").innerText()).includes("eliminated")).toBe(true);
  expect(night.calls.every((c) => !c.reserved)).toBe(true);
  expect(night.calls[0]!.regionId).toBe("ga"); // polls close first in the East
  expect(sawCall || night.calls.length === 51).toBe(true);
});

test("the US setup lines up: the create button sits level with the candidate box", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-solo").click();
  await page.getByTestId("map-us").click();
  await expect(page.getByTestId("add-seat")).toContainText("Add a computer candidate");
  const select = await page.getByLabel("Player 1 leader").boundingBox();
  const button = await page.getByTestId("create-candidate-you").boundingBox();
  expect(Math.abs(select!.y + select!.height - (button!.y + button!.height))).toBeLessThanOrEqual(2);
});
