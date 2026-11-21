import { expect, test, type Browser, type Page } from "@playwright/test";

/** The local game server Playwright starts (packages/server, wrangler dev). */
const API = "http://127.0.0.1:8787";

type HookWindow = { __game?: { ready: boolean } };

async function device(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  return context.newPage();
}

const boards = (page: Page) => page.evaluate(() => (window as unknown as { __game: { game: { boards: unknown[] } } }).__game.game.boards.length);

/** Clicks through the recap, the summary and election night until the turn has played and the device is planning again, or at the results. */
async function catchUp(page: Page, before: number) {
  for (let i = 0; i < 400; i++) {
    if ((await page.getByTestId("results").count()) > 0) return;
    // Stage and board count read together: a turn landing between two reads would look like a finished one.
    const now = await page.evaluate(() => {
      const g = (window as unknown as { __game: { game: { stage: string; boards: unknown[] } } }).__game.game;
      return { stage: g.stage, boards: g.boards.length };
    });
    if (now.stage === "planning" && now.boards > before) return;
    for (const id of ["breaking", "skip", "continue", "night-skip", "night-done"]) {
      const el = page.getByTestId(id);
      if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
    }
    await page.waitForTimeout(150);
  }
  throw new Error("device did not get back to planning");
}

test("two friends on different devices play a private match to the end", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it plays a whole match on two devices");
  test.setTimeout(300_000);
  const host = await device(browser);
  const friend = await device(browser);

  // The host sets up the table and opens a lobby.
  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await expect(host.getByRole("heading", { name: "Play with friends" })).toBeVisible();
  await host.getByTestId("start-match").click();
  await expect(host.getByTestId("lobby")).toBeVisible();
  const code = (await host.getByTestId("invite-code").textContent())!;
  expect(code).toMatch(/^[0-9A-Z]{6}$/);
  await expect(host.getByTestId("lobby-start")).toBeDisabled();
  await expect(host.getByTestId("lobby-start")).toHaveText("Waiting for 1 more friend");

  // A friend types the code (sloppily) and takes the free seat.
  await friend.goto("/");
  await friend.getByTestId("new-online").click();
  await friend.getByTestId("join-code").fill(` ${code.toLowerCase()} `);
  await friend.getByTestId("join-go").click();
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");
  // The friend makes the party their own: a name and a colour, first come first served.
  await expect(friend.getByTestId("lobby-name")).toHaveValue(/Party$/);
  await expect(friend.getByTestId("lobby-party").getByRole("radio", { name: /taken by/ }).first()).toBeDisabled();
  await friend.getByTestId("lobby-name").fill("Sara Party");
  await friend.getByTestId("lobby-name").press("Enter");
  await friend.getByTestId("lobby-party").getByRole("radio", { name: "Lime", exact: true }).click();
  await expect(host.getByTestId("lobby-seats")).toContainText("Sara Party");
  await expect(host.getByTestId("lobby-start")).toHaveText("Waiting for 1 to get ready");
  await friend.getByTestId("lobby-ready").click();
  await expect(friend.getByText("You're ready. Waiting for the host")).toBeVisible();
  await expect(host.getByTestId("lobby-start")).toBeEnabled();
  await host.getByTestId("lobby-start").click();

  for (const page of [host, friend]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  // The friend's picks are their party in the match, on both devices.
  const friendParty = (page: Page) =>
    page.evaluate(() => (window as unknown as { __game: { game: { state: { players: { party: { name: string; color: string } }[] } } } }).__game.game.state.players[1]!.party);
  expect(await friendParty(host)).toEqual({ name: "Sara Party", color: "#7cb518", emblem: expect.any(String) });
  expect(await friendParty(friend)).toEqual(await friendParty(host));

  // Each turn: the host sends a plan and waits; the friend's plan resolves the turn on both devices.
  let turns = 0;
  while ((await host.getByTestId("results").count()) === 0 && turns < 30) {
    const before = [await boards(host), await boards(friend)] as const;
    await host.getByTestId("submit").click();
    await expect(host.getByTestId("online-banner")).toContainText("Waiting for");
    await expect(host.getByTestId("submit")).toBeDisabled();
    await friend.getByTestId("submit").click();
    await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1])]);
    turns++;
  }
  await expect(host.getByTestId("results")).toBeVisible();
  await expect(friend.getByTestId("results")).toBeVisible();
  // Both devices agree on the result.
  const result = (page: Page) => page.evaluate(() => JSON.stringify((window as unknown as { __game: { game: { result: unknown } } }).__game.game.result));
  expect(await result(friend)).toBe(await result(host));
});

