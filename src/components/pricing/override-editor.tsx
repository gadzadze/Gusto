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
import { saveOverridesAction } from "@/app/supplier/pricing/actions";

type Row = {
  productId: string;
  name: string;
  sku: string | null;
  unitLabel: string;
  isActive: boolean;
  /** Formatted on the server. */
  basePriceLabel: string;
  overrideMinor: number | null;
};

/** Edit this page's override prices; empty means "use the base price". */
export function OverrideEditor({
  priceListId,
  rows,
  disabled,
}: {
  priceListId: string;
  rows: Row[];
  disabled: boolean;
}) {
  const t = useTranslations("pricing.detail");
  const tp = useTranslations("pricing");
  const initial = Object.fromEntries(
    rows.map((r) => [r.productId, r.overrideMinor === null ? "" : minorToInput(r.overrideMinor, ",")]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = rows.filter((r) => values[r.productId] !== initial[r.productId]);

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveOverridesAction(
        priceListId,
        changed.map((r) => ({ productId: r.productId, price: values[r.productId] })),
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
      <Table>
        <THead>
          <TR>
            <TH>{t("columns.product")}</TH>
            <TH className="text-right">{t("columns.base")}</TH>
            <TH className="w-40">{t("columns.price")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.productId}>
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
                  disabled={disabled}
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
