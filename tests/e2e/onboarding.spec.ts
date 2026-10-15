import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { randomLegalId, signInAsNewUser } from "./auth-helpers";

test("a signed-out visitor is sent to login with a return path", async ({ page }) => {
  await page.goto("/supplier");
  await expect(page).toHaveURL(/\/login\?next=%2Fsupplier$/);
  await expect(page.getByRole("button", { name: "Google-ით შესვლა" })).toBeVisible();
});

test("a new supplier signs in, onboards and sees the awaiting-review banner", async ({ page }) => {
  await signInAsNewUser(page, "supplier", { vetted: false });
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByText("ვაწვდი", { exact: true }).click();
  await page.getByLabel("სავაჭრო სახელი").fill("[E2E] Beverage Distribution");
  await page.getByLabel("საიდენტიფიკაციო კოდი").fill(randomLegalId());
  await page.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await page.getByLabel("ტელეფონი").fill("599 00 00 00");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების არეალი").fill("თბილისი და შემოგარენი");
  await page.getByRole("button", { name: "გაგრძელება" }).click();

  await expect(page).toHaveURL(/\/supplier$/);
  await expect(page.getByRole("status")).toContainText("ანგარიში განხილვის პროცესშია");

  // Onboarding runs once; revisiting it goes back to the dashboard.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/supplier$/);
});

test("a buyer gets a 404, not the supplier area", async ({ page }) => {
  await signInAsNewUser(page, "buyer");
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByText("ვყიდულობ", { exact: true }).click();
  await page.getByLabel("ბიზნესის სახელი").fill("[E2E] Café");
  await page.getByLabel("ბიზნესის ტიპი").selectOption("cafe");
  await page.getByLabel("საკონტაქტო პირი").fill("Nino");
  await page.getByLabel("ტელეფონი").fill("555 12 34 56");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების მისამართი").fill("რუსთაველის გამზ. 1");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page).toHaveURL(/\/buyer$/);

  for (const path of ["/supplier", "/admin"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" })).toBeVisible();
  }
});
