import { expect, test, type Page } from "@playwright/test";

/** The board lab's test hook (window.__board), typed just enough for these tests. */
type Hook = {
  boardId: string;
  ready: boolean;
  view: {
    selection: string | null;
    piecePoint(id: string): { x: number; y: number };
    screenPoint(id: string): { x: number; y: number };
    app: { canvas: HTMLCanvasElement };
  };
};
type HookWindow = { __board?: Hook };

async function open(page: Page, board: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/?lab&board=${board}`);
  await page.waitForFunction((id) => { const h = (window as unknown as HookWindow).__board; return Boolean(h?.ready && h.boardId === id); }, board, { timeout: 30_000 });
  // Measure only once the page has settled: when the web fonts arrive, the top bar can wrap onto another line on a
  // phone and move the board down.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    () => {
      const r = (window as unknown as HookWindow).__board!.view.app.canvas.getBoundingClientRect();
      const key = `${r.left},${r.top},${r.width},${r.height}`;
      const w = window as unknown as { __boardRect?: string };
      const steady = w.__boardRect === key;
      w.__boardRect = key;
      return steady;
    },
    null,
    { polling: 250, timeout: 10_000 },
  );
  return errors;
}

/** Page coordinates of a region's piece or badge. */
async function pointOf(page: Page, id: string, what: "piece" | "badge") {
  return page.evaluate(
    ([rid, kind]) => {
      const v = (window as unknown as HookWindow).__board!.view;
      const p = kind === "piece" ? v.piecePoint(rid!) : v.screenPoint(rid!);
      const r = v.app.canvas.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    [id, what],
  );
}

async function tapAt(page: Page, p: { x: number; y: number }) {
  if (test.info().project.name === "phone") await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

for (const board of ["uk", "pk", "in", "my", "us"]) {
  test(`${board} board draws without errors`, async ({ page }) => {
    const errors = await open(page, board);
    const shot = await page.getByTestId("board").screenshot();
    expect(shot.byteLength).toBeGreaterThan(20_000); // a blank canvas compresses to almost nothing
    expect(errors).toEqual([]);
  });
}

test("tapping a piece lifts it and opens its region card; tapping again drops it", async ({ page }) => {
  await open(page, "uk");
  await tapAt(page, await pointOf(page, "nw", "piece"));
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("North West");
  expect(await page.evaluate(() => (window as unknown as HookWindow).__board!.view.selection)).toBe("nw");
  // Opening the card shrinks the board on a phone, which lays the seat badges out again; a neighbour's badge can then
  // sit over North West's piece. Badges are always on top, so the second tap goes to North West's own badge, once the
  // board has stopped moving.
  let last = await pointOf(page, "nw", "badge");
  let steady = 0;
  await expect
    .poll(
      async () => {
        const now = await pointOf(page, "nw", "badge");
        steady = Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5 ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
  await tapAt(page, last);
  await expect(page.getByTestId("region-card")).toHaveCount(0);
});

test("tapping a seat badge selects its region", async ({ page }) => {
  await open(page, "uk");
  await tapAt(page, await pointOf(page, "se", "badge"));
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("South East");
});

test("small regions are tappable through their enlarged piece", async ({ page }) => {
  await open(page, "pk");
  await tapAt(page, await pointOf(page, "islamabad", "piece"));
  await expect(page.getByTestId("region-card").locator("h2")).toHaveText("Islamabad");
});

test("the board lab links back to the main menu", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Board lab" }).click();
  await expect(page.getByTestId("lab-back")).toBeVisible();
  await page.getByTestId("lab-back").click();
  await expect(page.getByTestId("main-menu")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});
