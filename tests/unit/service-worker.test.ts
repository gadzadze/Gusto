import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// public/sw.js runs in the browser's service worker scope; here it runs against a small stand-in for `self`.
function load() {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let windows: { navigate: (u: string) => Promise<unknown>; focus: () => Promise<unknown> }[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    registration: { showNotification: (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => { opened.push(url); return Promise.resolve(); },
    },
  };
  vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), { self });
  const run = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  return { run, shown, opened, navigated, setWindows: (w: typeof windows) => { windows = w; } };
}

describe("service worker", () => {
  it("shows the pushed message with a safe link", async () => {
    const sw = load();
    await sw.run("push", { data: { json: () => ({ title: "New order GST-1051", body: "Cafe · 184,50 ₾", url: "/o/1051" }) } });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("New order GST-1051");
    expect(sw.shown[0].options).toMatchObject({ body: "Cafe · 184,50 ₾", data: { url: "/o/1051" } });
  });

  it("never links to another site, and survives a broken or empty message", async () => {
    const sw = load();
    await sw.run("push", { data: { json: () => ({ title: "x", url: "https://evil.example" }) } });
    await sw.run("push", { data: { json: () => { throw new Error("not json"); } } });
    await sw.run("push", { data: null });
    expect(sw.shown[0].options).toMatchObject({ data: { url: "/start" } });
    expect(sw.shown[1].title).toBe("202");
    expect(sw.shown[2].title).toBe("202");
  });

  it("opens the page when tapped: reuses an open window, else opens one", async () => {
    const sw = load();
    let closed = 0;
    await sw.run("notificationclick", { notification: { close: () => { closed += 1; }, data: { url: "/o/1051" } } });
    expect(closed).toBe(1);
    expect(sw.opened).toEqual(["/o/1051"]);

    const navigated: string[] = [];
    sw.setWindows([{ navigate: (u) => { navigated.push(u); return Promise.resolve({ focus: () => Promise.resolve() }); }, focus: () => Promise.resolve() }]);
    await sw.run("notificationclick", { notification: { close: () => undefined, data: { url: "//evil.example" } } });
    expect(navigated).toEqual(["/start"]);
    expect(sw.opened).toHaveLength(1);
  });
});
