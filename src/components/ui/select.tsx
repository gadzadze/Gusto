"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// A select that looks like the rest of the app instead of the browser's own list.
//
// The real <select> stays in the DOM (hidden), so everything that already works keeps working unchanged: form
// submission, `name`, `register()` from react-hook-form, controlled `value` + `onChange`, labels. The visible
// control is a button that opens a menu in the browser's top layer (the Popover API: it is never clipped by a
// scrolling table and it stacks above dialogs). Choosing an item sets the real select's value and fires its
// `change` event. Keyboard: arrows, Home/End, Enter/Space, Escape and type-ahead. Browsers without the Popover
// API, and `multiple` selects, fall back to the plain native select.

type Option = { value: string; label: string; disabled: boolean; selected: boolean };

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The <option>s in the children, for the first render (before the real select exists). */
function optionsFromChildren(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<{ value?: unknown; disabled?: boolean; children?: React.ReactNode }>(child)) return;
      if (child.type === "option") {
        const label = textOf(child.props.children);
        out.push({ value: child.props.value === undefined ? label : String(child.props.value), label, disabled: !!child.props.disabled, selected: false });
      } else walk(child.props.children);
    });
  };
  walk(children);
  return out;
}

const noopSubscribe = () => () => undefined;
const popoverSupported = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

