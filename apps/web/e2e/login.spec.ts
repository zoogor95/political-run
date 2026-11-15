import { expect, test, type Browser } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const unique = () => `Tester_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

async function openLogin(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((api) => localStorage.setItem("mm.apiUrl", api), API);
  await page.goto("/");
  await page.getByTestId("open-profile").click();
  await page.getByTestId("open-login").click();
  await expect(page.getByTestId("login")).toBeVisible();
  return { ctx, page };
}

test("create an account, then sign in from another browser; a taken username is refused; a wrong password is too", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  const name = unique();
  const a = await openLogin(browser);
  await a.page.getByTestId("login-tab-register").click();
  await a.page.getByTestId("login-username").fill("x!");
  await expect(a.page.getByTestId("login-username-note")).toContainText("At least 3");
  await a.page.getByTestId("login-username").fill(name);
  await expect(a.page.getByTestId("login-username-note")).toContainText("free");
  await a.page.getByTestId("login-password").fill("a long password");
  await a.page.getByTestId("login-password-again").fill("different one");
  await expect(a.page.getByTestId("login-go")).toBeDisabled();
  await a.page.getByTestId("login-password-again").fill("a long password");
  await a.page.getByTestId("login-go").click();
  // Back on the profile, signed in under that name.
  await expect(a.page.getByTestId("account-name")).toContainText(name);

  // A second browser: the same name in other capitals is taken, and signing in works with the password.
  const b = await openLogin(browser);
  await b.page.getByTestId("login-tab-register").click();
  await b.page.getByTestId("login-username").fill(name.toUpperCase());
  await expect(b.page.getByTestId("login-username-note")).toContainText("taken");
  await b.page.getByTestId("login-tab-signin").click();
  await b.page.getByTestId("login-username").fill(name);
  await b.page.getByTestId("login-password").fill("wrong password!");
  await b.page.getByTestId("login-go").click();
  await expect(b.page.getByTestId("login-error")).toContainText("Wrong username or password");
  await b.page.getByTestId("login-password").fill("a long password");
  await b.page.getByTestId("login-go").click();
  await expect(b.page.getByTestId("account-name")).toContainText(name);
  await a.ctx.close();
  await b.ctx.close();
});

test("a signed-in player changes their password: the wrong current one is refused and doesn't sign them out", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough");
  const name = unique();
  const a = await openLogin(browser);
  await a.page.getByTestId("login-tab-register").click();
  await a.page.getByTestId("login-username").fill(name);
  await a.page.getByTestId("login-password").fill("first password");
  await a.page.getByTestId("login-password-again").fill("first password");
  await a.page.getByTestId("login-go").click();
  await expect(a.page.getByTestId("account-name")).toContainText(name);
  await a.page.getByTestId("open-login").click();
  await expect(a.page.getByTestId("change-password")).toBeVisible();
  await a.page.getByTestId("pw-current").fill("not the password");
  await a.page.getByTestId("pw-new").fill("second password");
  await a.page.getByTestId("pw-again").fill("second password");
  await a.page.getByTestId("pw-go").click();
  await expect(a.page.getByTestId("pw-error")).toContainText("current password");
  await expect(a.page.getByTestId("change-password")).toBeVisible(); // still signed in
  await a.page.getByTestId("pw-current").fill("first password");
  await a.page.getByTestId("pw-go").click();
  await expect(a.page.getByTestId("pw-done")).toBeVisible();
  // Another browser signs in with the new password only.
  const b = await openLogin(browser);
  await b.page.getByTestId("login-username").fill(name);
  await b.page.getByTestId("login-password").fill("first password");
  await b.page.getByTestId("login-go").click();
  await expect(b.page.getByTestId("login-error")).toBeVisible();
  await b.page.getByTestId("login-password").fill("second password");
  await b.page.getByTestId("login-go").click();
  await expect(b.page.getByTestId("account-name")).toContainText(name);
  await a.ctx.close();
  await b.ctx.close();
});
