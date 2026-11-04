import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { adminWithCategory } from "./flows";

test("the admin creates the categories a product file needs in one step", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const known = `[E2E] ცნობილი ${suffix}`;
  const fresh1 = `[E2E] ახალი ა ${suffix}`;
  const fresh2 = `[E2E] ახალი ბ ${suffix}`;
  const admin = await adminWithCategory(browser, known);

  await admin.goto("/admin/categories");
  await admin.waitForLoadState("networkidle");
  const csv = ["სახელი,კატეგორია,ერთეული,ფასი", `ა,${known},კგ,1`, `ბ,${fresh1},კგ,2`, `გ,${fresh2},კგ,3`, `დ,${fresh1.toUpperCase()},კგ,4`].join("\n");
  await admin.locator('input[type="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

  // Only the two new names are offered; the known one is counted as already there.
  await expect(admin.getByText("შეიქმნება ახალი კატეგორია: 2")).toBeVisible();
  await expect(admin.getByRole("listitem").filter({ hasText: fresh1 }).first()).toBeVisible();
  await expect(admin.getByText("უკვე არსებობს: 1")).toBeVisible();
  await admin.getByRole("button", { name: "2 კატეგორიის შექმნა" }).click();
  await expect(admin.getByText("შეიქმნა: 2")).toBeVisible();
  await expect(admin.getByText(fresh2)).toBeVisible();
});