const triggerClass =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background py-2 pl-3 pr-2.5 text-left text-base outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-expanded:border-ring sm:text-sm";

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(function Select(
  { className, children, id, disabled, onBlur, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, ...props },
  forwardedRef,
) {
  const supported = React.useSyncExternalStore(noopSubscribe, popoverSupported, () => true);
  if (!supported || props.multiple) {
    return (
      <div className="relative">
        <select
          ref={forwardedRef}
          id={id}
          disabled={disabled}
          onBlur={onBlur}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          data-slot="select"
          className={cn(triggerClass, "appearance-none pr-9", className)}
          {...props}
        >
          {children}
        </select>
        {props.multiple ? null : <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
      </div>
    );
  }
  return (
    <MenuSelect
      forwardedRef={forwardedRef}
      id={id}
      disabled={disabled}
      onBlur={onBlur}
      ariaProps={{ "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid }}
      className={className}
      selectProps={props}
    >
      {children}
    </MenuSelect>
  );
});

function MenuSelect({
  forwardedRef,
  id,
  disabled,
  onBlur,
  ariaProps,
  className,
  selectProps,
  children,
}: {
  forwardedRef: React.ForwardedRef<HTMLSelectElement>;
  id?: string;
  disabled?: boolean;
  onBlur?: React.FocusEventHandler<HTMLSelectElement>;
  ariaProps: Record<string, unknown>;
  className?: string;
  selectProps: React.ComponentProps<"select">;
  children: React.ReactNode;
}) {
  const nativeRef = React.useRef<HTMLSelectElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const wasOpenOnPress = React.useRef(false);
  const typeahead = React.useRef({ text: "", at: 0 });
  const listId = React.useId();

  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<Option[]>([]);
  const [active, setActive] = React.useState(-1);
  const [place, setPlace] = React.useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  // react-hook-form's register() and plain refs get the real <select>.
  React.useImperativeHandle(forwardedRef, () => nativeRef.current as HTMLSelectElement, []);

  // What the button shows: the real select's chosen option, or (first render) what the children say.
  const fallbackOptions = optionsFromChildren(children);
  const wanted = selectProps.value !== undefined ? String(selectProps.value) : selectProps.defaultValue !== undefined ? String(Array.isArray(selectProps.defaultValue) ? selectProps.defaultValue[0] : selectProps.defaultValue) : undefined;
  const fallbackLabel = (fallbackOptions.find((o) => o.value === wanted) ?? fallbackOptions[0])?.label ?? "";
  const subscribe = React.useCallback((callback: () => void) => {
    const el = nativeRef.current;
    el?.addEventListener("change", callback);
    return () => el?.removeEventListener("change", callback);
  }, []);
  const label = React.useSyncExternalStore(
    subscribe,
    () => {
      const el = nativeRef.current;
      return el && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : fallbackLabel;
    },
    () => fallbackLabel,
  );

  const readOptions = (): Option[] =>
    nativeRef.current ? Array.from(nativeRef.current.options, (o) => ({ value: o.value, label: o.text, disabled: o.disabled, selected: o.selected })) : fallbackOptions;

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const margin = 12;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const want = Math.min(320, menuRef.current?.scrollHeight ?? 320);
    const flip = below < Math.min(want, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(320, flip ? above : below));
    const height = Math.min(want, maxHeight);
    setPlace({
      left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)),
      width: rect.width,
      top: flip ? rect.top - gap - height : rect.bottom + gap,
      maxHeight,
    });
  }, []);

  const openMenu = () => {
    if (disabled) return;
    const list = readOptions();
    setOptions(list);
    const current = nativeRef.current?.selectedIndex ?? -1;
    setActive(current >= 0 && !list[current]?.disabled ? current : list.findIndex((o) => !o.disabled));
    setOpen(true);
  };

  // Show the menu in the top layer once it is rendered, and keep it under the button.
  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    reposition();
    if (!menu.matches(":popover-open")) menu.showPopover();
    const onMove = () => reposition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, reposition]);

  // Keep the highlighted item in view.
  React.useEffect(() => {
    if (open && active >= 0) menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const close = () => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) menu.hidePopover();
    setOpen(false);
  };

  const choose = (index: number) => {
    const option = options[index];
    const el = nativeRef.current;
    if (!option || option.disabled || !el) return;
    if (el.value !== option.value) {
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
    triggerRef.current?.focus();
  };

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (key === "ArrowDown") setActive((i) => move(i, 1));
    else if (key === "ArrowUp") setActive((i) => move(i, -1));
    else if (key === "Home") setActive(options.findIndex((o) => !o.disabled));
    else if (key === "End") setActive(options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled));
    else if (key === "Enter" || key === " ") choose(active);
    else if (key === "Escape") close();
    else if (key === "Tab") close();
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Type-ahead: letters typed in quick succession jump to the first item starting with them.
      const now = Date.now();
      const ta = typeahead.current;
      ta.text = now - ta.at > 700 ? key.toLowerCase() : ta.text + key.toLowerCase();
      ta.at = now;
      const from = ta.text.length === 1 ? active + 1 : active;
      const hit = [...options.slice(from), ...options.slice(0, from)].find((o) => !o.disabled && o.label.toLowerCase().startsWith(ta.text));
      if (hit) setActive(options.indexOf(hit));
    } else return;
    event.preventDefault();
  };

  return (
    <div className="relative">
      <select
        ref={nativeRef}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        data-slot="select"
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        {...selectProps}
      >
        {children}
      </select>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        className={cn(triggerClass, className)}
        onPointerDown={() => {
          // The menu closes itself on an outside press, before the click: remember it was open.
          wasOpenOnPress.current = open;
        }}
        onClick={() => {
          if (wasOpenOnPress.current) {
            wasOpenOnPress.current = false;
            return;
          }
          if (open) close();
          else openMenu();
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // react-hook-form's onBlur reads the field from the event target: give it the real select.
          if (onBlur && nativeRef.current) onBlur({ ...event, target: nativeRef.current, currentTarget: nativeRef.current } as unknown as React.FocusEvent<HTMLSelectElement>);
        }}
        {...ariaProps}
      >
        <span className="min-w-0 flex-1 truncate">{label || " "}</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          popover="auto"
          aria-label={ariaProps["aria-label"] as string | undefined}
          onToggle={(event) => {
            // Closed by Escape or a press outside: keep our state in step.
            if ((event.nativeEvent as ToggleEvent).newState === "closed") setOpen(false);
          }}
          style={place ? { position: "fixed", inset: "auto", top: place.top, left: place.left, minWidth: place.width, maxHeight: place.maxHeight } : { visibility: "hidden" }}
          className="m-0 w-max max-w-[min(32rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-black/5 bg-surface p-1.5 text-foreground shadow-[0_12px_40px_-10px_rgba(0,0,0,0.3),0_2px_8px_-2px_rgba(0,0,0,0.12)] transition-opacity duration-100 starting:opacity-0 motion-reduce:transition-none dark:border-white/10"
        >
          {options.map((option, index) => {
            const selected = option.selected;
            return (
              <div
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                data-index={index}
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                onPointerMove={() => !option.disabled && setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] sm:min-h-9 sm:py-1.5 sm:text-sm",
                  index === active && "bg-muted",
                  selected && "font-medium",
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="min-w-0 flex-1">{option.label || " "}</span>
                {selected ? <Check aria-hidden className="size-4 shrink-0 text-brand" /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
