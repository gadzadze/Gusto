import { expect, test } from "@playwright/test";
import { signInAsNewUser } from "./auth-helpers";
import { onboardBuyer } from "./flows";

// A business that buys from some suppliers and resells to others has both a buyer and a
// supplier side under one login, and switches between them.

test("a business onboards as both and switches sides", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, "both");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.waitForLoadState("networkidle");
  await page.getByText("ორივე", { exact: true }).click();
  await page.getByLabel("ბიზნესის სახელი").fill("[E2E] Reseller");
  await page.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("retailer");
  await page.getByLabel("საკონტაქტო პირი").fill("Gela");
  await page.getByLabel("ტელეფონი").fill("599 11 22 33");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების მისამართი").fill("რუსთაველის გამზ. 1");
  await page.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  // Vetted: both sides active, the buyer side first.
  await expect(page).toHaveURL(/\/buyer$/);

  const switcher = page.getByRole("navigation", { name: "როლის არჩევა" });
  await expect(switcher.getByRole("link", { name: "მყიდველი" })).toHaveAttribute("aria-current", "true");
  await switcher.getByRole("link", { name: "მომწოდებელი" }).click();
  await expect(page).toHaveURL(/\/supplier$/);
  await expect(page.getByRole("navigation", { name: "როლის არჩევა" }).getByRole("link", { name: "მომწოდებელი" })).toHaveAttribute("aria-current", "true");

  // Opening the other side's address switches to it instead of "not found".
  await page.goto("/buyer");
  await expect(page).toHaveURL(/\/buyer$/);
  await expect(page.getByRole("navigation", { name: "როლის არჩევა" }).getByRole("link", { name: "მყიდველი" })).toHaveAttribute("aria-current", "true");

  // The choice is remembered across pages.
  await page.goto("/buyer/orders");
  await expect(page).toHaveURL(/\/buyer\/orders$/);
});

test("a buyer adds the supplier side later and it starts active for the same business", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, "addside");
  await onboardBuyer(page, "[E2E] Shop that resells");
  // One side only: no switcher, a link to add the other side.
  await expect(page.getByRole("navigation", { name: "როლის არჩევა" })).toHaveCount(0);
  await page.getByRole("link", { name: "მომწოდებლადაც გაწევრიანება" }).click();
  await expect(page).toHaveURL(/\/account\/add-side$/);
  await page.waitForLoadState("networkidle");
  // Details of the first side are already there.
  await expect(page.getByLabel("საკონტაქტო პირი")).toHaveValue("Nino");
  await page.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page).toHaveURL(/\/supplier$/);
  const switcher = page.getByRole("navigation", { name: "როლის არჩევა" });
  await expect(switcher.getByRole("link", { name: "მომწოდებელი" })).toHaveAttribute("aria-current", "true");
  await switcher.getByRole("link", { name: "მყიდველი" }).click();
  await expect(page).toHaveURL(/\/buyer$/);

  // Both sides now: nothing left to add.
  await page.goto("/account/add-side");
  await expect(page).toHaveURL(/\/buyer$/);
});
