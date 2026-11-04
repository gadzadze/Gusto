import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import "../../scripts/load-env";
import { MODELS } from "../../src/lib/image/background-removal/config";
import { signInAsNewUser } from "./auth-helpers";
import { adminWithCategory, onboardSupplier } from "./flows";

// Needs a browser with a real GPU (WebGPU) and the model file, so it only runs on request.
// NOT yet run to completion: the cloud sandbox has no GPU and software WebGPU crashes on this model.
//
//   E2E_BG_MODEL_DIR  folder holding model.onnx and/or model_fp16.onnx (the files from MODELS)
//   E2E_BG_PHOTO      a product photo to clean
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE  as usual
// Only the model file for the device (model_fp16.onnx with shader-f16, else model.onnx) is needed.
// The model request is answered from disk, so nothing is downloaded; the hash check still runs.
const modelDir = process.env.E2E_BG_MODEL_DIR;
const photo = process.env.E2E_BG_PHOTO;

test.skip(!modelDir || !photo, "set E2E_BG_MODEL_DIR and E2E_BG_PHOTO to run the background-removal test");
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    // Extra browser flags, space separated (for example to enable WebGPU on a machine where it is off).
    args: process.env.E2E_BG_CHROME_ARGS?.split(" ").filter(Boolean) ?? [],
  },
});

test("a supplier cleans a photo's background on their own device before saving the product", async ({ page, browser }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const suffix = Date.now().toString(36);
  const category = `[E2E] Cutout ${suffix}`;
  await adminWithCategory(browser, category);
  await signInAsNewUser(page, "cutout-supplier");
  await onboardSupplier(page, `[E2E] Cutout ${suffix}`);

  page.on("console", (m) => console.log("[page]", m.type(), m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
  page.on("crash", () => console.log("[page crashed]"));
  let modelRequests = 0;
  const served: string[] = [];
  await page.route("https://huggingface.co/**", async (route) => {
    modelRequests++;
    const url = route.request().url();
    const variant = Object.entries(MODELS).find(([, m]) => m.url === url);
    if (!variant) return route.abort();
    const file = variant[0] === "fp16" ? "model_fp16.onnx" : "model.onnx";
    served.push(file);
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: readFileSync(`${modelDir}/${file}`) });
  });
  const requestsToOtherHosts: string[] = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (!["localhost:3100", "huggingface.co"].includes(host) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) requestsToOtherHosts.push(r.url());
  });

  await page.goto("/supplier/products/new");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles(photo!);
  await expect(page.getByRole("button", { name: "ფონის მოშორება" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "ფონის მოშორება" }).click();

  const useCleaned = page.getByRole("button", { name: "გასუფთავებულის გამოყენება" });
  // Either the comparison appears or one of the remover's own error messages does.
  const failure = page.getByText(/ვერ მოხერხდა|ვერ ჩამოიტვირთა|ვერ უჭერს მხარს|არ ემთხვევა/);
  await expect(useCleaned.or(failure)).toBeVisible({ timeout: 12 * 60_000 });
  await page.screenshot({ path: testInfo.outputPath("result.png"), fullPage: true });
  await expect(useCleaned).toBeVisible();
  await expect(page.getByRole("img", { name: "გასუფთავებული" })).toBeVisible();
  await useCleaned.click();
  await expect(page.getByText(/-clean\.jpg$/)).toBeVisible();

  expect(served.length).toBe(1);
  expect(modelRequests).toBe(1);
  // The photo itself is processed locally: nothing but the app and the model host is contacted.
  expect(requestsToOtherHosts).toEqual([]);
});
