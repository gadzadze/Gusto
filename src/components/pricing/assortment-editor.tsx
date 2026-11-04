"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { minorToInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { saveItemsAction, setAllItemsAction } from "@/app/supplier/pricing/actions";

type Row = {
  productId: string;
  name: string;
  sku: string | null;
  unitLabel: string;
  isActive: boolean;
  /** Formatted on the server. */
  basePriceLabel: string;
  included: boolean;
  /** null = base price. */
  listPriceMinor: number | null;
};

/**
 * Tick the products this list's customers may order and, optionally, give
 * each its own price. A ticked product with an empty price sells at its base
 * price; an unticked one is invisible to those customers.
 */
export function AssortmentEditor({
  priceListId,
  rows,
  disabled,
  filters,
}: {
  priceListId: string;
  rows: Row[];
  disabled: boolean;
  /** Current search and category, so "tick all" matches what is on screen. */
  filters: { q: string; categoryId: string };
}) {
  const t = useTranslations("pricing.detail");
  const tp = useTranslations("pricing");
  const initial = Object.fromEntries(
    rows.map((r) => [r.productId, r.listPriceMinor === null ? "" : minorToInput(r.listPriceMinor, ",")]),
  );
  const initialIncluded = Object.fromEntries(rows.map((r) => [r.productId, r.included]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [included, setIncluded] = useState<Record<string, boolean>>(initialIncluded);
  // After the server re-renders with new data (a save, or tick-all), start from it.
  const signature = rows.map((r) => `${r.productId}:${r.included ? 1 : 0}:${r.listPriceMinor ?? ""}`).join("|");
  const [seenSignature, setSeenSignature] = useState(signature);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setValues(initial);
    setIncluded(initialIncluded);
  }
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = rows.filter(
    (r) => included[r.productId] !== initialIncluded[r.productId] || (included[r.productId] && values[r.productId] !== initial[r.productId]),
  );

  const setAll = (include: boolean) => {
    setMessage(null);
    startTransition(async () => {
      const result = await setAllItemsAction(priceListId, include, {
        q: filters.q || undefined,
        categoryId: filters.categoryId || undefined,
        activeOnly: include,
      });
      if (!result.ok) setMessage({ tone: "error", text: tp(`errors.${result.error as "invalid"}`) });
    });
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveItemsAction(
        priceListId,
        changed.map((r) => ({ productId: r.productId, included: included[r.productId], price: values[r.productId] })),
      );
      if (result.ok) {
        setInvalid(new Set());
        setMessage({ tone: "success", text: t("saved") });
        return;
      }
      if ("invalidProductIds" in result) setInvalid(new Set(result.invalidProductIds));
      setMessage({ tone: "error", text: tp(`errors.${result.error as "invalid"}`) });
    });
  };

  return (
    <div className="space-y-3">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled || pending || changed.length > 0} onClick={() => setAll(true)}>
          {t("tickAll")}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || pending || changed.length > 0} onClick={() => setAll(false)}>
          {t("untickAll")}
        </Button>
      </div>
      <Table>
        <THead>
          <TR>
            <TH className="w-12">
              <span className="sr-only">{t("columns.available")}</span>
            </TH>
            <TH>{t("columns.product")}</TH>
            <TH className="text-right">{t("columns.base")}</TH>
            <TH className="w-40">{t("columns.price")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.productId}>
              <TD>
                <input
                  type="checkbox"
                  aria-label={`${r.name}: ${t("columns.available")}`}
                  className="size-5 accent-[var(--brand)]"
                  checked={included[r.productId]}
                  disabled={disabled}
                  onChange={(e) => setIncluded((v) => ({ ...v, [r.productId]: e.target.checked }))}
                />
              </TD>
              <TD>
                <span className="font-medium">{r.name}</span>
                {!r.isActive ? <Badge className="ml-2">{t("inactive")}</Badge> : null}
                <span className="block text-xs text-muted-foreground">
                  {[r.sku, r.unitLabel].filter(Boolean).join(" · ")}
                </span>
              </TD>
              <TD className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                {r.basePriceLabel}
              </TD>
              <TD>
                <Input
                  aria-label={`${r.name}: ${t("columns.price")}`}
                  inputMode="decimal"
                  placeholder={t("placeholder")}
                  value={values[r.productId]}
                  disabled={disabled || !included[r.productId]}
                  aria-invalid={invalid.has(r.productId) || undefined}
                  className={cn("text-right tabular-nums", values[r.productId] !== initial[r.productId] && "border-brand")}
                  onChange={(e) => setValues((v) => ({ ...v, [r.productId]: e.target.value }))}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Button disabled={disabled || pending || changed.length === 0} onClick={save}>
        {t("saveChanges")}
        {changed.length > 0 ? ` (${changed.length})` : ""}
      </Button>
    </div>
  );
}
