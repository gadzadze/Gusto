import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, onboardSupplier } from "./flows";

// A price list with only name, unit and price: no category, no codes. The import should
// fill the gaps (guessed categories, generated codes), say so in the preview, and a second
// upload of the same list should update the products instead of duplicating them.
test("a plain name / unit / price list imports with guessed categories and generated codes", async ({ browser }) => {
  test.setTimeout(150_000);
  const suffix = Date.now().toString(36);
  const admin = await adminWithCategory(browser, `[E2E] Plain ${suffix}`);
  await admin.getByRole("button", { name: "ტიპური კატეგორიების დამატება" }).click();
  await expect(admin.getByText(/შეიქმნა: \d+ · უკვე იყო: \d+/)).toBeVisible();

  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, `[E2E] Plain list ${suffix}`);

  const csv = (price: string) =>
    ["დასახელება,ერთეული,ფასი", `ყველი პარმეზანი ${suffix},კგ,30`, `ქათმის უძვლო ბარკალი ${suffix},კგ,"${price}"`, `"რძე 3,2% 1 ლ ${suffix}",ცალი,"3,40 ₾"`, `QZ-77 ${suffix},ცალი,1`].join("\n");
  const upload = async (body: string) => {
    await supplier.goto("/supplier/products/import");
    await supplier.waitForLoadState("networkidle");
    await supplier.locator('input[type="file"]').setInputFiles({ name: "plain.csv", mimeType: "text/csv", buffer: Buffer.from(body, "utf8") });
    await expect(supplier.getByText("ნაპოვნია 4 სტრიქონი")).toBeVisible();
  };

  await upload(csv("8,50"));
  // The fallbacks are switched on because the file has no category and no code column.
  await expect(supplier.getByLabel("კატეგორია, თუ ფაილში არ არის")).toHaveValue("guess");
  await expect(supplier.getByLabel("კოდი (SKU) ავტომატურად შეიქმნას, თუ ფაილში არ არის")).toBeChecked();
  await supplier.getByRole("button", { name: "შემოწმება" }).click();
  await expect(supplier.getByText("დაემატება: 3 · განახლდება: 0 · შეცდომით: 1")).toBeVisible();
  await expect(supplier.getByText(/სახელიდან გამოვიცანით/).first()).toBeVisible();
  await expect(supplier.getByText("კატეგორია სახელით ვერ განისაზღვრა")).toBeVisible();
  await supplier.getByRole("button", { name: /მხოლოდ სწორი სტრიქონების იმპორტი/ }).click();
  await expect(supplier.getByText("დაემატა: 3 · განახლდა: 0 · გამოტოვდა: 1")).toBeVisible();

  // The same list again, with a new price: same generated codes, so all three update.
  await upload(csv("9,00"));
  await supplier.getByRole("button", { name: "შემოწმება" }).click();
  await expect(supplier.getByText("დაემატება: 0 · განახლდება: 3 · შეცდომით: 1")).toBeVisible();
});
