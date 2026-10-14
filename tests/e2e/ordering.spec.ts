import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import {
  acceptInviteAsNewBuyer,
  adminWithCategory,
  approveSupplier,
  createProduct,
  inviteCustomer,
  onboardSupplier,
} from "./flows";

test("order loop: cart → checkout → supplier confirms with a change → delivered → reorder", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] პროდუქტები ${suffix}`;
  const supplierName = `[E2E] Wholesale ${suffix}`;

  const admin = await adminWithCategory(browser, category);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "order-supplier");
  await onboardSupplier(supplier, supplierName);
  await approveSupplier(admin, supplierName);
  await createProduct(supplier, { name: "ყველი სულგუნი", category, price: "18,50", unit: "kg" });
  await createProduct(supplier, { name: "მაწონი", category, price: "2,40", unit: "piece" });
  await createProduct(supplier, { name: "კარაქი", category, price: "7,90", unit: "pack" });
  const invitePath = await inviteCustomer(supplier, "[E2E] Restaurant Orders");

  const buyer = await (await browser.newContext()).newPage();
  await signInAsNewUser(buyer, "order-buyer");
  await acceptInviteAsNewBuyer(buyer, invitePath);
  await buyer.waitForLoadState("networkidle");

  // Three products into the cart, then 3 მაწონი instead of 1.
  for (const name of ["ყველი სულგუნი", "მაწონი", "კარაქი"]) {
    await buyer.getByRole("button", { name: `დამატება: ${name}` }).click();
    await expect(buyer.getByRole("button", { name: `რაოდენობის გაზრდა: ${name}` })).toBeVisible();
  }
  await buyer.getByRole("button", { name: "რაოდენობის გაზრდა: მაწონი" }).click();
  await buyer.getByRole("button", { name: "რაოდენობის გაზრდა: მაწონი" }).click();
  await expect(buyer.getByText("3 ც")).toBeVisible();
  // 18,50 + 3 × 2,40 + 7,90 = 33,60
  await expect(buyer.getByRole("link", { name: /კალათაში 3 პროდუქტი · 33,60/ })).toBeVisible();

  await buyer.getByRole("link", { name: /შეკვეთის გაფორმება/ }).click();
  await expect(buyer).toHaveURL(/\/buyer\/checkout\//);
  await buyer.waitForLoadState("networkidle");
  await buyer.getByLabel("შენიშვნა მომწოდებლისთვის").fill("მიწოდება 11:00-მდე");
  await buyer.getByRole("button", { name: "შეკვეთის გაგზავნა" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/orders\/[0-9a-f-]{36}\?placed=1$/);
  await expect(buyer.getByText("შეკვეთა გაიგზავნა")).toBeVisible();
  const heading = await buyer.getByRole("heading", { level: 1 }).textContent();
  const number = heading!.match(/GST-(\d+)/)![1];
  const buyerOrderUrl = new URL(buyer.url()).pathname;

  // Supplier: confirm with 2 მაწონი instead of 3.
  await supplier.goto("/supplier/orders");
  await supplier.getByRole("link", { name: new RegExp(`GST-${number}`) }).click();
  await supplier.waitForLoadState("networkidle");
  await expect(supplier.getByText("მიწოდება 11:00-მდე")).toBeVisible();
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await supplier.getByRole("textbox", { name: "მაწონი: დადასტურებული რაოდენობა" }).fill("2");
  await supplier.getByLabel("შენიშვნა კლიენტისთვის (არასავალდებულო)").fill("მაწონი მხოლოდ 2 დარჩა");
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await expect(supplier.getByText("დადასტურებული").first()).toBeVisible();

  // Buyer sees the confirmation, the change, and the new total (33,60 − 2,40 = 31,20).
  await buyer.goto(buyerOrderUrl);
  await expect(buyer.getByText("დადასტურებული").first()).toBeVisible();
  await expect(buyer.getByText("შეკვეთილი 3 ც")).toBeVisible();
  await expect(buyer.getByText("დადასტურდა 2 ც")).toBeVisible();
  await expect(buyer.getByText("მაწონი მხოლოდ 2 დარჩა")).toBeVisible();
  await expect(buyer.getByText("31,20 ₾").first()).toBeVisible();
  // Cancel is no longer offered once confirmed.
  await expect(buyer.getByRole("button", { name: "შეკვეთის გაუქმება" })).toHaveCount(0);

  // Supplier marks it delivered.
  await supplier.getByRole("button", { name: "მიწოდებულად მონიშვნა" }).click();
  await expect(supplier.getByText("მიწოდებული").first()).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByText("მიწოდებული").first()).toBeVisible();

  // The order link resolves for each side, and 404s for an unrelated supplier.
  await buyer.goto(`/o/${number}`);
  await expect(buyer).toHaveURL(new RegExp(`${buyerOrderUrl}$`));
  const outsider = await (await browser.newContext()).newPage();
  await signInAsNewUser(outsider, "outsider-supplier");
  await onboardSupplier(outsider, `[E2E] Outsider ${suffix}`);
  await outsider.goto(`/o/${number}`);
  await expect(outsider.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" })).toBeVisible();
  await outsider.goto(`/supplier/orders/${buyerOrderUrl.split("/").pop()}`);
  await expect(outsider.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" })).toBeVisible();

  // Reorder: back in the cart at the original quantities.
  await buyer.goto(buyerOrderUrl);
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("button", { name: "ხელახლა შეკვეთა" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/cart\?reordered=3/);
  await expect(buyer.getByText("პროდუქტები დაემატა კალათაში")).toBeVisible();
  // The order page stays mounted but hidden (React <Activity>); only check visible text.
  await expect(buyer.getByText("3 ც", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("a signed-out visitor of an order link is sent to login", async ({ page }) => {
  await page.goto("/o/1001");
  await expect(page).toHaveURL(/\/login\?next=%2Fo%2F1001$/);
});
