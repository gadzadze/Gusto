import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ChangePulse } from "@/components/motion/change-pulse";
import { FreshRow, setRowsLive } from "@/components/motion/fresh-row";

const row = (id: string) => renderToStaticMarkup(createElement(FreshRow, { id, as: "li" }, "x"));

afterEach(() => setRowsLive(false));

describe("FreshRow", () => {
  it("never animates rows rendered before the live poller has started", () => {
    expect(row("a")).not.toContain("animate-row-in");
    expect(row("b")).not.toContain("animate-row-in");
  });

  it("animates only rows that first appear once the page is live", () => {
    // Present at load: remembered, so a later refresh that still has them does not animate them.
    row("a");
    setRowsLive(true);
    expect(row("a")).not.toContain("animate-row-in");
    // Arrived while the page was open.
    const fresh = row("new-order");
    expect(fresh).toContain("animate-row-in");
    expect(fresh.startsWith("<li")).toBe(true);
  });

  it("forgets the rows when the page stops being live, so a return visit starts clean", () => {
    setRowsLive(true);
    expect(row("z")).toContain("animate-row-in");
    setRowsLive(false);
    expect(row("z")).not.toContain("animate-row-in");
    setRowsLive(true);
    // z was seen while not live, so it counts as present at load now.
    expect(row("z")).not.toContain("animate-row-in");
  });
});

describe("ChangePulse", () => {
  it("does not pop on first render, and keeps the class it is given", () => {
    const html = renderToStaticMarkup(createElement(ChangePulse, { value: 3, className: "ml-auto" }, "3"));
    expect(html).not.toContain("animate-pop");
    expect(html).toContain("ml-auto");
    expect(html).toContain(">3<");
  });
});
