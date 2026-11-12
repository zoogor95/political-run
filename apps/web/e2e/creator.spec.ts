import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

type HookWindow = { __game?: { ready: boolean } };

test("unlock the creator, build a candidate within the budget, and lead a match with them", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("new-solo").click();

  // Locked at first: the unlock card says what it costs and that this is the test store.
  await page.getByTestId("create-candidate-you").click();
  await expect(page.getByTestId("unlock")).toContainText("One-time unlock · $9.99");
  await expect(page.getByTestId("unlock")).toContainText("Test store");
  await page.getByTestId("unlock-buy").click();

  const creator = page.getByTestId("creator");
  await expect(creator).toBeVisible();
  await page.getByTestId("creator-name").fill("Zara Zoogor");
  await creator.getByRole("radio", { name: "Hijab" }).click();
  await creator.getByLabel("Candidate bio").fill("Former school governor who never misses a council meeting.");

  // The North costs 4 points per +5%: +10% spends the whole 8-point budget, and nothing else fits.
  await creator.getByRole("button", { name: "More for The North" }).click();
  await creator.getByRole("button", { name: "More for The North" }).click();
  await expect(page.getByTestId("creator-points")).toContainText("8 of 8 points");
  await expect(creator.getByRole("button", { name: "More for London" })).toBeDisabled();
  // A penalty on a big group gives points back: −5% Big cities returns 3, enough for +5% London.
  await creator.getByRole("button", { name: "Less for Big cities" }).click();
  await creator.getByRole("button", { name: "More for London" }).click();
  await expect(page.getByTestId("creator-points")).toContainText("7 of 8 points");

  const axe = await new AxeBuilder({ page }).include('[data-testid="creator"]').analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await page.getByTestId("creator-save").click();
  await expect(creator).toHaveCount(0);
  await expect(page.getByLabel("Player 1 leader").locator("option:checked")).toHaveText("Zara Zoogor · Your candidate");
  await expect(page.getByTestId("edit-candidate-you")).toBeVisible();

  await page.getByTestId("start-match").click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await page.getByTestId("tab-party").click();
  await expect(page.getByTestId("custom-leader")).toContainText("Zara Zoogor");

  // The match and the candidate survive a reload; the creator stays unlocked.
  await page.reload();
  await page.getByTestId("continue-match").click();
  await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await page.getByTestId("tab-party").click();
  await expect(page.getByTestId("custom-leader")).toContainText("Zara Zoogor");
  await page.getByTestId("menu-button").click();
  await page.getByTestId("new-solo").click();
  await page.getByTestId("create-candidate-you").click();
  await expect(page.getByTestId("creator")).toBeVisible();
  await expect(page.getByTestId("unlock")).toHaveCount(0);
});
