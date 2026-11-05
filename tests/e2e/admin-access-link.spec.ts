import { expect, test } from "@playwright/test";
import { grantAdmin, signInAsNewUser } from "./auth-helpers";

// No email provider yet: the admin hands the first sign-in link over on WhatsApp.

test("an admin creates a one-time sign-in link and the person gets in with it", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const email = `handover-${suffix}@test.gusto.ge`;

  const admin = await (await browser.newContext()).newPage();
  grantAdmin(await signInAsNewUser(admin, "handover-admin"));
  await admin.goto("/admin/access");
  await admin.waitForLoadState("networkidle");
  await admin.getByLabel("ელფოსტა", { exact: true }).first().fill(email);
  await admin.getByRole("button", { name: "დამატება", exact: true }).click();
  const row = admin.getByRole("listitem").filter({ hasText: email });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "ბმულის შექმნა" }).click();
  const whatsapp = row.getByRole("link", { name: "WhatsApp-ით გაგზავნა" });
  await expect(whatsapp).toBeVisible();
  await expect(row.getByText("ტელეფონი ცნობილი არ არის")).toBeVisible();
  const href = (await whatsapp.getAttribute("href")) ?? "";
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
  const link = text.match(/https?:\/\/\S+\/auth\/continue\?\S+/)?.[0];
  expect(link).toBeTruthy();

  // The person opens it and lands on choosing a password (their first sign-in).
  const person = await (await browser.newContext()).newPage();
  const path = new URL(link!).pathname + new URL(link!).search;
  // A link preview (WhatsApp, mail scanners) only fetches the page: that must not use the token up.
  const preview = await person.request.get(path);
  expect(preview.ok()).toBe(true);
  await person.goto(path);
  await expect(person).toHaveURL(/\/auth\/continue\?/);
  await person.getByRole("button", { name: "გაგრძელება" }).click();
  await expect(person).toHaveURL(/\/account\/password$/);
});
