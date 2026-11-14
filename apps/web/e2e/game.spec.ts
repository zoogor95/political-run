import { expect, test, type Page } from "@playwright/test";

type GameHook = {
  ready: boolean;
  view: { piecePoint(id: string): { x: number; y: number }; app: { canvas: HTMLCanvasElement } };
  game: { state: { turn: number; phase: string }; election: { result: { seats: Record<string, number> } } | null };
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

/** Submits the turn and clicks through whatever follows (BREAKING card, recap, summary, election night) until the next turn or the results. */
async function submitTurn(page: Page) {
  await page.getByTestId("submit").click();
  // Wait until the turn has really left planning, so a not-yet-rendered recap isn't mistaken for the next turn.
  await page.waitForFunction(() => (window as unknown as { __game?: { game: { stage: string } } }).__game?.game.stage !== "planning");
  for (let i = 0; i < 80; i++) {
    if ((await page.getByTestId("results").count()) > 0) return;
    // Back to planning: Submit is on the page and enabled. (isEnabled would wait for a missing button, so count first.)
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

const turn = (page: Page) => page.evaluate(() => (window as unknown as HookWindow).__game!.game.state.turn);

test("plan steps in a region, submit, and the AI plays its turn", async ({ page }) => {
  const errors = await start(page);
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await tapRegion(page, "lon");
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("London");
  // One control: nothing is planned until + is pressed, − takes steps back, and Remove clears the region.
  await expect(page.getByTestId("target")).toHaveText("Step 0");
  await expect(page.getByTestId("step-down")).toBeDisabled();
  await page.getByTestId("step-up").click();
  await expect(page.getByTestId("target")).toHaveText("Step 1");
  await page.getByRole("button", { name: "One step more" }).click();
  await expect(page.getByTestId("target")).toHaveText("Step 2");
  // First entry is capped at 2 steps.
  await expect(page.getByRole("button", { name: "One step more" })).toBeDisabled();
  await page.getByTestId("step-down").click();
  await page.getByTestId("step-down").click();
  await expect(page.getByTestId("target")).toHaveText("Step 0");
  await expect(page.getByTestId("remove-steps")).toHaveCount(0);
  await page.getByTestId("step-up").click();
  await page.getByTestId("step-up").click();
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
  await page.getByTestId("step-up").click();
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

test("a region group lights up its regions on the board, and a region card lists its groups", async ({ page }) => {
  await start(page);
  await page.getByTestId("tab-groups").click();
  const north = page.getByTestId("group-row-north");
  await north.click();
  await expect(north).toHaveAttribute("aria-pressed", "true");
  // Its card over the board: income, each party's share of the group's cost, and what it takes to win it.
  const detail = page.getByTestId("group-detail");
  await expect(detail).toContainText("The North");
  await expect(detail).toContainText("MORE THAN 50% CONTROLS IT");
  await expect(detail).toContainText(/To take control|You control it/);
  // The North's regions stand out; the others fade.
  const fills = await page.evaluate(() => {
    const v = (window as unknown as { __game: { view: { styles?: Record<string, { fill: number }> } } }).__game.view;
    return v.styles ? { ne: v.styles.ne!.fill, lon: v.styles.lon!.fill } : null;
  });
  if (fills) expect(fills.ne).not.toBe(fills.lon);
  await north.click();
  await expect(north).toHaveAttribute("aria-pressed", "false");
  await expect(detail).toHaveCount(0);
  await page.getByTestId("tab-plan").click();
  await page.getByTestId("find-region").selectOption("yh");
  await expect(page.getByTestId("region-groups")).toContainText("The North");
  await expect(page.getByTestId("region-groups")).toContainText("Big cities");
  await expect(page.getByTestId("region-groups")).not.toContainText("Trade unions");
});

test("national groups open their own meter from the groups view", async ({ page }) => {
  await start(page);
  await page.getByTestId("tab-groups").click();
  await page.getByTestId("groups-panel").getByText("Trade unions").click();
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("Trade unions");
  await page.getByTestId("step-up").click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("tab-plan").click();
  await expect(page.getByTestId("plan-list")).toContainText("Trade unions");
});

test("rival view and a whole match through to the results", async ({ page }) => {
  test.setTimeout(180_000); // a whole match, recaps and election night included
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
  await expect(page.getByTestId("race").or(page.getByTestId("ranks"))).toBeVisible(); // the ranking cards
  await page.getByTestId("level").selectOption("hard");
  await page.getByRole("button", { name: "Rematch" }).click();
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
  await page.getByTestId("tab-rivals").click();
  await expect(page.getByTestId("rivals-panel")).toContainText("AI · Hard");
});

test("after a turn: BREAKING card, region-by-region recap, then the turn summary", async ({ page }) => {
  const errors = await start(page);
  await expect(page.getByTestId("ticker")).toContainText(/\w/);
  await tapRegion(page, "lon");
  await page.getByTestId("step-up").click();
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
  // At 2× the recap moves on quickly, so record every step it shows from the moment Replay is clicked (and only from
  // then): it must start again from the first region.
  await page.evaluate(() => {
    const w = window as unknown as { __recapSteps: string[] };
    w.__recapSteps = [];
    let armed = false;
    const el = document.querySelector('[data-testid="recap"]')!;
    const replay = [...el.querySelectorAll("button")].find((b) => b.textContent === "Replay")!;
    // Pressed while the recap is already on its first region, nothing on screen changes: record the step it shows.
    const current = () => el.textContent?.match(/(\d+) \/ \d+/)?.[1] ?? "";
    replay.addEventListener(
      "click",
      () => {
        armed = true;
        setTimeout(() => w.__recapSteps.length === 0 && w.__recapSteps.push(current()), 0);
      },
      { capture: true },
    );
    new MutationObserver(() => {
      if (armed) w.__recapSteps.push(current());
    }).observe(el, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole("button", { name: "Replay" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __recapSteps: string[] }).__recapSteps[0])).toBe("1");
  await page.getByTestId("skip").click();

  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("End of turn 1");
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

async function toElectionNight(page: Page, scenario: string) {
  await page.goto(`/?scenario=${scenario}&ai=easy`);
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await expect(page.getByTestId("turn")).toContainText("FINAL TURN");
  await page.getByTestId("submit").click();
  for (let i = 0; i < 60 && !(await page.getByTestId("continue").isVisible().catch(() => false)); i++) {
    for (const id of ["breaking", "skip"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  await page.getByTestId("continue").click();
}

test("election night ending in a hung parliament forms a coalition government", async ({ page }) => {
  await toElectionNight(page, "hung");
  await expect(page.getByTestId("suspense")).toContainText("Ballot count, turn 9");
  await expect(page.getByTestId("call-banner")).toContainText("North East"); // the UK count starts in the North East
  await page.getByTestId("night-skip").click();
  const end = page.getByTestId("night-end");
  await expect(end).toContainText("HUNG PARLIAMENT");
  await expect(end).toContainText("274");
  await expect(end).toContainText("%"); // popular vote
  await page.getByTestId("night-done").click();

  const formation = page.getByTestId("formation");
  await expect(formation).toContainText("Zoogor Party has the most seats: forms the government 274");
  await expect(formation).toContainText("Tea Break Party is second: main opposition 214");
  await expect(formation).toContainText("Queue Appreciation Society joins the government +162");
  await expect(formation).toContainText("Majority reached with 436");
  // The banner: the winner's headline, their seats out of 650, and how the government came about.
  await expect(page.getByTestId("results")).toContainText("You win the most seats!");
  await expect(page.getByTestId("results")).toContainText("274 of 650 · no majority, so a government is formed");
  await expect(page.getByTestId("ranks")).toContainText("Forms the government");
  await expect(page.getByTestId("stats")).toContainText("CLOSEST REGION");
  // Replay map plays the board from the start; the slider scrubs to any turn.
  await page.getByTestId("replay-open").click();
  await page.getByTestId("replay").fill("0");
  await expect(page.getByText("Start", { exact: true })).toBeVisible();
  await page.getByTestId("replay-close").click();
  await expect(page.getByTestId("replay")).toHaveCount(0);
  await page.getByRole("button", { name: "Rematch" }).click();
  await expect(page.getByTestId("turn")).toContainText("Turn 1");
});

test("the seat map fills as regions are declared and lights up the called region and picked groups", async ({ page }) => {
  await toElectionNight(page, "hung");
  await expect(page.getByTestId("call-banner")).toContainText("North East");
  const map = page.getByTestId("seat-map");
  await expect(map).toBeVisible();
  await expect(map.locator('[data-region="ne"]')).toHaveAttribute("data-called", "true");
  await expect(map.locator(".seat-region.dim")).toHaveCount(11); // everything but the region being called
  await expect(map.locator(".seat-cell")).toHaveCount(650); // one hex per seat
  await page.getByTestId("night-skip").click();
  await page.getByTestId("night-done").click();

  await expect(map).toBeVisible();
  await expect(map.locator('[data-called="false"]')).toHaveCount(0);
  await expect(map.locator(".seat-region.dim")).toHaveCount(0);
  const north = page.getByTestId("result-group-north");
  await expect(north).toContainText("Tea Break Party");
  await north.click();
  await expect(north).toHaveAttribute("aria-pressed", "true");
  await expect(map.locator(".seat-region.dim")).toHaveCount(9); // the North is three regions
  await expect(map.getByTestId("seat-lit")).toHaveCount(3);
  await north.click();
  await expect(map.locator(".seat-region.dim")).toHaveCount(0);

  await page.getByTestId("seatmap-toggle").click();
  await expect(map).toHaveCount(0);
  await expect(page.getByTestId("board")).not.toHaveClass(/under/);
  await page.getByTestId("seatmap-toggle").click();
  await expect(page.getByTestId("seat-map")).toBeVisible();
});

test("luck factor: the odds show on regions, every seat is a draw on election night, and the result says so", async ({ page }) => {
  await page.goto("/?scenario=hung&ai=easy&luck");
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await expect(page.getByTestId("tally")).toContainText("Expected seats");
  await page.getByTestId("find-region").selectOption("lon");
  await expect(page.getByTestId("luck-odds")).toContainText("Chance of each seat:");
  await expect(page.getByTestId("luck-odds")).toContainText("%");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("submit").click();
  for (let i = 0; i < 60 && !(await page.getByTestId("continue").isVisible().catch(() => false)); i++) {
    for (const id of ["breaking", "skip"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("suspense")).toContainText("every seat is a draw");
  await page.getByTestId("night-skip").click();
  await page.getByTestId("night-done").click();
  await expect(page.getByTestId("luck-note")).toBeVisible();
  // The banner shows the seats actually won, and they add up to the parliament.
  await expect(page.getByTestId("results")).toContainText("of 650");
  const seats = await page.evaluate(() => Object.values((window as unknown as HookWindow).__game!.game.election!.result.seats));
  expect(seats.reduce((a: number, b: number) => a + b, 0)).toBe(650);
});

test("a tie for most seats starts a second round that plays through to a result", async ({ page }) => {
  test.setTimeout(180_000); // a whole second round, recaps included
  await toElectionNight(page, "tie");
  await page.getByTestId("night-skip").click();
  await expect(page.getByTestId("night-end")).toContainText("DEAD HEAT");
  await expect(page.getByTestId("night-end")).toContainText("325");
  await page.getByTestId("night-done").click();
  await expect(page.getByTestId("turn")).toContainText("Second round");
  await expect(page.locator(".banner")).toContainText("Second round");

  // The campaign goes on until every region is in contention again, then a final turn and a new count.
  for (let i = 0; i < 60 && (await page.getByTestId("results").count()) === 0; i++) await submitTurn(page);
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(page.getByTestId("formation")).toContainText("forms the government");
});

test("a plan can't spend more than you have: + stops at what you can pay for and says why", async ({ page }) => {
  const errors = await start(page);
  const options = await page.getByTestId("find-region").locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  let stopped = false;
  for (const id of options) {
    await page.getByTestId("find-region").selectOption(id);
    for (let i = 0; i < 3 && !stopped; i++) {
      const up = page.getByTestId("step-up");
      if (await up.isDisabled()) {
        // Disabled for money (not because the first-entry limit was reached): the card says so.
        stopped = (await page.getByTestId("short-money").count()) > 0;
        break;
      }
      await up.click();
    }
    await page.getByRole("button", { name: "Close" }).click();
    if (stopped) break;
  }
  expect(stopped).toBe(true);
  // The plan is always one you can pay for: money left is never below zero and the turn can be sent.
  const left = await page.getByTestId("remaining").textContent();
  expect(left).not.toContain("-");
  await expect(page.getByTestId("issues")).toHaveCount(0);
  await expect(page.getByTestId("submit")).toBeEnabled();
  expect(errors).toEqual([]);
});