test("a turn timer moves the match on without a friend who's away, and the ongoing list shows whose move it is", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it waits out a real one-minute timer");
  test.setTimeout(240_000);
  const host = await device(browser);
  const friend = await device(browser);

  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await host.getByTestId("setup-timer").selectOption("60");
  await host.getByTestId("start-match").click();
  await expect(host.getByTestId("lobby")).toContainText("1:00 per turn");
  const code = (await host.getByTestId("invite-code").textContent())!;
  await friend.goto(`/?join=${code}`);
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");
  await friend.getByTestId("lobby-ready").click();
  await expect(host.getByTestId("lobby-start")).toBeEnabled();
  await host.getByTestId("lobby-start").click();
  for (const page of [host, friend]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  // The clock is running for both; only the host plans.
  await expect(friend.getByTestId("online-banner")).toContainText("Plan before the timer runs out");
  await expect(friend.getByTestId("online-banner")).toContainText(/0:\d\d left/);
  const before = [await boards(host), await boards(friend)] as const;
  await host.getByTestId("submit").click();
  await expect(host.getByTestId("online-banner")).toContainText("Waiting for");

  // A minute later the server plays the turn anyway; the friend sat it out.
  await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1])]);
  await expect(friend.getByTestId("online-banner")).toContainText("You missed the last turn");

  // The host steps out to the menu: the match is listed with their move waiting, and opens again.
  await host.goto("/");
  await host.getByTestId("open-ongoing").click();
  const row = host.getByTestId(`ongoing-${code}`);
  await expect(row).toContainText("Turn 2 · Your move!");
  await row.click();
  await host.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });
  await expect(host.getByTestId("turn")).toContainText("Turn 2");
});

test("a friend who resigns hands their party to the computer, and the host plays on without waiting for them", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  test.setTimeout(180_000);
  const host = await device(browser);
  const friend = await device(browser);

  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await host.getByTestId("start-match").click();
  const code = (await host.getByTestId("invite-code").textContent())!;
  await friend.goto(`/?join=${code}`);
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");
  await friend.getByTestId("lobby-ready").click();
  await expect(host.getByTestId("lobby-start")).toBeEnabled();
  await host.getByTestId("lobby-start").click();
  for (const page of [host, friend]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  // The friend resigns: an "are you sure?" first, then the computer takes their seat.
  await friend.getByTestId("resign-button").click();
  await expect(friend.getByTestId("resign-card")).toContainText("Everyone else plays on");
  await friend.getByTestId("resign-confirm").click();
  await expect(friend.getByTestId("online-banner")).toContainText("You resigned");
  await expect(friend.getByTestId("submit")).toBeDisabled();
  await expect(friend.getByTestId("resign-button")).toHaveCount(0);

  // The host's plan alone resolves the turn: the friend's party is the computer's now.
  const before = [await boards(host), await boards(friend)] as const;
  await host.getByTestId("submit").click();
  await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1])]);
  await expect(host.getByTestId("turn")).toContainText("Turn 2");
  await expect(friend.getByTestId("online-banner")).toContainText("You resigned");
});

test("a spectator watches a friends' match without a seat, and the players see who's watching", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  test.setTimeout(180_000);
  const host = await device(browser);
  const friend = await device(browser);
  const fan = await device(browser);

  await host.goto("/");
  await host.getByTestId("new-online").click();
  await host.getByTestId("online-create").click();
  await host.getByTestId("start-match").click();
  const code = (await host.getByTestId("invite-code").textContent())!;
  await expect(host.getByTestId("watch-link")).toContainText(`?watch=${code}`);
  await friend.goto(`/?join=${code}`);
  await expect(friend.getByTestId("lobby-seats")).toContainText("(you)");

  // The fan types the code and presses Watch: no seat taken, and everyone sees them in the lobby.
  await fan.goto("/");
  await fan.getByTestId("new-online").click();
  await fan.getByTestId("join-code").fill(code);
  await fan.getByTestId("watch-go").click();
  await expect(fan.getByTestId("lobby-watching")).toBeVisible();
  await expect(fan.getByTestId("lobby-seats")).not.toContainText("(you)");
  await expect(host.getByTestId("lobby-watchers")).toContainText("Watching:");
  await friend.getByTestId("lobby-ready").click();
  await expect(host.getByTestId("lobby-start")).toBeEnabled();
  await host.getByTestId("lobby-start").click();
  for (const page of [host, friend, fan]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 30_000 });

  // The fan can't plan; the players see they're being watched.
  await expect(fan.getByTestId("submit")).toHaveText("Watching");
  await expect(fan.getByTestId("submit")).toBeDisabled();
  await expect(fan.getByTestId("online-banner")).toContainText("You're watching this match");
  await expect(fan.getByTestId("resign-button")).toHaveCount(0);
  const before = [await boards(host), await boards(friend), await boards(fan)] as const;
  await host.getByTestId("submit").click();
  await expect(host.getByTestId("watchers")).toContainText("Watching:");
  await friend.getByTestId("submit").click();
  await Promise.all([catchUp(host, before[0]), catchUp(friend, before[1]), catchUp(fan, before[2])]);
  await expect(fan.getByTestId("turn")).toContainText("Turn 2");
});


