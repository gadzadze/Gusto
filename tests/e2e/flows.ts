import { expect, type Browser, type Page } from "@playwright/test";
import { grantAdmin, signInAsNewUser } from "./auth-helpers";

// Reusable UI flows for e2e specs. Everything goes through the real UI and
// Server Actions; only admin rights come from the admin:grant script.

export async function adminWithCategory(browser: Browser, category: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const email = await signInAsNewUser(page, "admin");
  grantAdmin(email);
  await page.goto("/admin/categories");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("ახალი კატეგორია").fill(category);
  await page.getByRole("button", { name: "დამატება" }).click();
  await expect(page.getByText(category)).toBeVisible();
  return page;
}

export async function onboardSupplier(page: Page, name: string): Promise<void> {
  await page.getByText("ვაწვდი", { exact: true }).click();
  await page.getByLabel("სავაჭრო სახელი").fill(name);
  await page.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await page.getByLabel("ტელეფონი").fill("599 00 00 00");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page).toHaveURL(/\/supplier$/);
}

export async function onboardBuyer(page: Page, name: string): Promise<void> {
  await page.getByText("ვყიდულობ", { exact: true }).click();
  await page.getByLabel("ბიზნესის სახელი").fill(name);
  await page.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("cafe");
  await page.getByLabel("საკონტაქტო პირი").fill("Nino");
  await page.getByLabel("ტელეფონი").fill("555 12 34 56");
  await page.getByLabel("ქალაქი").fill("თბილისი");
  await page.getByLabel("მიწოდების მისამართი").fill("რუსთაველის გამზ. 1");
  await page.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(page).toHaveURL(/\/buyer$/);
}

export async function approveSupplier(adminPage: Page, supplierName: string): Promise<void> {
  await adminPage.goto("/admin/suppliers?status=pending_review");
  await adminPage.getByRole("link", { name: supplierName }).click();
  await adminPage.getByRole("button", { name: "დადასტურება" }).click();
  await expect(adminPage.getByText("დადასტურდა")).toBeVisible();
}

export async function createProduct(
  page: Page,
  product: { name: string; category: string; price: string; unit?: string },
): Promise<void> {
  await page.goto("/supplier/products/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("დასახელება").fill(product.name);
  await page.getByRole("combobox", { name: "კატეგორია", exact: true }).selectOption({ label: product.category });
  await page.getByRole("combobox", { name: "ერთეული", exact: true }).selectOption(product.unit ?? "kg");
  await page.getByLabel("ფასი ერთეულზე").fill(product.price);
  await page.getByRole("button", { name: "პროდუქტის დამატება" }).click();
  await expect(page.getByText("პროდუქტი დაემატა")).toBeVisible();
}

/** Supplier invites a customer; returns the invite path. */
export async function inviteCustomer(supplier: Page, businessName: string): Promise<string> {
  await supplier.goto("/supplier/customers/new");
  await supplier.waitForLoadState("networkidle");
  await supplier.getByLabel("ბიზნესის სახელი").fill(businessName);
  await supplier.getByLabel("ტელეფონი (WhatsApp)").fill("555 98 76 54");
  await supplier.getByRole("button", { name: "დამატება და ბმულის შექმნა" }).click();
  await expect(supplier.getByText("მოწვევის ბმული მზადაა")).toBeVisible();
  return new URL(await supplier.getByRole("textbox", { name: "მოწვევის ბმული მზადაა" }).inputValue()).pathname;
}

/** A signed-in user without an org accepts an invite through the short onboarding. */
export async function acceptInviteAsNewBuyer(buyer: Page, invitePath: string): Promise<void> {
  await buyer.goto(invitePath);
  await buyer.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("restaurant");
  await buyer.getByLabel("საკონტაქტო პირი").fill("Levan");
  await buyer.getByLabel("ქალაქი").fill("თბილისი");
  await buyer.getByLabel("მიწოდების მისამართი").fill("ვაჟა-ფშაველას 10");
  await buyer.getByRole("button", { name: "დაკავშირება" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/suppliers\/[0-9a-f-]{36}$/);
}
