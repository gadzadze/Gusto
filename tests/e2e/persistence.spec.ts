import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { signInAsNewUser } from "./auth-helpers";
import {
  acceptInviteAsNewBuyer,
  adminWithCategory,
  approveSupplier,
  createProduct,
  inviteCustomer,
  onboardSupplier,
} from "./flows";

// Everything lives in Postgres, nothing in the server process: stop the web
// server in the middle of an order's life, start a fresh one, and carry on.
// This spec runs its own server (same production build) on another port so it
// can stop and start it.

const PORT = 3101;
test.use({ baseURL: `http://localhost:${PORT}` });

function startServer(): ChildProcess {
  return spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(PORT)], {
    env: process.env,
    stdio: "ignore",
  });
}

async function isUp(): Promise<boolean> {
  try {
    return (await fetch(`http://localhost:${PORT}/login`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function waitUntil(up: boolean, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    if ((await isUp()) === up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ${up ? "ready" : "unreachable"} in ${seconds}s`);
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}

test("an order survives a full restart of the web server", async ({ browser }) => {
  test.setTimeout(300_000);
  let server = startServer();
  try {
    await waitUntil(true);
    const suffix = Date.now().toString(36);
    const category = `[E2E] პროდუქტები ${suffix}`;
    const supplierName = `[E2E] Restart Supplier ${suffix}`;

    const admin = await adminWithCategory(browser, category);
    const supplier = await (await browser.newContext()).newPage();
    await signInAsNewUser(supplier, "restart-supplier");
    await onboardSupplier(supplier, supplierName);
    await approveSupplier(admin, supplierName);
    await createProduct(supplier, { name: "მაწონი", category, price: "2,40", unit: "piece" });
    const invitePath = await inviteCustomer(supplier, `[E2E] Restart Buyer ${suffix}`);

    const buyer = await (await browser.newContext()).newPage();
    await signInAsNewUser(buyer, "restart-buyer");
    await acceptInviteAsNewBuyer(buyer, invitePath);
    await buyer.waitForLoadState("networkidle");
    await buyer.getByRole("button", { name: "დამატება: მაწონი" }).click();
    await expect(buyer.getByRole("button", { name: "რაოდენობის გაზრდა: მაწონი" })).toBeVisible();
    await buyer.getByRole("link", { name: /შეკვეთის გაფორმება/ }).click();
    await buyer.waitForLoadState("networkidle");
    await buyer.getByRole("button", { name: "შეკვეთის გაგზავნა" }).click();
    await expect(buyer).toHaveURL(/\/buyer\/orders\/[0-9a-f-]{36}\?placed=1$/);
    const orderPath = new URL(buyer.url()).pathname;
    const number = (await buyer.getByRole("heading", { level: 1 }).textContent())!.match(/GST-(\d+)/)![1];

    // Stop the server for real: nothing answers.
    await stopServer(server);
    await waitUntil(false);

    server = startServer();
    await waitUntil(true);

    // Same sessions, brand-new process: the buyer's order is still there and still pending.
    await buyer.goto(orderPath);
    await expect(buyer.getByRole("heading", { level: 1 })).toContainText(`GST-${number}`);
    await expect(buyer.getByText("ახალი").first()).toBeVisible();

    // The supplier finds it in the inbox, with its notification, and can confirm it.
    await supplier.goto("/supplier/orders");
    await expect(supplier.getByRole("link", { name: new RegExp(`GST-${number}`) })).toBeVisible();
    await supplier.goto("/supplier/notifications");
    await expect(supplier.getByRole("button", { name: new RegExp(`ახალი შეკვეთა GST-${number}`) })).toBeVisible();
    await supplier.goto(`/o/${number}`);
    await supplier.waitForLoadState("networkidle");
    await supplier.getByRole("button", { name: "დადასტურება" }).click();
    await supplier.getByRole("button", { name: "დადასტურება" }).click();
    await expect(supplier.getByText("დადასტურებული").first()).toBeVisible();

    await buyer.goto(orderPath);
    await expect(buyer.getByText("დადასტურებული").first()).toBeVisible();
  } finally {
    await stopServer(server);
  }
});
