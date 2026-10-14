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

test("buyer submits → supplier sees an unread notification and opens the order from it; buyer hears back", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] პროდუქტები ${suffix}`;
  const supplierName = `[E2E] Notify Wholesale ${suffix}`;
  const buyerName = `[E2E] Notify Restaurant ${suffix}`;

  const admin = await adminWithCategory(browser, category);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "notify-supplier");
  await onboardSupplier(supplier, supplierName);
  await approveSupplier(admin, supplierName);
  await createProduct(supplier, { name: "ყველი სულგუნი", category, price: "18,50", unit: "kg" });
  const invitePath = await inviteCustomer(supplier, buyerName);

  const buyer = await (await browser.newContext()).newPage();
  await signInAsNewUser(buyer, "notify-buyer");
  await acceptInviteAsNewBuyer(buyer, invitePath);
  await buyer.waitForLoadState("networkidle");

  // Nothing yet for the supplier.
  await supplier.goto("/supplier");
  await expect(supplier.getByRole("link", { name: "შეტყობინებები", exact: true })).toBeVisible();

  await buyer.getByRole("button", { name: "დამატება: ყველი სულგუნი" }).click();
  await expect(buyer.getByRole("button", { name: "რაოდენობის გაზრდა: ყველი სულგუნი" })).toBeVisible();
  await buyer.getByRole("link", { name: /შეკვეთის გაფორმება/ }).click();
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("button", { name: "შეკვეთის გაგზავნა" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/orders\/[0-9a-f-]{36}\?placed=1$/);
  const number = (await buyer.getByRole("heading", { level: 1 }).textContent())!.match(/GST-(\d+)/)![1];
  const buyerOrderUrl = new URL(buyer.url()).pathname;

  // WhatsApp is a link the buyer sends themselves, never a delivered state.
  const whatsapp = buyer.getByRole("link", { name: "მომწოდებლისთვის WhatsApp-ით გაგზავნა" });
  await expect(whatsapp).toBeVisible();
  const href = (await whatsapp.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  expect(decodeURIComponent(href)).toContain(`GST-${number}`);
  expect(decodeURIComponent(href)).toContain(`/o/${number}`);
  await expect(buyer.getByText("გაიგზავნა თუ არა")).toBeVisible();

  // The supplier's bell shows 1 unread; the list has it, unread, and opens the order.
  await supplier.goto("/supplier");
  await expect(supplier.getByRole("link", { name: "შეტყობინებები, წაუკითხავი: 1" })).toBeVisible();
  await supplier.getByRole("link", { name: "შეტყობინებები, წაუკითხავი: 1" }).click();
  await expect(supplier).toHaveURL(/\/supplier\/notifications$/);
  await supplier.waitForLoadState("networkidle");
  const row = supplier.getByRole("button", { name: new RegExp(`ახალი შეკვეთა GST-${number}`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(buyerName);
  await row.click();
  await expect(supplier).toHaveURL(/\/supplier\/orders\/[0-9a-f-]{36}$/);
  await expect(supplier.getByRole("heading", { level: 1 })).toContainText(`GST-${number}`);

  // Read now: the count is gone.
  await supplier.goto("/supplier");
  await expect(supplier.getByRole("link", { name: "შეტყობინებები", exact: true })).toBeVisible();
  await expect(supplier.getByRole("link", { name: /წაუკითხავი/ })).toHaveCount(0);

  // Supplier confirms; the buyer is notified and the WhatsApp button for the buyer appears.
  await supplier.goto(`/o/${number}`);
  await supplier.waitForLoadState("networkidle");
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await expect(supplier.getByRole("link", { name: "მყიდველისთვის WhatsApp-ით შეტყობინება" })).toBeVisible();

  await buyer.goto(buyerOrderUrl);
  await expect(buyer.getByRole("link", { name: "შეტყობინებები, წაუკითხავი: 1" })).toBeVisible();
  await buyer.goto("/buyer/notifications");
  await expect(buyer.getByRole("button", { name: new RegExp(`შეკვეთა GST-${number} დადასტურდა`) })).toBeVisible();
  await buyer.getByRole("button", { name: "ყველას წაკითხულად მონიშვნა" }).click();
  await expect(buyer.getByRole("link", { name: /წაუკითხავი/ })).toHaveCount(0);

  // Email preferences can be changed.
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("checkbox", { name: "ახალი შეკვეთები" }).uncheck();
  await buyer.getByRole("button", { name: "შენახვა" }).click();
  await expect(buyer.getByText("შენახულია")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("checkbox", { name: "ახალი შეკვეთები" })).not.toBeChecked();
});

test("the cron drain endpoint rejects callers without the secret", async ({ request }) => {
  const response = await request.post("/api/cron/notifications");
  expect(response.status()).toBe(401);
});
