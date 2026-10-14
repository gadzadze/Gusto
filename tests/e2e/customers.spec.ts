import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, approveSupplier, createProduct, onboardBuyer, onboardSupplier } from "./flows";

test("a supplier invites a customer on a custom price list; the buyer joins and sees their price", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] რძის ნაწარმი ${suffix}`;
  const supplierName = `[E2E] Dairy ${suffix}`;

  const admin = await adminWithCategory(browser, category);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, supplierName);

  // Pending suppliers can't invite yet.
  await supplier.goto("/supplier/customers");
  await expect(supplier.getByText("ანგარიშის დადასტურების შემდეგ")).toBeVisible();
  await approveSupplier(admin, supplierName);

  await createProduct(supplier, { name: "ყველი სულგუნი", category, price: "18,50" });

  // A price list with a lower price for restaurants.
  await supplier.goto("/supplier/pricing");
  await supplier.waitForLoadState("networkidle");
  await supplier.getByPlaceholder(/ახალი სიის სახელი/).fill("[E2E] რესტორნები");
  await supplier.getByRole("button", { name: "სიის შექმნა" }).click();
  await expect(supplier).toHaveURL(/\/supplier\/pricing\/[0-9a-f-]{36}$/);
  await supplier.getByRole("textbox", { name: "ყველი სულგუნი: ფასი ამ სიაში" }).fill("15,00");
  await supplier.getByRole("button", { name: /ცვლილებების შენახვა/ }).click();
  await expect(supplier.getByText("ფასები შენახულია")).toBeVisible();

  // Invite the customer on that list.
  await supplier.goto("/supplier/customers/new");
  await supplier.waitForLoadState("networkidle");
  await supplier.getByLabel("ბიზნესის სახელი").fill("[E2E] Restaurant Mtsvadi");
  await supplier.getByLabel("საკონტაქტო პირი").fill("Levan");
  await supplier.getByLabel("ტელეფონი (WhatsApp)").fill("555 98 76 54");
  await supplier.getByRole("combobox", { name: "ფასების სია" }).selectOption({ label: "[E2E] რესტორნები" });
  await supplier.getByRole("button", { name: "დამატება და ბმულის შექმნა" }).click();
  await expect(supplier.getByText("მოწვევის ბმული მზადაა")).toBeVisible();
  const inviteUrl = await supplier.getByRole("textbox", { name: "მოწვევის ბმული მზადაა" }).inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  const whatsapp = supplier.getByRole("link", { name: "WhatsApp-ით გაგზავნა" });
  await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/995555987654\?text=/);
  const invitePath = new URL(inviteUrl).pathname;

  // Signed out: the invite asks to sign in and come back.
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(invitePath);
  await expect(buyer.getByRole("heading", { name: `${supplierName} გიწვევთ` })).toBeVisible();
  await expect(buyer.getByRole("link", { name: "შესვლა და მიღება" })).toHaveAttribute(
    "href",
    `/login?next=${encodeURIComponent(invitePath)}`,
  );

  // Signed in without an organization: short onboarding, prefilled.
  await signInAsNewUser(buyer, "invited-buyer");
  await buyer.goto(invitePath);
  await expect(buyer.getByLabel("ბიზნესის სახელი")).toHaveValue("[E2E] Restaurant Mtsvadi");
  await buyer.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("restaurant");
  await buyer.getByLabel("ქალაქი").fill("თბილისი");
  await buyer.getByLabel("მიწოდების მისამართი").fill("ვაჟა-ფშაველას 10");
  await buyer.getByRole("button", { name: "დაკავშირება" }).click();

  await expect(buyer).toHaveURL(/\/buyer\/suppliers\/[0-9a-f-]{36}$/);
  await expect(buyer.getByRole("heading", { name: supplierName })).toBeVisible();
  const card = buyer.getByRole("button", { name: /ყველი სულგუნი/ });
  await expect(card).toContainText("15,00");
  await expect(card).not.toContainText("18,50");
  const supplierUrl = new URL(buyer.url()).pathname;

  // Search across suppliers in Latin letters.
  await buyer.goto("/buyer/search?q=sulguni");
  await expect(buyer.getByRole("button", { name: /ყველი სულგუნი/ })).toContainText("15,00");

  // The supplier sees the connection.
  await supplier.goto("/supplier/customers");
  await expect(supplier.getByRole("row", { name: /\[E2E\] Restaurant Mtsvadi/ })).toContainText("დაკავშირებული");

  // A used link is dead for everyone else, and a stranger can't see the catalog.
  const stranger = await (await browser.newContext()).newPage();
  await signInAsNewUser(stranger, "stranger");
  await onboardBuyer(stranger, "[E2E] Other Café");
  await stranger.goto(invitePath);
  await expect(stranger.getByRole("heading", { name: "მოწვევა აღარ მოქმედებს" })).toBeVisible();
  await stranger.goto(supplierUrl);
  await expect(stranger.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" })).toBeVisible();
});

test("a forged invitation link shows the same message as an expired one", async ({ page }) => {
  await page.goto(`/invite/${"A".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "მოწვევა აღარ მოქმედებს" })).toBeVisible();
  await page.goto("/invite/garbage");
  await expect(page.getByRole("heading", { name: "მოწვევა აღარ მოქმედებს" })).toBeVisible();
});
