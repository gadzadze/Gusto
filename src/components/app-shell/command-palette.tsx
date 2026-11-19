"use client";

import { ClipboardList, CornerDownLeft, FilePlus2, FileUp, KeyRound, Package, Search, Store, Truck, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { paletteSearchAction } from "@/app/palette/actions";
import { cn } from "@/lib/utils";
import type { PaletteKind, PaletteResult } from "@/server/domain/search/palette";
import { itemsFor } from "./nav-links";
import type { Area } from "./nav";

// Ctrl/Cmd+K: jump to a page, start a common action, or find a product, customer, supplier or order by name or number.
// Pages and actions come from the same lists as the menu; names and numbers come from paletteSearchAction (scoped to
// the acting company on the server). One <dialog> for the whole shell; the triggers (PaletteTrigger) only send an event.

export const OPEN_PALETTE_EVENT = "palette:open";

type Command = { key: string; label: string; hint?: string; icon: LucideIcon; href: string; group: "results" | "goTo" | "actions" };

const KIND_ICON: Record<PaletteKind, LucideIcon> = { product: Package, customer: Users, supplier: Store, order: ClipboardList };

type Props = { area: Area; homeHref: string | null; showAdminLink: boolean; entitySearch: boolean };

export function CommandPalette({ area, homeHref, showAdminLink, entitySearch }: Props) {
  const t = useTranslations("palette");
  const tn = useTranslations("nav");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [active, setActive] = useState(0);

  const open = useCallback(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, open);
    };
  }, [open]);

  // Names and numbers: asked of the server a moment after typing stops; a late answer to an older query is dropped.
  const q = query.trim();
  useEffect(() => {
    if (!entitySearch || q.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await paletteSearchAction(q).catch(() => []);
      if (!stale) setResults(found);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, entitySearch]);

  const commands = useMemo<Command[]>(() => {
    const goTo: Command[] = itemsFor(area, homeHref, showAdminLink).map((item) => ({
      key: `nav:${item.href}`,
      label: tn(item.labelKey),
      icon: item.icon,
      href: item.href,
      group: "goTo",
    }));
    const action = (key: string, label: string, icon: LucideIcon, href: string): Command => ({ key: `act:${key}`, label, icon, href, group: "actions" });
    const actions: Command[] = [];
    if (area === "supplier") {
      actions.push(
        action("newProduct", t("actions.newProduct"), FilePlus2, "/supplier/products/new"),
        action("importProducts", t("actions.importProducts"), FileUp, "/supplier/products/import"),
        action("loadingSheet", t("actions.loadingSheet"), Truck, "/supplier/orders/pick"),
        action("newCustomer", t("actions.newCustomer"), UserPlus, "/supplier/customers/new"),
      );
    } else if (area === "buyer") {
      actions.push(
        action("inviteSupplier", t("actions.inviteSupplier"), UserPlus, "/buyer/suppliers/invite"),
        action("regular", t("actions.regular"), ClipboardList, "/buyer/regular"),
      );
    }
    if (area !== "admin") actions.push(action("team", t("actions.team"), Users, `/${area}/team`));
    actions.push(action("password", t("actions.password"), KeyRound, "/account/password"));
    return [...goTo, ...actions];
  }, [area, homeHref, showAdminLink, t, tn]);

  const list = useMemo<Command[]>(() => {
    const needle = q.toLowerCase();
    const matching = needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands;
    const found: Command[] = (entitySearch && q.length >= 2 ? results : []).map((r) => ({
      key: `res:${r.kind}:${r.id}`,
      label: r.label,
      hint: [t(`kinds.${r.kind}`), r.hint].filter(Boolean).join(" · "),
      icon: KIND_ICON[r.kind],
      href: r.href,
      group: "results",
    }));
    const searchAll: Command[] =
      entitySearch && q.length >= 2 && area !== "admin"
        ? [{ key: "search:all", label: t("searchFor", { q }), icon: Search, href: area === "supplier" ? `/supplier/products?q=${encodeURIComponent(q)}` : `/buyer/search?q=${encodeURIComponent(q)}`, group: "results" }]
        : [];
    return [...found, ...searchAll, ...matching];
  }, [commands, results, q, entitySearch, area, t]);

  // Keep the highlighted row inside the list whenever it changes.
  const safeActive = Math.min(active, Math.max(0, list.length - 1));
  useEffect(() => {
    document.getElementById(`palette-opt-${safeActive}`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive, list.length]);

  const go = (command: Command | undefined) => {
    if (!command) return;
    dialog.current?.close();
    router.push(command.href);
  };

  const groupLabel = (group: Command["group"]) => t(`groups.${group}`);

  return (
    <dialog
      ref={dialog}
      aria-label={t("title")}
      onClose={() => {
        setQuery("");
        setResults([]);
        setActive(0);
      }}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close(); // the backdrop
      }}
      className="mx-auto mb-auto mt-[10vh] w-[min(36rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (list.length ? (Math.min(i, list.length - 1) + 1) % list.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (list.length ? (Math.min(i, list.length - 1) - 1 + list.length) % list.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(list[safeActive]);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={list.length ? `palette-opt-${safeActive}` : undefined}
          aria-label={t("placeholder")}
          placeholder={t("placeholder")}
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul id="palette-list" role="listbox" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
        {list.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("empty")}</li> : null}
        {list.map((c, i) => (
          <li key={c.key} role="presentation">
            {i === 0 || list[i - 1].group !== c.group ? (
              <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{groupLabel(c.group)}</p>
            ) : null}
            <button
              type="button"
              id={`palette-opt-${i}`}
              role="option"
              aria-selected={i === safeActive}
              tabIndex={-1}
              onMouseMove={() => setActive(i)}
              onClick={() => go(c)}
              className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm", i === safeActive ? "bg-brand-soft text-brand" : "hover:bg-muted")}
            >
              <c.icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.hint ? <span className="shrink-0 truncate text-xs text-muted-foreground">{c.hint}</span> : null}
              {i === safeActive ? <CornerDownLeft className="size-3.5 shrink-0" aria-hidden /> : null}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

/** The visible way in: a search field look-alike in the sidebar, an icon button in the phone header. */
export function PaletteTrigger({ compact }: { compact?: boolean }) {
  const t = useTranslations("palette");
  // False while rendering on the server and during hydration, then the real answer: no mismatch.
  const mac = useSyncExternalStore(
    () => () => {},
    () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  const fire = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
  if (compact) {
    return (
      <button type="button" onClick={fire} aria-label={t("trigger")} className="inline-flex size-11 items-center justify-center text-muted-foreground">
        <Search aria-hidden className="size-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={fire}
      className="flex min-h-10 w-full items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground hover:bg-muted"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-left">{t("trigger")}</span>
      <kbd className="rounded border border-border px-1.5 text-[11px] leading-5">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
