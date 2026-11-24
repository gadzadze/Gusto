import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePulse } from "@/components/motion/change-pulse";
import { FreshRow, expectArrivals, isFreshRow, rememberRow, resetRows } from "@/components/motion/fresh-row";

// createElement with the child as an argument (what the lint rule wants), typed loosely for these tests.
const el = (type: ComponentType<never>, props: object, child: string): ReactElement => createElement(type as ComponentType<object>, props, child);
const row = (id: string) => renderToStaticMarkup(el(FreshRow, { id, as: "li" }, "x"));

afterEach(() => {
  resetRows();
  vi.unstubAllGlobals();
});

describe("which rows count as new", () => {
  it("nothing is new until the live poller says something arrived", () => {
    expect(isFreshRow("a")).toBe(false);
  });

  it("an unseen row is new inside the arrival window, a remembered one is not", () => {
    rememberRow("known");
    expectArrivals();
    expect(isFreshRow("brand-new")).toBe(true);
    expect(isFreshRow("known")).toBe(false);
  });

  it("the window closes after 8 seconds, so navigation and filter changes later never highlight", () => {
    expectArrivals(1_000);
    expect(isFreshRow("a", 1_000 + 7_999)).toBe(true);
    expect(isFreshRow("a", 1_000 + 8_000)).toBe(false);
  });

  it("forgets everything when the live page is left", () => {
    rememberRow("a");
    expectArrivals();
    resetRows();
    expect(isFreshRow("a")).toBe(false); // the window is gone too
    expectArrivals();
    expect(isFreshRow("a")).toBe(true); // and so is the memory of what was seen
  });

  it("remembers a bounded number of rows", () => {
    for (let i = 0; i < 600; i += 1) rememberRow(`r${i}`);
    expectArrivals();
    expect(isFreshRow("r599")).toBe(false);
    expect(isFreshRow("r0")).toBe(true); // dropped when the set was cleared at its limit
  });
});

describe("FreshRow", () => {
  it("never highlights while rendering on the server, even inside the window", () => {
    expectArrivals();
    expect(typeof window).toBe("undefined");
    expect(row("a")).not.toContain("animate-row-in");
  });

  it("highlights an unseen row that mounts in the browser inside the window", () => {
    vi.stubGlobal("window", {});
    expectArrivals();
    const html = row("new-order");
    expect(html).toContain("animate-row-in");
    expect(html.startsWith("<li")).toBe(true);
  });

  it("does not highlight rows that mount outside the window, or ones already seen", () => {
    vi.stubGlobal("window", {});
    expect(row("loaded-with-the-page")).not.toContain("animate-row-in");
    rememberRow("known");
    expectArrivals();
    expect(row("known")).not.toContain("animate-row-in");
  });
});

describe("ChangePulse", () => {
  it("does not pop on first render, and keeps the class it is given", () => {
    const html = renderToStaticMarkup(el(ChangePulse, { value: 3, className: "ml-auto" }, "3"));
    expect(html).not.toContain("animate-pop");
    expect(html).toContain("ml-auto");
    expect(html).toContain(">3<");
  });
});
