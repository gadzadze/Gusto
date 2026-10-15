import { writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import {
  acceptInviteAsNewBuyer,
  adminWithCategory,
  approveSupplier,
  inviteCustomer,
  onboardBuyer,
  onboardSupplier,
} from "./flows";

// Pilot-launch scenarios, end to end, from an empty (migrated, unseeded)
// database: image → buyer catalog, order, dashboards, admin support tools,
// isolation between organizations, and 360px mobile layout.

async function noHorizontalScroll(page: Page, where: string) {
  const { overflow, culprits } = await page.evaluate(() => {
    const width = window.innerWidth;
    const culprits: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > width + 0.5 && culprits.length < 5) {
        culprits.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
      }
    }
    return { overflow: document.documentElement.scrollWidth - width, culprits };
  });
  expect(overflow, `${where}: horizontal overflow at 360px. Elements past the edge: ${culprits.join(" | ")}`).toBeLessThanOrEqual(0);
}

async function touchTargetsOk(page: Page, where: string) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const selector = "main button, main select, main textarea, main input:not([type=hidden]):not([type=file])";
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      // A radio or checkbox inside a <label> is tapped through the whole label.
      const isToggle = el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox");
      const target = isToggle ? (el.closest("label") ?? el) : el;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      if (r.height < 43.5) {
        const name = (target.textContent || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.height)}px`);
      }
    }
    return out;
  });
  expect(small, `${where}: controls under 44px tall`).toEqual([]);
}

/**
 * Other organizations' objects and other roles' areas answer "not found" (never "forbidden").
 * The page streams, so the HTTP status is already 200 by the time the guard fires; the
 * visible result is the not-found page.
 */
async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "გვერდი ვერ მოიძებნა" }), path).toBeVisible();
}

async function newPage(browser: Browser, label: string, vetted = true): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, label, { vetted });
  return page;
}

test("launch scenario - image, catalog, order, dashboards, admin tools, isolation, 360px", async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] პროდუქტები ${suffix}`;
  const supplierName = `[E2E] Launch Supplier ${suffix}`;
  const buyerName = `[E2E] Launch Buyer ${suffix}`;

  const admin = await adminWithCategory(browser, category);

  // A brand-new buyer with nothing connected: the dashboard is an empty state, not an error.
  const fresh = await newPage(browser, "fresh");
  await onboardBuyer(fresh, `[E2E] Fresh ${suffix}`);
  await expect(fresh.getByText("მომწოდებლები ჯერ არ გყავთ")).toBeVisible();

  // Supplier: onboarding, approval, a product with a photo.
  const supplier = await newPage(browser, "launch-supplier", false);
  await onboardSupplier(supplier, supplierName);
  await expect(supplier.getByText("ანგარიში განხილვის პროცესშია")).toBeVisible();
  await approveSupplier(admin, supplierName);

  const photo = testInfo.outputPath("photo.png");
  await writeFile(photo, await sharp({ create: { width: 900, height: 900, channels: 3, background: "#c8d8f5" } }).png().toBuffer());
  await supplier.goto("/supplier");
  await supplier.getByRole("link", { name: "პროდუქტები" }).first().click();
  await supplier.getByRole("link", { name: "ახალი პროდუქტი" }).click();
  await supplier.waitForLoadState("networkidle");
  await supplier.getByLabel("დასახელება").fill("ყველი სულგუნი");
  await supplier.getByRole("combobox", { name: "კატეგორია", exact: true }).selectOption({ label: category });
  await supplier.getByRole("combobox", { name: "ერთეული", exact: true }).selectOption("kg");
  await supplier.getByLabel("ფასი ერთეულზე").fill("18,50");
  // Until React has attached its change handler the chosen file is ignored; the label shows the name once it took.
  await expect(async () => {
    await supplier.locator('input[type="file"]').setInputFiles(photo);
    await expect(supplier.getByText("photo.png")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await supplier.getByRole("button", { name: "პროდუქტის დამატება" }).click();
  await expect(supplier.getByText("პროდუქტი დაემატა")).toBeVisible();
  // The photo is uploaded right after the product is created; wait for it before moving on.
  await expect(supplier.getByRole("img", { name: "ყველი სულგუნი" })).toBeVisible();

  // The supplier's dashboard before any order: an empty state.
  await supplier.goto("/supplier");
  await expect(supplier.getByText("შეკვეთები ჯერ არ არის")).toBeVisible();

  // Connected buyer sees the product with its photo.
  const invitePath = await inviteCustomer(supplier, buyerName);
  const buyer = await newPage(browser, "launch-buyer");
  await acceptInviteAsNewBuyer(buyer, invitePath);
  await buyer.waitForLoadState("networkidle");
  const supplierId = buyer.url().match(/\/buyer\/suppliers\/([0-9a-f-]{36})/)![1];
  const image = buyer.locator("main img").first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /\/storage\/v1\/object\/public\/product-images\/.+-w(400|1200)\.webp$/);
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // Order it.
  await buyer.getByRole("button", { name: "დამატება: ყველი სულგუნი" }).click();
  await expect(buyer.getByRole("button", { name: "რაოდენობის გაზრდა: ყველი სულგუნი" })).toBeVisible();
  await buyer.getByRole("link", { name: /შეკვეთის გაფორმება/ }).click();
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("button", { name: "შეკვეთის გაგზავნა" }).click();
  await expect(buyer).toHaveURL(/\/buyer\/orders\/[0-9a-f-]{36}\?placed=1$/);
  const orderId = buyer.url().match(/orders\/([0-9a-f-]{36})/)![1];
  const number = (await buyer.getByRole("heading", { level: 1 }).textContent())!.match(/GST-(\d+)/)![1];

  // Supplier dashboard: one order waiting; after confirming, its value counts, as "order value".
  const tile = (label: string) => supplier.getByText(label, { exact: true }).locator("xpath=..");
  await supplier.goto("/supplier");
  await expect(tile("ელოდება თქვენს გადაწყვეტილებას").locator("p").nth(1)).toHaveText("1");
  await expect(tile("შეკვეთები ბოლო 7 დღეში").locator("p").nth(1)).toHaveText("1");
  await supplier.goto(`/supplier/orders/${orderId}`);
  await supplier.waitForLoadState("networkidle");
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await supplier.getByRole("button", { name: "დადასტურება" }).click();
  await expect(supplier.getByText("დადასტურებული").first()).toBeVisible();
  await supplier.goto("/supplier");
  await expect(tile("ელოდება თქვენს გადაწყვეტილებას").locator("p").nth(1)).toHaveText("0");
  await expect(tile("შეკვეთების ღირებულება, 30 დღე").locator("p").nth(1)).toContainText("18,50");
  await expect(tile("ტოპ 5 პროდუქტი, 30 დღე")).toContainText("ყველი სულგუნი");
  await expect(supplier.getByText("შეკვეთილი თანხაა და არა შემოსავალი", { exact: false })).toBeVisible();
  await expect(supplier.locator("main")).not.toContainText("გაყიდვ");

  // Buyer dashboard: open order, most-ordered product with quick add, order again.
  await buyer.goto("/buyer");
  await expect(buyer.getByRole("heading", { name: "მიმდინარე შეკვეთები" })).toBeVisible();
  await expect(buyer.getByRole("link", { name: new RegExp(`GST-${number}`) }).first()).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "ყველაზე ხშირად შეკვეთილი პროდუქტები" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "დამატება: ყველი სულგუნი" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "ხელახლა შეკვეთა" }).first()).toBeVisible();

  // Admin overview: pilot metrics from real rows.
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "პილოტის მაჩვენებლები" })).toBeVisible();
  await expect(admin.getByText("აქტიური მომწოდებლები", { exact: true })).toBeVisible();
  await expect(admin.getByText("ყოველკვირეული განმეორებითი შეკვეთა", { exact: true })).toBeVisible();

  // Admin: order lookup is read-only and audited.
  await admin.goto("/admin/orders");
  await admin.getByLabel("შეკვეთის ნომერი").fill(`GST-${number}`);
  await admin.getByRole("button", { name: "ძიება" }).click();
  await expect(admin).toHaveURL(new RegExp(`/admin/orders/${number}$`));
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(`GST-${number}`);
  await expect(admin.getByText(buyerName).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "დადასტურება" })).toHaveCount(0);
  await admin.goto("/admin/orders?number=abc");
  await expect(admin.getByText("ნომერი არასწორია")).toBeVisible();
  await expectNotFound(admin, "/admin/orders/99999999");

  await admin.goto("/admin/audit?action=order.view");
  await expect(admin.getByRole("cell", { name: "order.view" }).first()).toBeVisible();

  // Admin: find the buyer, suspend with a reason; the buyer can't order; reactivate.
  await admin.goto("/admin/organizations");
  await admin.getByRole("textbox", { name: "ძიება" }).fill(buyerName);
  await admin.getByRole("button", { name: "ძიება" }).click();
  await admin.getByRole("link", { name: buyerName }).click();
  await admin.waitForLoadState("networkidle");
  await admin.getByRole("button", { name: "შეჩერება" }).click();
  await admin.getByLabel("მიზეზი").fill("[E2E] ტესტი");
  await admin.getByRole("button", { name: "შეჩერების დადასტურება" }).click();
  await expect(admin.getByRole("button", { name: "აღდგენა" })).toBeVisible();

  await buyer.goto("/buyer/orders");
  await buyer.goto(`/buyer/orders/${orderId}`);
  await buyer.getByRole("button", { name: "ხელახლა შეკვეთა" }).click();
  await buyer.waitForURL(/\/buyer\/cart/);
  await buyer.getByRole("link", { name: /შეკვეთის გაფორმება/ }).click();
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("button", { name: "შეკვეთის გაგზავნა" }).click();
  await expect(buyer.getByText("თქვენი ორგანიზაცია შეჩერებულია")).toBeVisible();

  await admin.getByRole("button", { name: "აღდგენა" }).click();
  await admin.getByLabel("მიზეზი").fill("[E2E] ტესტი დასრულდა");
  await admin.getByRole("button", { name: "აღდგენის დადასტურება" }).click();
  await expect(admin.getByRole("button", { name: "შეჩერება" })).toBeVisible();
  await admin.goto("/admin/audit?action=buyer.suspend");
  await expect(admin.getByRole("cell", { name: "buyer.suspend" }).first()).toBeVisible();

  // Isolation. A stranger buyer, another supplier, a signed-out visitor, and role escalation.
  const stranger = await newPage(browser, "stranger");
  await onboardBuyer(stranger, `[E2E] Stranger ${suffix}`);
  await expectNotFound(stranger, `/buyer/suppliers/${supplierId}`);
  await expectNotFound(stranger, `/buyer/orders/${orderId}`);
  await expectNotFound(stranger, `/o/${number}`);
  await expectNotFound(stranger, "/supplier");
  await expectNotFound(stranger, "/admin");
  await expectNotFound(stranger, "/admin/audit");
  await expectNotFound(stranger, "/admin/orders/" + number);

  const otherSupplier = await newPage(browser, "other-supplier");
  await onboardSupplier(otherSupplier, `[E2E] Other Supplier ${suffix}`);
  await expectNotFound(otherSupplier, `/supplier/orders/${orderId}`);
  await expectNotFound(otherSupplier, `/o/${number}`);
  await expectNotFound(otherSupplier, "/buyer");
  await expectNotFound(otherSupplier, "/admin/organizations");

  // The buyer can't reach supplier or admin areas; a forged action request is refused.
  await expectNotFound(buyer, "/supplier/orders");
  await expectNotFound(buyer, "/admin/organizations");
  const forged = await buyer.request.post("/supplier/orders", {
    headers: { "Next-Action": "7f".repeat(20), "Content-Type": "text/plain;charset=UTF-8" },
    data: "[]",
  });
  expect(forged.ok(), `forged action answered ${forged.status()}`).toBe(false);

  const signedOut = await (await browser.newContext()).newPage();
  for (const path of ["/buyer", "/supplier/orders", `/supplier/orders/${orderId}`, "/admin/audit", `/o/${number}`]) {
    await signedOut.goto(path);
    await expect(signedOut, path).toHaveURL(/\/login\?next=/);
  }

  // 360px: catalog, cart, checkout, supplier order page, and the dashboards, with no sideways scroll.
  await buyer.setViewportSize({ width: 360, height: 740 });
  await supplier.setViewportSize({ width: 360, height: 740 });
  await admin.setViewportSize({ width: 360, height: 740 });

  await buyer.goto(`/buyer/suppliers/${supplierId}`);
  await buyer.waitForLoadState("networkidle");
  await noHorizontalScroll(buyer, "catalog");
  await touchTargetsOk(buyer, "catalog");

  await buyer.goto("/buyer");
  await noHorizontalScroll(buyer, "buyer dashboard");
  await touchTargetsOk(buyer, "buyer dashboard");

  await buyer.goto("/buyer/cart");
  await buyer.waitForLoadState("networkidle");
  await noHorizontalScroll(buyer, "cart");
  await touchTargetsOk(buyer, "cart");

  await buyer.goto(`/buyer/checkout/${supplierId}`);
  await buyer.waitForLoadState("networkidle");
  await noHorizontalScroll(buyer, "checkout");
  await touchTargetsOk(buyer, "checkout");

  await supplier.goto(`/supplier/orders/${orderId}`);
  await supplier.waitForLoadState("networkidle");
  await noHorizontalScroll(supplier, "supplier order page");
  await touchTargetsOk(supplier, "supplier order page");

  await supplier.goto("/supplier");
  await noHorizontalScroll(supplier, "supplier dashboard");
  await supplier.goto("/supplier/notifications");
  await noHorizontalScroll(supplier, "notifications");
  await admin.goto("/admin");
  await noHorizontalScroll(admin, "admin overview");
  await admin.goto("/admin/audit");
  await noHorizontalScroll(admin, "audit log");
});
