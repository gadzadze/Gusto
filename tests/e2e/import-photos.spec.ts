import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, onboardSupplier } from "./flows";

// An .xlsx with a picture in each product row: the preview shows the pictures,
// and after the import each one is attached to its product.
test("pictures placed in an xlsx are previewed and attached to their products", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);
  const admin = await adminWithCategory(browser, `[E2E] Photos ${suffix}`);
  await admin.getByRole("button", { name: "ტიპური კატეგორიების დამატება" }).click();
  await expect(admin.getByText(/შეიქმნა: \d+ · უკვე იყო: \d+/)).toBeVisible();

  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, `[E2E] Photo list ${suffix}`);

  await supplier.goto("/supplier/products/import");
  await supplier.waitForLoadState("networkidle");
  await supplier.locator('input[type="file"]').setInputFiles("tests/unit/fixtures/gusto-products-with-photos.xlsx");
  await expect(supplier.getByText("ნაპოვნია 6 სტრიქონი")).toBeVisible();
  await supplier.getByRole("button", { name: "შემოწმება" }).click();
  await expect(supplier.getByText("ფაილში ნაპოვნია ფოტო: 6. ფოტოს გარეშეა: 0.")).toBeVisible();
  await expect(supplier.getByRole("img", { name: "წყალი ბორჯომი 0,5 ლ" })).toBeVisible();

  await supplier.getByRole("button", { name: /იმპორტი/ }).first().click();
  await expect(supplier.getByText("ფოტო დაემატა: 6. ვერ დაემატა: 0.")).toBeVisible({ timeout: 90_000 });
});
