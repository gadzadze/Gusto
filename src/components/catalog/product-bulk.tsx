"use client";

import { Check, Eye, EyeOff, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bulkProductsAction } from "@/app/supplier/products/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";

type Usage = { openOrders: number; orderLines: number };
type Ctx = { selected: ReadonlySet<string>; toggle: (id: string) => void; setMany: (ids: string[], on: boolean) => void };

const SelectionContext = createContext<Ctx | null>(null);

function useSelection(): Ctx {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("BulkSelection is missing");
  return ctx;
}

/** Row checkbox: join the selection of the product list. */
export function BulkRowCheck({ id, name }: { id: string; name: string }) {
  const t = useTranslations("products.bulk");
  const { selected, toggle } = useSelection();
  return (
    <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        checked={selected.has(id)}
        onChange={() => toggle(id)}
        aria-label={t("selectRow", { name })}
        className="size-5 cursor-pointer rounded border-input accent-[var(--ink)]"
      />
    </label>
  );
}

/** Header checkbox: select or clear every product on this page. */
export function BulkPageCheck({ ids }: { ids: string[] }) {
  const t = useTranslations("products.bulk");
  const { selected, setMany } = useSelection();
  const count = ids.filter((id) => selected.has(id)).length;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < ids.length;
  }, [count, ids.length]);
  return (
    <label className="flex size-11 cursor-pointer items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={count === ids.length && ids.length > 0}
        onChange={(e) => setMany(ids, e.target.checked)}
        aria-label={t("selectAll")}
        className="size-5 cursor-pointer rounded border-input accent-[var(--ink)]"
      />
    </label>
  );
}

/**
 * Holds the selection for the product list and shows the action bar once something is chosen. The rows stay
 * server-rendered; only their checkboxes are client components that read this selection.
 */
export function BulkSelection({
  categories,
  usage,
  pageIds,
  children,
}: {
  categories: { id: string; name: string }[];
  /** The products on this page: a selection never reaches beyond them (after paging or filtering). */
  pageIds: string[];
  usage: Record<string, Usage>;
  children: React.ReactNode;
}) {
  const t = useTranslations("products.bulk");
  const td = useTranslations("products.delete");
  const tc = useTranslations("common");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);

  const value = useMemo<Ctx>(
    () => ({
      selected,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setMany: (ids, on) =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
    }),
    [selected],
  );

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 5000);
    return () => clearTimeout(timer);
  }, [done]);

  const ids = pageIds.filter((id) => selected.has(id));
  const totals = ids.reduce((sum, id) => ({ openOrders: sum.openOrders + (usage[id]?.openOrders ?? 0), orderLines: sum.orderLines + (usage[id]?.orderLines ?? 0) }), { openOrders: 0, orderLines: 0 });

  const run = (action: "show" | "hide" | "delete" | "category") =>
    startTransition(async () => {
      setError(false);
      const result = await bulkProductsAction(action === "category" ? { action, ids, categoryId } : { action, ids });
      if (!result.ok) {
        setError(true);
        return;
      }
      dialog.current?.close();
      setSelected(new Set());
      setCategoryId("");
      setDone(t(`done.${action}`, { count: result.count }));
    });

  return (
    <SelectionContext.Provider value={value}>
      {children}
      {ids.length > 0 ? (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <div className="w-full max-w-3xl space-y-2 rounded-xl border border-border bg-surface p-3 shadow-lg" role="toolbar" aria-label={t("selected", { count: ids.length })}>
            {error ? <FormAlert tone="error">{t("error")}</FormAlert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm font-medium tabular-nums">{t("selected", { count: ids.length })}</p>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run("show")}>
                <Eye />
                {t("show")}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run("hide")}>
                <EyeOff />
                {t("hide")}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => { setError(false); dialog.current?.showModal(); }}>
                <Trash2 />
                {t("delete")}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t("clear")} title={t("clear")} onClick={() => setSelected(new Set())}>
                <X />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select aria-label={t("category")} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">{t("categoryChoose")}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="outline" disabled={pending || !categoryId} onClick={() => run("category")}>
                <Check />
                {t("categoryApply")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {done && ids.length === 0 ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <p className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium shadow-lg">{done}</p>
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="bulk-delete-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-foreground backdrop:bg-black/40"
      >
        <div className="space-y-3">
          <p id="bulk-delete-title" className="font-semibold">{t("deleteTitle", { count: ids.length })}</p>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{td("effects")}</p>
            <p>{totals.orderLines > 0 ? td("history", { count: totals.orderLines }) : td("noHistory")}</p>
            {totals.openOrders > 0 ? <p className="font-medium text-foreground">{td("openOrders", { count: totals.openOrders })}</p> : null}
            <p>{td("hideInstead")}</p>
          </div>
          {error ? <FormAlert tone="error">{td("error")}</FormAlert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => run("delete")}>
              <Trash2 />
              {td("confirm")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => dialog.current?.close()}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      </dialog>
    </SelectionContext.Provider>
  );
}
