import { expect, test, type Page } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, onboardBuyer, onboardSupplier } from "./flows";

const SHOTS = process.env.NAV_SHOTS_DIR;

// The phone's bottom bar: nothing cut off or wider than the screen, at 360px and 320px.
async function checkBar(page: Page, name: string) {
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForTimeout(200);
    const bar = page.getByRole("navigation", { name: "ნავიგაცია" });
    const result = await bar.evaluate((nav) => {
      // A label is cut off when its text is wider than its slot, or wraps to more than two lines.
      const labels = [...nav.querySelectorAll("a > span:last-child, button > span:last-child")] as HTMLElement[];
      const cut = labels
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 2 + 1)
        .map((el) => el.textContent);
      return { cut, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(result.cut, `${name} labels cut off at ${width}px`).toEqual([]);
    expect(result.pageOverflow, `${name} page wider than ${width}px`).toBe(false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/nav-${name}-${width}.png` });
  }
}

test("phone bottom bar: supplier, buyer and admin fit, and More opens the rest", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);

  const supplier = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await signInAsNewUser(supplier, "supplier");
  await onboardSupplier(supplier, `[E2E] Nav supplier ${suffix}`);
  await supplier.goto("/supplier");
  await supplier.waitForLoadState("networkidle");
  await checkBar(supplier, "supplier");
  // Six items: four in the bar, pricing and settings behind More.
  const more = supplier.getByRole("button", { name: "მეტი" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(supplier.getByRole("link", { name: "ფასები" })).toBeVisible();
  if (SHOTS) await supplier.screenshot({ path: `${SHOTS}/nav-supplier-more.png` });
  await supplier.getByRole("link", { name: "პარამეტრები" }).click();
  await expect(supplier).toHaveURL(/\/supplier\/settings/);
  // The menu closes after choosing, and "More" shows as the active place.
  await expect(supplier.getByRole("link", { name: "ფასები" })).toBeHidden();
  await expect(supplier.getByRole("button", { name: "მეტი" })).toHaveClass(/text-brand/);

  const buyer = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await signInAsNewUser(buyer, "buyer");
  await onboardBuyer(buyer, `[E2E] Nav buyer ${suffix}`);
  await buyer.goto("/buyer");
  await buyer.waitForLoadState("networkidle");
  await checkBar(buyer, "buyer");

  const admin = await adminWithCategory(browser, `[E2E] Nav ${suffix}`);
  await admin.goto("/admin");
  await admin.waitForLoadState("networkidle");
  await checkBar(admin, "admin");
  await admin.getByRole("button", { name: "მეტი" }).click();
  await expect(admin.getByRole("link", { name: "აუდიტის ჟურნალი" })).toBeVisible();
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/nav-admin-more.png` });
  await admin.keyboard.press("Escape");
  await expect(admin.getByRole("link", { name: "აუდიტის ჟურნალი" })).toBeHidden();
});