test("the game's service worker is installed, ready for push notifications", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  // (Headless Chromium reports notifications as blocked whatever a test grants, so "Notify me" itself can't be pressed
  // here; subscribing and sending are covered by the server's tests.)
  await page.goto("/");
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? ""), { timeout: 15_000 }).toContain("/sw.js");
});

test("quick match: two people searching the same map are put in a match together, with five minutes a turn", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it waits out the matchmaker's 15-second gathering time");
  test.setTimeout(120_000);
  const ali = await device(browser);
  const sam = await device(browser);
  for (const page of [ali, sam]) {
    await page.goto("/");
    await page.getByTestId("quick-match").click();
    await expect(page.getByTestId("quick-match")).toBeVisible();
  }
  // Someone searching another map isn't matched with them.
  await ali.getByTestId("quick-map-pk").click();
  await sam.getByTestId("quick-map-pk").click();
  await ali.getByTestId("quick-ranked").click();
  await expect(ali.getByTestId("quick-rating")).toContainText("1000, until your first ranked match");
  await ali.getByTestId("quick-casual").click();
  await ali.getByTestId("quick-find").click();
  await expect(ali.getByTestId("quick-searching")).toContainText("You're the only one looking");
  await sam.getByTestId("quick-find").click();
  await expect(ali.getByTestId("quick-searching")).toContainText("2 people found");
  // After the gathering time both land in the same match, already started.
  for (const page of [ali, sam]) await page.waitForFunction(() => Boolean((window as unknown as HookWindow).__game?.ready), null, { timeout: 40_000 });
  const codes = await Promise.all([ali, sam].map((p) => p.evaluate(() => new URLSearchParams(location.search).get("join"))));
  expect(codes[0]).toMatch(/^[0-9A-Z]{6}$/);
  expect(codes[1]).toBe(codes[0]);
  await expect(ali.getByTestId("online-banner")).toContainText(/\d:\d\d left/);
  await expect(ali.getByTestId("turn")).toContainText("Turn 1");
});

test("leaderboards: open from the menu, pick a map and a board", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  await page.goto("/");
  await page.getByTestId("open-leaderboards").click();
  await expect(page.getByTestId("leaderboards")).toContainText("Leaderboards");
  await expect(page.getByTestId("lb-empty")).toContainText("Nobody has played ten ranked games");
  await page.getByTestId("lb-map-us").click();
  await page.getByTestId("lb-candidates").click();
  await expect(page.getByTestId("lb-empty")).toBeVisible();
});


test("tournaments: the menu box opens the screen that explains the cups", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  await page.goto("/");
  await page.locator('[data-testid="tournaments"]').first().click();
  await expect(page.getByRole("heading", { name: "Tournaments" })).toBeVisible();
  await expect(page.getByText("24 hours a turn")).toBeVisible();
});

