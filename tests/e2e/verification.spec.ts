import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import "../../scripts/load-env";
import { grantAdmin, randomLegalId, signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, approveSupplier, inviteCustomer, onboardSupplier } from "./flows";

// Partners use their own company address and choose their own password; the
// admin vets who is real, either before (registering the address with a legal
// ID) or after (a buyer who arrived through a supplier's link waits).

const PASSWORD = "correct-horse-battery";

async function confirmLink(page: Page, email: string) {
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const link = await api.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
}

test("a vetted partner picks their own password, then signs in with it", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = await (await browser.newContext()).newPage();
  grantAdmin(await signInAsNewUser(admin, "verify-admin"));

  const email = `alcorium-${Date.now().toString(36)}@test.gusto.ge`;
  const legalId = randomLegalId();
  await admin.goto("/admin/access");
  await admin.waitForLoadState("networkidle");
  await admin.getByLabel("ელფოსტა", { exact: true }).fill(email);
  await admin.getByLabel("ბიზნესის დასახელება").fill("[E2E] Alcorium");
  await admin.getByLabel("საიდენტიფიკაციო კოდი").fill("12345");
  await admin.getByLabel("როლი", { exact: true }).selectOption("buyer");
  await admin.getByRole("button", { name: "დამატება" }).click();
  await expect(admin.getByText("კოდი უნდა შედგებოდეს 9 ან 11 ციფრისგან")).toBeVisible();
  await admin.getByLabel("საიდენტიფიკაციო კოდი").fill(legalId);
  await admin.getByRole("button", { name: "დამატება" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: email })).toContainText(legalId);

  // First sign-in (the emailed link): before anything else they must choose a password.
  const partner = await (await browser.newContext()).newPage();
  await confirmLink(partner, email);
  await expect(partner).toHaveURL(/\/account\/password$/);
  await partner.waitForLoadState("networkidle");
  await partner.getByLabel("ახალი პაროლი").fill(PASSWORD);
  await partner.getByLabel("გაიმეორეთ პაროლი").fill("something-else-entirely");
  await partner.getByRole("button", { name: "პაროლის შენახვა" }).click();
  await expect(partner.getByText("პაროლები არ ემთხვევა.")).toBeVisible();
  // The form clears after an error (React resets it): type both again.
  await partner.getByLabel("ახალი პაროლი").fill(PASSWORD);
  await partner.getByLabel("გაიმეორეთ პაროლი").fill(PASSWORD);
  await partner.getByRole("button", { name: "პაროლის შენახვა" }).click();

  // Registered as a buyer with a verified ID: no choice, ID shown read-only, active at once.
  await expect(partner).toHaveURL(/\/onboarding$/);
  await expect(partner.getByLabel("საიდენტიფიკაციო კოდი")).toHaveValue(legalId);
  await expect(partner.getByLabel("საიდენტიფიკაციო კოდი")).not.toBeEditable();
  await expect(partner.getByLabel("ბიზნესის სახელი")).toHaveValue("[E2E] Alcorium");
  await partner.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("retailer");
  await partner.getByLabel("საკონტაქტო პირი").fill("Nino");
  await partner.getByLabel("ტელეფონი").fill("555 12 34 56");
  await partner.getByLabel("ქალაქი").fill("თბილისი");
  await partner.getByLabel("მიწოდების მისამართი").fill("რუსთაველის გამზ. 1");
  await partner.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(partner).toHaveURL(/\/buyer$/);

  // Later: email + password.
  await partner.getByRole("button", { name: "გასვლა" }).first().click();
  await partner.goto("/login");
  await partner.waitForLoadState("networkidle");
  await partner.getByLabel("ელფოსტა").fill(email);
  await partner.getByLabel("პაროლი").fill("wrong-password-1");
  await partner.getByRole("button", { name: "შესვლა", exact: true }).click();
  await expect(partner.getByText("ელფოსტა ან პაროლი არასწორია.")).toBeVisible();
  await partner.getByLabel("პაროლი").fill(PASSWORD);
  await partner.getByRole("button", { name: "შესვლა", exact: true }).click();
  await expect(partner).toHaveURL(/\/buyer$/);

  // And they can change it.
  await partner.goto("/account/password");
  await expect(partner.getByRole("heading", { name: "პაროლის შეცვლა" })).toBeVisible();
});

async function waitingBuyer(browser: Browser, suffix: string) {
  const category = `[E2E] პროდუქტები ${suffix}`;
  const supplierName = `[E2E] Verify Supplier ${suffix}`;
  const admin = await adminWithCategory(browser, category);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "verify-supplier");
  await onboardSupplier(supplier, supplierName);
  await approveSupplier(admin, supplierName);
  const invitePath = await inviteCustomer(supplier, `[E2E] Waiting ${suffix}`);

  // The invited buyer is on the list only through the supplier's link: not vetted.
  const buyer = await (await browser.newContext()).newPage();
  await signInAsNewUser(buyer, "waiting-buyer", { vetted: false });
  await buyer.goto(invitePath);
  await buyer.waitForLoadState("networkidle");
  await buyer.getByLabel("საიდენტიფიკაციო კოდი").fill(randomLegalId());
  await buyer.getByRole("combobox", { name: "ბიზნესის ტიპი" }).selectOption("restaurant");
  await buyer.getByLabel("საკონტაქტო პირი").fill("Levan");
  await buyer.getByLabel("ქალაქი").fill("თბილისი");
  await buyer.getByLabel("მიწოდების მისამართი").fill("ვაჟა-ფშაველას 10");
  await buyer.getByRole("button", { name: "დაკავშირება" }).click();
  return { admin, supplier, buyer, supplierName };
}

test("a buyer who arrives from a supplier's link waits on a pending page until the admin approves", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36);
  const { admin, supplier, buyer } = await waitingBuyer(browser, suffix);

  // They cannot see anything yet.
  await buyer.goto("/buyer");
  await expect(buyer).toHaveURL(/\/pending$/);
  await expect(buyer.getByRole("heading", { name: "თქვენი ბიზნესი მოწმდება" })).toBeVisible();

  // The supplier sees the connection is waiting for Gusto's check.
  await supplier.goto("/supplier/customers");
  await expect(supplier.getByRole("row", { name: new RegExp(`Waiting ${suffix}`) })).toContainText("ელოდება Gusto-ს გადამოწმებას");

  // The admin finds them in the queue, sees the ID and the invite source, approves.
  await admin.goto("/admin/organizations?type=buyer&status=pending_review");
  await admin.getByRole("link", { name: new RegExp(`Waiting ${suffix}`) }).click();
  await expect(admin.getByText("მოიწვია მომწოდებელმა")).toBeVisible();
  await admin.getByRole("button", { name: "დადასტურება" }).click();

  await buyer.goto("/buyer");
  await expect(buyer).toHaveURL(/\/buyer$/);
});
