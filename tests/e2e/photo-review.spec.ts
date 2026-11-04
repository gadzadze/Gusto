import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { onboardSupplier } from "./flows";

// The photo review page and the product list buttons render for a supplier. (The search itself
// talks to Open Food Facts and is covered by integration tests with a fake service.)
test("supplier sees the photo buttons and the photo review page", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const supplier = await (await browser.newContext()).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, `[E2E] Photos review ${suffix}`);
  await supplier.goto("/supplier/products");
  await expect(supplier.getByRole("button", { name: "ფოტოების ძიება შტრიხკოდით" })).toBeVisible();
  await supplier.getByRole("link", { name: "ფოტოების შერჩევა სახელით" }).click();
  await expect(supplier.getByRole("heading", { name: "ფოტოების შერჩევა" })).toBeVisible();
  await expect(supplier.getByText("ყველა პროდუქტს ფოტო აქვს")).toBeVisible();
});
