import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import "../../scripts/load-env";
import { grantAdmin, signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, approveSupplier, inviteCustomer, onboardSupplier } from "./flows";

// Sign-in is invite-only: unknown addresses get no link, the admin manages the
// allow-list, and a valid invitation link opens the door for its recipient.

const NOT_REGISTERED = "ეს ელფოსტა რეგისტრირებული არ არის";
const SENT = "შეამოწმეთ ელფოსტა";

async function requestLink(page: Page, email: string, next = "") {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("ელფოსტა").fill(email);
  await page.getByRole("button", { name: "შესვლის ბმულის გაგზავნა" }).click();
}

test("an unregistered address gets no sign-in link", async ({ page }) => {
  await requestLink(page, `nobody-${Date.now().toString(36)}@test.gusto.ge`);
  await expect(page.getByText(NOT_REGISTERED)).toBeVisible();
  await expect(page.getByText(SENT, { exact: true })).toHaveCount(0);
});

test("admin registers an address, it can sign in, revoking blocks it again", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await (await browser.newContext()).newPage();
  const adminEmail = await signInAsNewUser(admin, "access-admin");
  grantAdmin(adminEmail);

  const person = `winiveria-${Date.now().toString(36)}@test.gusto.ge`;
  await admin.goto("/admin/access");
  await admin.waitForLoadState("networkidle");
  await admin.getByLabel("ელფოსტა", { exact: true }).fill(person);
  await admin.getByLabel("შენიშვნა").fill("[E2E] pilot supplier");
  await admin.getByRole("button", { name: "დამატება" }).click();
  await expect(admin.getByText("ელფოსტა დაემატა.")).toBeVisible();
  const row = admin.getByRole("listitem").filter({ hasText: person });
  await expect(row).toContainText("აქვს წვდომა");
  await expect(row).toContainText("[E2E] pilot supplier");

  // Now the address can ask for a link (a fresh visitor, not the admin's session).
  const visitor = await (await browser.newContext()).newPage();
  await requestLink(visitor, person);
  await expect(visitor.getByText(SENT, { exact: true })).toBeVisible();

  // Revoke: the same request is refused.
  await row.getByRole("button", { name: "გაუქმება" }).click();
  await expect(row).toContainText("გაუქმებულია");
  await requestLink(visitor, person);
  await expect(visitor.getByText(NOT_REGISTERED)).toBeVisible();

  // Restore.
  await row.getByRole("button", { name: "აღდგენა" }).click();
  await expect(row).toContainText("აქვს წვდომა");
  await requestLink(visitor, person);
  await expect(visitor.getByText(SENT, { exact: true })).toBeVisible();

  // An admin can't lock themselves out.
  const own = admin.getByRole("listitem").filter({ hasText: adminEmail });
  await own.getByRole("button", { name: "გაუქმება" }).click();
  await expect(admin.getByText("საკუთარ ელფოსტაზე წვდომას ვერ გააუქმებთ.")).toBeVisible();

  // Non-admins can't open the page.
  await visitor.goto("/admin/access");
  await expect(visitor).toHaveURL(/\/login\?next=/);
});

test("an account that is not on the list is signed out at the door (second line of defence)", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `uninvited-${Date.now().toString(36)}@test.gusto.ge`;
  // As if Supabase had created the user itself (e.g. through Google), without our allow-list.
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;

  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
  await expect(page).toHaveURL(/\/login\?error=not_allowed$/);
  await expect(page.getByText(NOT_REGISTERED)).toBeVisible();
  // And no session: protected pages send them to login.
  await page.goto("/buyer");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a supplier's invitation link lets its recipient request a sign-in link", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] პროდუქტები ${suffix}`;
  const supplierName = `[E2E] Access Supplier ${suffix}`;
  const admin = await adminWithCategory(browser, category);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "access-supplier");
  await onboardSupplier(supplier, supplierName);
  await approveSupplier(admin, supplierName);
  const invitePath = await inviteCustomer(supplier, `[E2E] Invited ${suffix}`);

  const visitor = await (await browser.newContext()).newPage();
  const stranger = `invited-${suffix}@test.gusto.ge`;
  // Without the link: refused.
  await requestLink(visitor, stranger);
  await expect(visitor.getByText(NOT_REGISTERED)).toBeVisible();
  // With the link in `next` (what the invite page sends signed-out visitors to): allowed.
  await requestLink(visitor, stranger, invitePath);
  await expect(visitor.getByText(SENT, { exact: true })).toBeVisible();
  // A made-up link is not enough.
  await requestLink(visitor, `other-${suffix}@test.gusto.ge`, `/invite/${"A".repeat(43)}`);
  await expect(visitor.getByText(NOT_REGISTERED)).toBeVisible();
});

test("a registered role skips the choice, and a waiting supplier shows up on the admin badge", async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = await (await browser.newContext()).newPage();
  const adminEmail = await signInAsNewUser(admin, "role-admin");
  grantAdmin(adminEmail);

  const supplierEmail = `pinned-${Date.now().toString(36)}@test.gusto.ge`;
  await admin.goto("/admin/access");
  await admin.waitForLoadState("networkidle");
  await admin.getByLabel("ელფოსტა", { exact: true }).fill(supplierEmail);
  await admin.getByLabel("როლი").selectOption("supplier");
  await admin.getByRole("button", { name: "დამატება" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: supplierEmail })).toContainText("მომწოდებელი");

  // Sign that address in (what clicking the emailed link does).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const api = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const link = await api.auth.admin.generateLink({ type: "magiclink", email: supplierEmail });
  if (link.error) throw link.error;
  const supplier = await (await browser.newContext()).newPage();
  await supplier.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
  await expect(supplier).toHaveURL(/\/onboarding$/);

  // No "how do you use Gusto?" choice: straight to the supplier form.
  await expect(supplier.getByText("როგორ იყენებთ Gusto-ს?")).toBeHidden();
  await expect(supplier.getByLabel("სავაჭრო სახელი")).toBeVisible();
  await supplier.getByLabel("სავაჭრო სახელი").fill(`[E2E] Pinned Supplier ${Date.now().toString(36)}`);
  await supplier.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await supplier.getByLabel("ტელეფონი").fill("599 00 00 00");
  await supplier.getByLabel("ქალაქი").fill("თბილისი");
  await supplier.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await supplier.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(supplier).toHaveURL(/\/supplier$/);

  // The admin sees a number next to "Suppliers".
  await admin.goto("/admin");
  const suppliersLink = admin.getByRole("link", { name: /მომწოდებლები/ }).first();
  await expect(suppliersLink.locator("span[aria-label]")).toHaveText(/^\d+$/);
});
