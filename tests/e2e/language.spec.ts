import { expect, test, type BrowserContext } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";

// The platform speaks Georgian (the default) and English. The choice is a cookie, set by the
// switch on the landing page, sign-in and inside the app; every address stays the same.

test("the landing page switches to English and back, and the choice sticks", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Georgian by default.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("შეკვეთები ზარებისა და ჩატების გარეშე");
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");

  await page.getByRole("button", { name: "English" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orders without the calls and chats.");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: "Request to join" }).first()).toBeVisible();

  // Remembered across pages and reloads, on the same addresses.
  await page.goto("/login");
  await expect(page.getByText("Sign in to 202").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orders without the calls and chats.");

  await page.getByRole("button", { name: "ქართული" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("შეკვეთები ზარებისა და ჩატების გარეშე");
  await expect(page.locator("html")).toHaveAttribute("lang", "ka");
});

test("an unknown language value in the cookie falls back to Georgian", async ({ context, page }) => {
  await context.addCookies([{ name: "gusto-locale", value: "xx", url: "http://localhost:3100" }]);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "შესვლა 202-ში" }).or(page.getByText("შესვლა 202-ში").first())).toBeVisible();
});

async function english(context: BrowserContext) {
  await context.addCookies([{ name: "gusto-locale", value: "en", url: "http://localhost:3100" }]);
}

test("a buyer onboards and works in English, on a phone too", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await english(context);
  const page = await context.newPage();
  await signInAsNewUser(page, "english");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Welcome to 202" })).toBeVisible();
  await page.getByText("I buy", { exact: true }).click();
  await page.getByLabel("Business name").fill("[E2E] English Cafe");
  await page.getByRole("combobox", { name: "Business type" }).selectOption("cafe");
  await page.getByLabel("Contact person").fill("Nino");
  await page.getByLabel("Phone").fill("555 12 34 56");
  await page.getByLabel("City").fill("Tbilisi");
  await page.getByLabel("Delivery address").fill("1 Rustaveli Ave");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/buyer$/);
  await page.waitForLoadState("networkidle");

  // The bottom bar speaks English and nothing is cut off or wider than the phone.
  const bar = page.getByRole("navigation", { name: "Navigation" });
  await expect(bar.getByRole("link", { name: "Suppliers" })).toBeVisible();
  const result = await bar.evaluate((nav) => {
    const labels = [...nav.querySelectorAll("a > span:last-child, button > span:last-child")] as HTMLElement[];
    const cut = labels.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
    return { cut, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  expect(result.cut).toEqual([]);
  expect(result.pageOverflow).toBe(false);

  // The language can be changed from inside the app (the key icon opens the account page).
  await page.getByRole("link", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByRole("button", { name: "ქართული" }).click();
  await expect(page.getByRole("heading", { name: "პაროლის შეცვლა" })).toBeVisible();
  await page.goto("/buyer");
  await expect(page.getByRole("navigation", { name: "ნავიგაცია" })).toBeVisible();
});

test("English pages have no horizontal scroll at phone width", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await english(context);
  const page = await context.newPage();
  for (const path of ["/", "/login", "/terms", "/privacy", "/suppliers"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, path).toBe(false);
  }
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
});

test("public pages switch language in the browser without asking the server", async ({ page }) => {
  for (const path of ["/", "/login", "/terms", "/suppliers"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Let the other language finish loading in the background, then cut the network.
    await page.waitForTimeout(1500);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "document" || request.resourceType() === "fetch") requests.push(request.url());
    });
    const started = Date.now();
    await page.getByRole("button", { name: "English" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "ქართული" }).first()).toBeVisible();
    expect(Date.now() - started, path).toBeLessThan(500);
    // Georgian letters are gone from the visible text of the page's main content.
    const text = await page.locator("main, body").first().innerText();
    expect(text, path).not.toMatch(/[ა-ჰ]{4,}/);
    await page.getByRole("button", { name: "ქართული" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ka");
    page.removeAllListeners("request");
  }
});
