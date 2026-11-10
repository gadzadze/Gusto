import { expect, test } from "@playwright/test";
import postgres from "postgres";
import "../../scripts/load-env";
import { randomLegalId, signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, onboardBuyer } from "./flows";

// A buyer invites its supplier: the link opens the join form with the names filled in,
// the request reaches the admin marked with the buyer who invited, and the link is single use.
test("a buyer invites a supplier and the request arrives with the buyer's name", async ({ browser }) => {
  test.setTimeout(180_000);
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from rate_limits`; // the public form is limited to 5 per hour per address
  } finally {
    await sql.end({ timeout: 5 });
  }
  const suffix = Date.now().toString(36);
  const buyerName = `[E2E] Cafe ${suffix}`;
  const supplierName = `[E2E] Dairy ${suffix}`;

  const buyer = await (await browser.newContext()).newPage();
  await signInAsNewUser(buyer, "buyer");
  await onboardBuyer(buyer, buyerName);
  await buyer.goto("/buyer/suppliers");
  await buyer.getByRole("link", { name: "მომწოდებლის მოწვევა" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/suppliers\/invite$/);
  await buyer.waitForLoadState("networkidle");
  // The personal link is ready without a tap: the ready-made text with the link.
  await expect(buyer.getByTestId("personal-link-text")).toContainText("/suppliers/invite/");
  await expect(buyer.getByRole("button", { name: "გაზიარება" })).toBeVisible();
  await buyer.getByLabel("მომწოდებლის დასახელება").fill(supplierName);
  await buyer.getByRole("button", { name: "ბმულის შექმნა" }).click();
  // Neither phone nor email: the buyer has no way to send the link.
  await expect(buyer.getByText("მიუთითეთ ტელეფონი ან ელფოსტა, რომ ბმული გაუგზავნოთ")).toBeVisible();
  await buyer.getByLabel("ტელეფონი (WhatsApp)").fill("599 11 22 33");
  await buyer.getByRole("button", { name: "ბმულის შექმნა" }).click();
  await expect(buyer.getByRole("heading", { name: "მოწვევის ბმული მზადაა" })).toBeVisible();
  const link = await buyer.getByRole("textbox", { name: "მოწვევის ბმული მზადაა" }).inputValue();
  expect(link).toContain("/suppliers/invite/");
  await expect(buyer.getByText(supplierName)).toBeVisible(); // listed as sent
  if (process.env.SHOTS) await buyer.screenshot({ path: `${process.env.SHOTS}/invite-buyer.png`, fullPage: true });

  // The supplier (signed out) opens it: the buyer's name and their own name are already there.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(new URL(link).pathname);
  await visitor.waitForLoadState("networkidle");
  await expect(visitor.getByRole("heading", { name: `${buyerName} გიწვევთ 202-ზე` })).toBeVisible();
  await expect(visitor.getByLabel("კომპანიის დასახელება")).toHaveValue(supplierName);
  if (process.env.SHOTS) await visitor.screenshot({ path: `${process.env.SHOTS}/invite-join.png` });
  await visitor.getByLabel("საიდენტიფიკაციო კოდი").fill(randomLegalId());
  await visitor.getByLabel("საკონტაქტო პირი").fill("Gela");
  await visitor.getByLabel("ტელეფონი").fill("599 11 22 33");
  await visitor.getByLabel("კომპანიის ელფოსტა").fill(`dairy-${suffix}@test.gusto.ge`);
  await visitor.getByLabel("ქალაქი").fill("თბილისი");
  await visitor.getByRole("button", { name: "მოთხოვნის გაგზავნა" }).click();
  await expect(visitor.getByRole("heading", { name: "მოთხოვნა მიღებულია" })).toBeVisible();

  // The link is single use: opening it again shows the plain page with a notice.
  await visitor.goto(new URL(link).pathname);
  await expect(visitor.getByText("ეს მოწვევის ბმული აღარ მოქმედებს")).toBeVisible();
  await expect(visitor.getByLabel("კომპანიის დასახელება")).toHaveValue("");

  // The admin sees who invited them, and the buyer sees the request is being looked at.
  const admin = await adminWithCategory(browser, `[E2E] Invite ${suffix}`);
  await admin.goto("/admin/requests");
  await expect(admin.getByText(`მოიწვია მყიდველმა: ${buyerName}`)).toBeVisible();
  await buyer.goto("/buyer/suppliers/invite");
  await expect(buyer.getByText("მომწოდებელმა მოთხოვნა გამოგვიგზავნა, განიხილება")).toBeVisible();
});
