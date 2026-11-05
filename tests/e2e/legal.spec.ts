import { expect, test } from "@playwright/test";

// The public Terms and Privacy pages: readable, linked from where people give
// us data, and usable on a phone.

test("terms and privacy render, have a contents list and link to each other", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("მომსახურების პირობები");
  expect(await page.getByRole("article").getByRole("heading", { level: 2 }).count()).toBeGreaterThanOrEqual(8);

  // The contents list jumps to a section.
  await page.getByRole("navigation", { name: "შინაარსი" }).getByRole("link").nth(2).click();
  await expect(page).toHaveURL(/#section-3$/);
  await expect(page.locator("#section-3")).toBeInViewport();

  // Only the standard hyphen: no em or en dashes anywhere in the text.
  expect(await page.locator("body").innerText()).not.toMatch(/[–—]/);

  // Across to the privacy policy and back home.
  await page.getByRole("navigation", { name: "იურიდიული ინფორმაცია" }).getByRole("link", { name: "კონფიდენციალურობის პოლიტიკა" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("კონფიდენციალურობის პოლიტიკა");
  expect(await page.locator("body").innerText()).not.toMatch(/[–—]/);
  await page.getByRole("navigation", { name: "იურიდიული ინფორმაცია" }).getByRole("link", { name: "მთავარი" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the documents are linked from the landing footer, sign-in and the request form", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "მომსახურების პირობები" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "კონფიდენციალურობის პოლიტიკა" })).toHaveAttribute("href", "/privacy");

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "მომსახურების პირობებს" })).toHaveAttribute("href", "/terms");
  await expect(page.getByRole("link", { name: "კონფიდენციალურობის პოლიტიკას" })).toHaveAttribute("href", "/privacy");

  await page.goto("/suppliers");
  await expect(page.getByRole("link", { name: "კონფიდენციალურობის პოლიტიკას" })).toHaveAttribute("href", "/privacy");
});

test("terms and privacy have no horizontal scroll at phone width", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  for (const path of ["/terms", "/privacy"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, path).toBe(false);
  }
});
