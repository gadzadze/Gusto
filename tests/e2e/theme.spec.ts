import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { onboardSupplier } from "./flows";

const SHOTS = process.env.THEME_SHOTS_DIR;

// The theme follows the device until the visitor chooses, and the choice sticks.
test("light and dark themes: follows the device, can be chosen, and is remembered", async ({ browser }) => {
  test.setTimeout(120_000);
  const theme = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = (page: import("@playwright/test").Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // A dark device gets dark by default.
  const dark = await (await browser.newContext({ colorScheme: "dark" })).newPage();
  await dark.goto("/login");
  expect(await theme(dark)).toBe("dark");
  expect(await bg(dark)).toBe("rgb(11, 11, 12)");
  if (SHOTS) await dark.screenshot({ path: `${SHOTS}/login-dark.png` });

  // Choosing light overrides the device, survives a reload, and "device" goes back to following it.
  await dark.getByRole("button", { name: "ღია" }).click();
  expect(await theme(dark)).toBe("light");
  expect(await bg(dark)).toBe("rgb(255, 255, 255)");
  await dark.reload();
  expect(await theme(dark)).toBe("light");
  await expect(dark.getByRole("button", { name: "ღია" })).toHaveAttribute("aria-pressed", "true");
  if (SHOTS) await dark.screenshot({ path: `${SHOTS}/login-light.png` });
  await dark.getByRole("button", { name: "მოწყობილობის მიხედვით" }).click();
  expect(await theme(dark)).toBe("dark");

  // A light device gets light, and can choose dark.
  const light = await (await browser.newContext({ colorScheme: "light" })).newPage();
  await light.goto("/login");
  expect(await theme(light)).toBe("light");
  await light.getByRole("button", { name: "მუქი" }).click();
  expect(await theme(light)).toBe("dark");

  // Inside the app (shell, nav, cards) in both themes, desktop and phone width.
  const suffix = Date.now().toString(36);
  const supplier = await (await browser.newContext({ colorScheme: "dark" })).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, `[E2E] Theme ${suffix}`);
  await supplier.goto("/supplier");
  await supplier.waitForLoadState("networkidle");
  for (const [name, label] of [["dark", "მუქი"], ["light", "ღია"]] as const) {
    await supplier.getByRole("button", { name: label }).first().click();
    expect(await theme(supplier)).toBe(name);
    if (SHOTS) {
      await supplier.waitForTimeout(400); // colour transitions
      await supplier.setViewportSize({ width: 1280, height: 800 });
      await supplier.screenshot({ path: `${SHOTS}/app-${name}.png` });
      await supplier.setViewportSize({ width: 360, height: 740 });
      await supplier.waitForTimeout(300);
      await supplier.screenshot({ path: `${SHOTS}/app-${name}-phone.png` });
      await supplier.goto("/supplier/products");
      await supplier.waitForLoadState("networkidle");
      await supplier.screenshot({ path: `${SHOTS}/products-${name}-phone.png` });
      await supplier.goto("/supplier");
      await supplier.setViewportSize({ width: 1280, height: 800 });
    }
  }

  // On a phone the header has one button that cycles light, dark, device.
  await supplier.setViewportSize({ width: 360, height: 740 });
  await supplier.goto("/supplier");
  await supplier.waitForLoadState("networkidle");
  const cycle = supplier.getByRole("button", { name: /^ფერთა სქემა:/ });
  const box = await cycle.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const before = await theme(supplier);
  await cycle.click();
  await cycle.click();
  await cycle.click(); // a full cycle returns to the starting choice
  expect(await theme(supplier)).toBe(before);
});
