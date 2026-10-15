import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { grantAdmin, randomLegalId, signInAsNewUser } from "./auth-helpers";

// A supplier who got a partner's WhatsApp message opens the public page and
// asks to be onboarded; the admin checks and approves; they then sign in
// as an already-vetted (active) supplier.

test("a prospective supplier asks to be onboarded and the admin approves", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const email = `winery-${suffix}@test.gusto.ge`;
  const legalId = randomLegalId();
  const name = `[E2E] Winery ${suffix}`;

  // 1. The public page: explains Gusto, and a bad legal ID is refused.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/suppliers");
  await visitor.waitForLoadState("networkidle");
  await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
  await visitor.getByLabel("კომპანიის დასახელება").fill(name);
  await visitor.getByLabel("საიდენტიფიკაციო კოდი").fill("12345");
  await visitor.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await visitor.getByLabel("ტელეფონი").fill("599 00 00 00");
  await visitor.getByLabel("კომპანიის ელფოსტა").fill(email);
  await visitor.getByLabel("ქალაქი").fill("თბილისი");
  await visitor.getByRole("button", { name: "მოთხოვნის გაგზავნა" }).click();
  await expect(visitor.getByText("კოდი უნდა შედგებოდეს 9 ან 11 ციფრისგან")).toBeVisible();

  await visitor.getByLabel("კომპანიის დასახელება").fill(name);
  await visitor.getByLabel("საიდენტიფიკაციო კოდი").fill(legalId);
  await visitor.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await visitor.getByLabel("ტელეფონი").fill("599 00 00 00");
  await visitor.getByLabel("კომპანიის ელფოსტა").fill(email);
  await visitor.getByLabel("ქალაქი").fill("თბილისი");
  await visitor.getByRole("button", { name: "მოთხოვნის გაგზავნა" }).click();
  await expect(visitor.getByRole("heading", { name: "მოთხოვნა მიღებულია" })).toBeVisible();

  // It gave no access: this address still can't get a sign-in link.
  await visitor.goto("/login");
  await visitor.waitForLoadState("networkidle");
  await visitor.getByLabel("ელფოსტა").fill(email);
  await visitor.getByRole("button", { name: "პირველი შესვლა — გამომიგზავნეთ ბმული" }).click();
  await expect(visitor.getByText("ეს ელფოსტა რეგისტრირებული არ არის")).toBeVisible();

  // 2. The admin sees it, and the sidebar count.
  const admin = await (await browser.newContext()).newPage();
  grantAdmin(await signInAsNewUser(admin, "request-admin"));
  await admin.goto("/admin/requests");
  await admin.waitForLoadState("networkidle");
  const card = admin.getByRole("listitem").filter({ hasText: name });
  await expect(card).toContainText(legalId);
  await expect(card).toContainText(email);
  await card.getByRole("button", { name: "დაკავშირებულია" }).click();
  await expect(card).toContainText("დაკავშირებულია");

  // 3. Approve: the address is now registered as a vetted supplier.
  await card.getByRole("button", { name: "დადასტურება" }).click();
  await expect(admin.getByText("დადასტურდა.", { exact: false }).first()).toBeVisible();
  await admin.goto("/admin/access");
  await expect(admin.getByRole("listitem").filter({ hasText: email })).toContainText(legalId);

  // 4. They sign in (the emailed link), choose a password and onboard as an active supplier.
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const link = await api.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const supplier = await (await browser.newContext()).newPage();
  await supplier.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`);
  await expect(supplier).toHaveURL(/\/account\/password$/);
  await supplier.waitForLoadState("networkidle");
  await supplier.getByLabel("ახალი პაროლი").fill("a-long-enough-password");
  await supplier.getByLabel("გაიმეორეთ პაროლი").fill("a-long-enough-password");
  await supplier.getByRole("button", { name: "პაროლის შენახვა" }).click();
  await expect(supplier).toHaveURL(/\/onboarding$/);
  await expect(supplier.getByLabel("საიდენტიფიკაციო კოდი")).toHaveValue(legalId);
  await expect(supplier.getByLabel("სავაჭრო სახელი")).toHaveValue(name);
  await supplier.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await supplier.getByLabel("ტელეფონი").fill("599 00 00 00");
  await supplier.getByLabel("ქალაქი").fill("თბილისი");
  await supplier.getByLabel("მიწოდების არეალი").fill("თბილისი");
  await supplier.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(supplier).toHaveURL(/\/supplier$/);
  // Active at once: no "awaiting review" banner.
  await expect(supplier.getByRole("status")).toHaveCount(0);

  // 5. A second submission of the same business shows the same thank-you (nothing leaks).
  await visitor.goto("/suppliers");
  await visitor.waitForLoadState("networkidle");
  await visitor.getByLabel("კომპანიის დასახელება").fill(name);
  await visitor.getByLabel("საიდენტიფიკაციო კოდი").fill(legalId);
  await visitor.getByLabel("საკონტაქტო პირი").fill("Giorgi");
  await visitor.getByLabel("ტელეფონი").fill("599 00 00 00");
  await visitor.getByLabel("კომპანიის ელფოსტა").fill(email);
  await visitor.getByLabel("ქალაქი").fill("თბილისი");
  await visitor.getByRole("button", { name: "მოთხოვნის გაგზავნა" }).click();
  await expect(visitor.getByRole("heading", { name: "მოთხოვნა მიღებულია" })).toBeVisible();
});

test("a rejected request needs a reason", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const name = `[E2E] Reject ${suffix}`;
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/suppliers");
  await visitor.waitForLoadState("networkidle");
  await visitor.getByLabel("კომპანიის დასახელება").fill(name);
  await visitor.getByLabel("საიდენტიფიკაციო კოდი").fill(randomLegalId());
  await visitor.getByLabel("საკონტაქტო პირი").fill("Nika");
  await visitor.getByLabel("ტელეფონი").fill("599 11 22 33");
  await visitor.getByLabel("კომპანიის ელფოსტა").fill(`reject-${suffix}@gmail.com`);
  await visitor.getByLabel("ქალაქი").fill("ბათუმი");
  await visitor.getByRole("button", { name: "მოთხოვნის გაგზავნა" }).click();
  await expect(visitor.getByRole("heading", { name: "მოთხოვნა მიღებულია" })).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  grantAdmin(await signInAsNewUser(admin, "request-admin2"));
  await admin.goto("/admin/requests");
  await admin.waitForLoadState("networkidle");
  const card = admin.getByRole("listitem").filter({ hasText: name });
  // A personal mailbox is flagged.
  await expect(card).toContainText("პირადი ელფოსტაა");
  await card.getByRole("button", { name: "უარყოფა" }).click();
  await card.getByRole("button", { name: "უარყოფის დადასტურება" }).click();
  await expect(admin.getByText("უარყოფისას მიზეზი სავალდებულოა.")).toBeVisible();
  await card.getByLabel("მიზეზი").fill("Could not reach the owner");
  await card.getByRole("button", { name: "უარყოფის დადასტურება" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  await admin.goto("/admin/requests?filter=rejected");
  await expect(admin.getByRole("listitem").filter({ hasText: name })).toContainText("Could not reach the owner");
});