test("tournaments: a finished cup shows its champion and a bracket you can open and close", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  const cup = { id: "uk-2027-winter", name: "United Kingdom Winter Cup 2027", map: "uk", status: "finished", cancelled: false, startsAt: 0, endsBefore: 1, opensAt: 0, entrants: 5, champion: "P1", round: 2, yourRank: null, entered: false, yourTable: null };
  await page.route("**/api/tournaments", (r) => r.fulfill({ json: { now: Date.now(), tournaments: [cup], maxEntrants: 256, minEntrants: 4 } }));
  await page.route("**/api/tournaments/uk-2027-winter", (r) =>
    r.fulfill({
      json: {
        rounds: [
          { round: 1, tableNo: 0, code: "a", players: ["P0", "P1", "P2"], winner: "P1" },
          { round: 1, tableNo: 1, code: "b", players: ["P3", "P4"], winner: "P3" },
          { round: 2, tableNo: 0, code: "c", players: ["P1", "P3"], winner: "P1" },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator('[data-testid="tournaments"]').first().click();
  await expect(page.getByTestId("cup-uk-2027-winter")).toContainText("Champion: P1");
  await page.getByTestId("cup-bracket-uk-2027-winter").click();
  const bracket = page.getByTestId("bracket-uk-2027-winter");
  await expect(bracket).toContainText("Round 1");
  await expect(bracket).toContainText("Final");
  await expect(bracket).toContainText("P1 ✓");
  await page.getByTestId("cup-bracket-uk-2027-winter").click();
  await expect(bracket).toHaveCount(0);
});

test("tournaments: with no cup open the screen says when the next ones open", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  const now = Date.UTC(2026, 10, 15);
  await page.route("**/api/tournaments", (r) => r.fulfill({ json: { now, tournaments: [], maxEntrants: 256, minEntrants: 4 } }));
  await page.goto("/");
  await page.locator('[data-testid="tournaments"]').first().click();
  await expect(page.getByTestId("cups-next")).toContainText("Winter Cups open for sign-up on");
  await expect(page.getByTestId("cups-next")).toContainText("2027");
});

test("leaderboards: worldwide, your country, or a region, with your standing", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => {
    localStorage.setItem("mm.apiUrl", api);
    localStorage.setItem("mm.cloud.v1", JSON.stringify({ code: "", username: "tester", token: "t", sent: {}, syncedAt: null }));
  }, API);
  const asked: string[] = [];
  await page.route("**/api/me**", (r) => r.fulfill({ json: { account: { id: "a", displayName: "Tester", avatar: {}, locale: "en", createdAt: 0 }, settings: null, stats: null, unlocked: null } }));
  await page.route("**/api/ratings/me", (r) => r.fulfill({ json: { season: { name: "2026 Q4" }, ratings: [], titles: [], home: { country: "RU", region: null } } }));
  await page.route("**/api/leaderboard?**", (r) => {
    asked.push(r.request().url());
    const country = new URL(r.request().url()).searchParams.get("country");
    r.fulfill({ json: { season: "2026-Q4", map: "uk", board: "players", standing: country ? { rank: 3, of: 9, rating: 1004, games: 15, wins: 2 } : null, minGames: 10, provisional: country ? null : { games: 4 }, rows: [] } });
  });
  await page.goto("/");
  await page.getByTestId("open-leaderboards").click();
  await expect(page.getByTestId("lb-scope-country")).toContainText("Russia");
  await expect(page.getByTestId("lb-provisional")).toContainText("Play 10 ranked games");
  await page.getByTestId("lb-scope-country").click();
  await expect(page.getByTestId("lb-standing")).toContainText("#3");
  await expect(page.getByTestId("lb-standing")).toContainText("of 9");
  expect(asked.some((u) => u.includes("country=RU"))).toBe(true);
  await page.getByTestId("lb-scope-region").click();
  await page.getByTestId("lb-region").selectOption("nw");
  await expect(page.getByTestId("lb-empty")).toContainText("North West");
  expect(asked.some((u) => u.includes("region=nw"))).toBe(true);
  // A region belongs to one map: switching maps drops it.
  await page.getByTestId("lb-map-pk").click();
  await expect(page.getByTestId("lb-region")).toHaveValue("");
});

test("the profile saves one home region: the country you live in, then a region of it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  const saved: unknown[] = [];
  await page.route("**/api/me/home", (r) => {
    saved.push(r.request().postDataJSON());
    r.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByTestId("open-profile").click();
  await expect(page.getByTestId("home-regions")).toBeVisible();
  // There is one home, not one per map: no region choice until a country is picked.
  await expect(page.getByTestId("home-region")).toHaveCount(0);
  await page.getByTestId("home-country").selectOption("PK");
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toEqual({ country: "PK", region: null });
  await page.getByTestId("home-region").selectOption("lahore");
  await expect.poll(() => saved.length).toBe(2);
  expect(saved[1]).toEqual({ country: "PK", region: "lahore" });
  // Changing country clears the region (it belonged to the old country); "Not set" clears the home.
  await page.getByTestId("home-country").selectOption("GB");
  await expect.poll(() => saved.length).toBe(3);
  expect(saved[2]).toEqual({ country: "GB", region: null });
  // Any country will do; those without a map have no regions to pick.
  await page.getByTestId("home-country").selectOption("RU");
  await expect.poll(() => saved.length).toBe(4);
  expect(saved[3]).toEqual({ country: "RU", region: null });
  await expect(page.getByTestId("home-region")).toHaveCount(0);
  await page.getByTestId("home-country").selectOption("");
  await expect.poll(() => saved.length).toBe(5);
  expect(saved[4]).toEqual({ country: null, region: null });
  await expect(page.getByTestId("home-region")).toHaveCount(0);
});
