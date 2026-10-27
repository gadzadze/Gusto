import { expect, test } from "@playwright/test";

// The public landing page: short copy, a product tour you can use, both doors,
// and it works on a phone without sideways scrolling.

test("the landing page explains Gusto, lets you try the tour and links to both doors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("რამდენიმე შეხებით");
  // Primary doors: supplier request and sign in.
  await expect(page.getByRole("link", { name: /გაწევრიანება/ }).first()).toHaveAttribute("href", "/suppliers");
  await expect(page.getByRole("link", { name: "შესვლა" }).first()).toHaveAttribute("href", "/start");

  // The tour: picking a tab stops the autoplay; the confirm button really changes the demo order.
  await page.getByRole("tab", { name: /დადასტურება/ }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("ახალი", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "დადასტურება" }).click();
  await expect(panel.getByText("დადასტურებული", { exact: true }).first()).toBeVisible();

  // Only the standard hyphen: no em or en dashes anywhere in the copy.
  expect(await page.locator("body").innerText()).not.toMatch(/[–—]/);
});

test("the landing page has no horizontal scroll at phone width", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  // The menu button opens the sheet with the section links.
  await page.getByRole("button", { name: "მენიუს გახსნა" }).click();
  await expect(page.getByRole("link", { name: "ნდობა" }).first()).toBeVisible();
});
