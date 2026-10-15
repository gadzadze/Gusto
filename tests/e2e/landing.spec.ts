import { expect, test } from "@playwright/test";

// The public landing page: concise, real screenshots, a looping demo, and it
// works on a phone without sideways scrolling.

test("the landing page explains Gusto, shows the product and links to both doors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("რამდენიმე შეხებით");
  // Primary doors: supplier request and sign in.
  await expect(page.getByRole("link", { name: /გაწევრიანება/ }).first()).toHaveAttribute("href", "/suppliers");
  await expect(page.getByRole("link", { name: "შესვლა" }).first()).toHaveAttribute("href", "/start");
  // The real screenshots load (scroll so lazy images fetch).
  for (let y = 0; y < 9000; y += 600) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(100);
  }
  const broken = await page.evaluate(() =>
    [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
  );
  expect(broken).toEqual([]);
  await expect(page.getByText("როგორ მუშაობს")).toBeVisible();
});

test("the landing page has no horizontal scroll at phone width", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
