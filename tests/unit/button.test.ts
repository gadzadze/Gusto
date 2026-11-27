import { createElement, type ReactElement, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

const render = (props: object, child: string) => renderToStaticMarkup(createElement(Button, props, child));
const click = () => ({ preventDefault: vi.fn() }) as unknown as MouseEvent<HTMLButtonElement>;
// Button is a plain function, so calling it gives the element it would render and the props it hands down.
type Handed = { onClick?: (e: MouseEvent<HTMLButtonElement>) => void };
const handedDown = (props: Parameters<typeof Button>[0]) => (Button(props) as ReactElement<Handed>).props;

describe("Button", () => {
  it("renders an ordinary button with no loading markup", () => {
    const html = render({}, "Save");
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("opacity-0");
  });

  it("while loading: busy, spinner, content kept (hidden) so the width stays, and still focusable", () => {
    const html = render({ loading: true }, "Save");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-loading="true"');
    expect(html).toContain("animate-spin");
    expect(html).toMatch(/<span class="inline-flex items-center justify-center gap-2 opacity-0">Save<\/span>/);
    // Not a real `disabled` button: it would throw keyboard focus out of the page.
    expect(html).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });

  it("speaks the loading label to screen readers only while loading", () => {
    expect(render({ loading: true, loadingLabel: "Working…" }, "Save")).toContain('<span class="sr-only">Working…</span>');
    expect(render({ loadingLabel: "Working…" }, "Save")).not.toContain("Working…");
  });

  it("a real disabled button stays disabled", () => {
    expect(render({ disabled: true }, "Save")).toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });

  it("a second press does nothing while loading, and the click is cancelled so a form is not submitted twice", () => {
    const onClick = vi.fn();
    const event = click();
    handedDown({ loading: true, onClick }).onClick?.(event);
    expect(onClick).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("hands the caller's own handler straight through when not loading", () => {
    const onClick = vi.fn();
    expect(handedDown({ onClick }).onClick).toBe(onClick);
  });

  // Pages render Button on the server too, and a server component may not pass a function to an element
  // ("Event handlers cannot be passed to Client Component props"): that broke every page once. A button with no
  // handler of its own must therefore carry none, in every shape it is used in.
  it("creates no event handler unless it is needed", () => {
    expect(handedDown({}).onClick).toBeUndefined();
    expect(handedDown({ disabled: true }).onClick).toBeUndefined();
    expect(handedDown({ asChild: true }).onClick).toBeUndefined();
    expect(handedDown({ asChild: true, disabled: true }).onClick).toBeUndefined();
    expect(handedDown({ loading: true }).onClick).toBeTypeOf("function"); // loading only happens in client code
  });

  it("keeps a larger invisible margin so a pressed (shrunken) button still takes edge taps", () => {
    expect(render({}, "Save")).toContain("before:-inset-0.5");
  });

  it("asChild keeps working and carries the busy and disabled state onto its child", () => {
    const link = (props: object) => renderToStaticMarkup(createElement(Button, { asChild: true, ...props }, createElement("a", { href: "/x" }, "Go")));
    const plain = link({});
    expect(plain).toContain('href="/x"');
    expect(plain).not.toContain("aria-disabled");
    const loading = link({ loading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-disabled="true"');
    const disabled = link({ disabled: true });
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain('data-disabled="true"');
    expect(disabled).toContain('tabindex="-1"'); // out of the keyboard tab order
  });

  it("asChild blocks a click handler it was given while loading or disabled", () => {
    const onClick = vi.fn();
    const loading = click();
    handedDown({ asChild: true, loading: true, onClick }).onClick?.(loading);
    const disabled = click();
    handedDown({ asChild: true, disabled: true, onClick }).onClick?.(disabled);
    expect(onClick).not.toHaveBeenCalled();
    expect(loading.preventDefault).toHaveBeenCalled();
    expect(disabled.preventDefault).toHaveBeenCalled();
  });

  it("is flat: a 12px corner, no shadow, no border, and the calm secondary is a tint", () => {
    const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);
    const flat = (html: string) => classesOf(html).every((c) => !/^(shadow|border|bg-gradient|bg-linear|ring)(-|$)/.test(c));
    const base = render({}, "Save");
    expect(base).toContain("rounded-btn");
    expect(flat(base)).toBe(true);
    const calm = render({ variant: "outline" }, "Save");
    expect(calm).toContain("bg-tonal");
    expect(flat(calm)).toBe(true);
    expect(render({ variant: "brand" }, "Save")).toContain("bg-brand");
    expect(render({ variant: "danger" }, "Save")).toContain("bg-danger-tonal");
  });

  it("makes icon buttons round", () => {
    expect(render({ size: "icon" }, "x")).toContain("rounded-full");
  });
});
