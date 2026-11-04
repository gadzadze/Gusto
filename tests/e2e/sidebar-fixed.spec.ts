import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { adminWithCategory } from "./flows";

// The desktop sidebar stays put while the page scrolls: its footer (theme, sign out) stays visible.
test("desktop sidebar does not scroll with the page", async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await adminWithCategory(browser, `[E2E] Sidebar ${Date.now().toString(36)}`);
  await admin.setViewportSize({ width: 1280, height: 600 }); // short window: the overview page scrolls
  await admin.goto("/admin");
  await admin.waitForLoadState("networkidle");
  const signOut = admin.getByRole("button", { name: "გასვლა" }).first();
  const logo = admin.getByRole("link").first();
  const before = await signOut.boundingBox();
  await admin.mouse.move(700, 300);
  await admin.mouse.wheel(0, 2000);
  await admin.waitForTimeout(300);
  expect(await admin.evaluate(() => window.scrollY)).toBeGreaterThan(100); // the page did scroll
  const after = await signOut.boundingBox();
  expect(after!.y).toBeCloseTo(before!.y, 0); // and the sidebar footer did not move
  expect(after!.y + after!.height).toBeLessThanOrEqual(600);
  await expect(admin.getByRole("button", { name: "ღია" })).toBeInViewport();
  if (process.env.SHOT) await admin.screenshot({ path: process.env.SHOT });
  void logo;
});
