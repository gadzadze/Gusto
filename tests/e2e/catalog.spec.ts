import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import "../../scripts/load-env";
import { grantAdmin, signInAsNewUser } from "./auth-helpers";

test("admin sets up a category; a supplier builds a catalog by hand and by import; admin approves it", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] რძის ნაწარმი ${suffix}`;
  const supplierName = `[E2E] Dairy Supplier ${suffix}`;

  // Admin: create the category suppliers will use.
  const adminPage = await (await browser.newContext()).newPage();
  const adminEmail = await signInAsNewUser(adminPage, "admin");
  grantAdmin(adminEmail);
  await adminPage.goto("/admin/categories");
  await adminPage.getByPlaceholder("ახალი კატეგორია").fill(category);
  await adminPage.getByRole("button", { name: "დამატება" }).click();
  await expect(adminPage.getByText(category)).toBeVisible();

  // Supplier: onboard (pending review) and create a product with a photo.
  const page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, "supplier");
  await page.getByText("ვაწვდი", { exact: true }).click();
  await page.getByLabel("სავაჭრო სახელი").fill(supplierName);
  await page.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await page.getByLabel("ტელეფონი").fill("599 00 00 00");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page.getByRole("status")).toContainText("განხილვის პროცესშია");

  await page.getByRole("link", { name: "პროდუქტები" }).first().click();
  await expect(page.getByText("პროდუქტები ჯერ არ გაქვთ")).toBeVisible();
  await page.getByRole("link", { name: "ახალი პროდუქტი" }).click();

  const photo = testInfo.outputPath("photo.png");
  await writeFile(photo, await sharp({ create: { width: 900, height: 900, channels: 3, background: "#f5e6c8" } }).png().toBuffer());

  await page.getByLabel("დასახელება").fill("ყველი სულგუნი");
  // Role queries skip hidden elements: Next keeps the previous page mounted but hidden.
  await page.getByRole("combobox", { name: "კატეგორია", exact: true }).selectOption({ label: category });
  await page.getByLabel("კოდი (SKU)").fill("SUL-1");
  await page.getByRole("combobox", { name: "ერთეული", exact: true }).selectOption("kg");
  await page.getByLabel("ფასი ერთეულზე").fill("18,50");
  await page.getByLabel("მინიმალური რაოდენობა").fill("0,5");
  await page.getByLabel("რაოდენობის ბიჯი").fill("0,5");
  await page.locator('input[type="file"]').setInputFiles(photo);
  await page.getByRole("button", { name: "პროდუქტის დამატება" }).click();

  await expect(page).toHaveURL(/\/supplier\/products\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByText("პროდუქტი დაემატა")).toBeVisible();
  const img = page.getByRole("img", { name: "ყველი სულგუნი" });
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", /\/storage\/v1\/object\/public\/product-images\/.+-w(400|1200)\.webp$/);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // Import three more from a CSV in the template's format.
  const csv = testInfo.outputPath("prices.csv");
  await writeFile(
    csv,
    "﻿სახელი,SKU,კატეგორია,ერთეული,ფასი\n" +
      `იმერული ყველი,IMR-1,${category},კგ,"16,00"\n` +
      `მაწონი,MAT-1,${category},ც,"2,40"\n` +
      `კარაქი,KAR-1,${category},შეკვრა,"7,90"\n`,
  );
  await page.goto("/supplier/products/import");
  await page.waitForLoadState("networkidle"); // let React hydrate before choosing the file
  await page.locator('input[type="file"]').setInputFiles(csv);
  await expect(page.getByText("ნაპოვნია 3 სტრიქონი")).toBeVisible();
  await page.getByRole("button", { name: "შემოწმება" }).click();
  await expect(page.getByText("დაემატება: 3 · განახლდება: 0 · შეცდომით: 0")).toBeVisible();
  await page.getByRole("button", { name: "ყველას იმპორტი" }).click();
  await expect(page.getByText("დაემატა: 3 · განახლდა: 0 · გამოტოვდა: 0")).toBeVisible();

  await page.goto("/supplier/products");
  await expect(page.getByText("სულ: 4")).toBeVisible();
  await page.getByRole("searchbox").fill("matsoni");
  await page.getByRole("button", { name: "გაფილტვრა" }).click();
  await expect(page.getByText("სულ: 1")).toBeVisible();
  await expect(page.getByRole("link", { name: /მაწონი/ }).first()).toBeVisible();

  // Admin approves the supplier; the supplier's banner disappears.
  await adminPage.goto("/admin/suppliers?status=pending_review");
  await adminPage.getByRole("link", { name: supplierName }).click();
  await adminPage.getByRole("button", { name: "დადასტურება" }).click();
  await expect(adminPage.getByText("დადასტურებული").first()).toBeVisible();
  await expect(adminPage.getByText("დადასტურდა")).toBeVisible();

  await page.goto("/supplier");
  await expect(page.getByText("ანგარიში განხილვის პროცესშია")).toHaveCount(0);
});

test("a buyer cannot open supplier catalog pages", async ({ page }) => {
  await signInAsNewUser(page, "buyer-catalog");
  await page.getByText("ვყიდულობ", { exact: true }).click();
  await page.getByLabel("ბიზნესის სახელი").fill("[E2E] Café");
  await page.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("cafe");
  await page.getByLabel("საკონტაქტო პირი").fill("Nino");
  await page.getByLabel("ტელეფონი").fill("555 12 34 56");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების მისამართი").fill("რუსთაველის გამზ. 1");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page).toHaveURL(/\/buyer$/);

  for (const path of ["/supplier/products", "/supplier/products/new", "/supplier/products/import", "/supplier/settings", "/admin/categories"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" })).toBeVisible();
  }
});
