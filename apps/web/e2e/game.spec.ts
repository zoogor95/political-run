import { expect, test, type Page } from "@playwright/test";

type GameHook = {
  ready: boolean;
  view: { piecePoint(id: string): { x: number; y: number }; app: { canvas: HTMLCanvasElement } };
  game: { state: { turn: number; phase: string } };
};
type HookWindow = { __game?: GameHook };

async function start(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?seed=42&ai=easy");
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  return errors;
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

/** Submits the turn and clicks through the BREAKING card, the recap and the summary back to planning. */
async function submitTurn(page: Page) {
  await page.getByTestId("submit").click();
  const breaking = page.getByTestId("breaking");
  if (await breaking.isVisible().catch(() => false)) await breaking.click();
  const skip = page.getByTestId("skip");
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByTestId("continue").click();
}

const turn = (page: Page) => page.evaluate(() => (window as unknown as HookWindow).__game!.game.state.turn);

test("plan steps in a region, submit, and the AI plays its turn", async ({ page }) => {
  const errors = await start(page);
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await tapRegion(page, "lon");
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("London");
  await page.getByTestId("add-to-plan").click();
  await expect(page.getByTestId("target")).toHaveText("Step 1");
  await page.getByRole("button", { name: "One step more" }).click();
  await expect(page.getByTestId("target")).toHaveText("Step 2");
  // First entry is capped at 2 steps.
  await expect(page.getByRole("button", { name: "One step more" })).toBeDisabled();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("plan-list")).toContainText("London");
  await expect(page.getByTestId("plan-list")).toContainText("0 → 2");

  await submitTurn(page);
  await expect(page.getByTestId("turn")).toContainText("Turn 2");
  await expect(page.getByTestId("last-turn")).toBeVisible();
  await expect(page.getByTestId("plan-list")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("pick a party member on turn 5 and assign them to a region you've entered", async ({ page }) => {
  await start(page);
  await tapRegion(page, "nw");
  await page.getByTestId("add-to-plan").click();
  await page.getByRole("button", { name: "Close" }).click();
  for (let t = 1; t < 5; t++) await submitTurn(page);
  expect(await turn(page)).toBe(5);

  await page.getByTestId("tab-party").click();
  // Pick someone, assign them, then change your mind: the plan must stay valid.
  await page.getByTestId("pick").selectOption("wes-streeting");
  await page.getByTestId("assign-wes-streeting").selectOption({ index: 1 });
  await page.getByTestId("pick").selectOption("angela-rayner");
  await expect(page.getByTestId("submit")).toBeEnabled();
  const assign = page.getByTestId("assign-angela-rayner");
  await expect(assign).toBeVisible();
  const options = await assign.locator("option").allTextContents();
  const target = options.find((o) => o !== "Assign to…")!;
  await assign.selectOption({ label: target });
  await submitTurn(page);
  await page.getByTestId("tab-party").click();
  await expect(page.getByTestId("party-panel")).toContainText("Angela Rayner");
  await expect(page.getByTestId("party-panel")).toContainText(`${target} · free pip in 3 turns`);
});

test("national groups open their own meter from the groups view", async ({ page }) => {
  await start(page);
  await page.getByTestId("tab-groups").click();
  await page.getByTestId("groups-panel").getByText("Trade unions").click();
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("Trade unions");
  await page.getByTestId("add-to-plan").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("tab-plan").click();
  await expect(page.getByTestId("plan-list")).toContainText("Trade unions");
});

test("rival view and a whole match through to the results", async ({ page }) => {
  await start(page);
  await submitTurn(page);
  await page.getByTestId("tab-rivals").click();
  await page.getByTestId("rivals-panel").getByRole("button", { name: "Show what they lead" }).first().click();
  await expect(page.getByTestId("rivals-panel").getByRole("button", { name: "Hide on map" })).toBeVisible();

  // Keep submitting empty plans; the AIs carry the campaign to election night.
  for (let i = 0; i < 60 && (await page.getByTestId("results").count()) === 0; i++) await submitTurn(page);
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(page.getByTestId("results")).toContainText("wins the most seats");
  await expect(page.getByTestId("match-headline")).toContainText("HEADLINE OF THE MATCH");
  await page.getByTestId("level").selectOption("hard");
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await page.getByTestId("tab-rivals").click();
  await expect(page.getByTestId("rivals-panel")).toContainText("AI · Hard");
});

test("after a turn: BREAKING card, region-by-region recap, then the turn summary", async ({ page }) => {
  const errors = await start(page);
  await expect(page.getByTestId("ticker")).toContainText(/\w/);
  await tapRegion(page, "lon");
  await page.getByTestId("add-to-plan").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("submit").click();

  // Winning London's region group is big news.
  await expect(page.getByTestId("breaking")).toContainText("BREAKING");
  await page.getByTestId("breaking").click();

  // The recap reveals changed regions one at a time; the top bar still shows the turn being recapped.
  await expect(page.getByTestId("recap-card")).toBeVisible();
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await page.getByRole("button", { name: "2× speed" }).click();
  await expect(page.getByRole("button", { name: "2× speed" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByTestId("recap")).toContainText(/1 \/ \d+/);
  await page.getByTestId("skip").click();

  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("Turn 1 summary");
  await expect(summary).toContainText("HEADLINE OF THE TURN");
  await expect(summary).toContainText("Zoogor Party (you)");
  await expect(page.getByTestId("income")).toContainText("Base");
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("turn")).toContainText("Turn 2");

  // The summary can be reopened from the plan tab, and the ticker now carries this turn's news.
  await page.getByTestId("open-summary").click();
  await expect(summary).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("ticker")).toContainText("London");
  expect(errors).toEqual([]);
});

test("the ticker can be hidden, and stays hidden after a reload", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Hide the news ticker" }).click();
  await expect(page.getByTestId("ticker")).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready));
  await expect(page.getByTestId("ticker")).toHaveCount(0);
  await page.getByTestId("ticker-show").click();
  await expect(page.getByTestId("ticker")).toBeVisible();
});
