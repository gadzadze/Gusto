"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { adjustStockAction } from "@/app/supplier/products/actions";

/**
 * Two ways to change the stock count by hand: "received" adds to what is on
 * the platform, "recount" replaces it with the absolute number counted.
 */
export function StockPanel({
  productId,
  currentLabel,
  disabled,
}: {
  productId: string;
  /** Formatted on the server, e.g. "12,5 კგ", or null when not tracked. */
  currentLabel: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("products.form");
  const te = useTranslations("products.errors");
  const [add, setAdd] = useState("");
  const [set, setSet] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (mode: "add" | "set", value: string, clear: () => void) =>
    startTransition(async () => {
      const result = await adjustStockAction(productId, mode, value);
      if (result.ok) {
        clear();
        setMessage({ tone: "success", text: t("stockSaved") });
      } else {
        setMessage({ tone: "error", text: te(result.error === "invalid_stock" ? "invalid_stock" : "unknown") });
      }
    });

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("stockTitle")}</h2>
      <p className="text-lg font-semibold tabular-nums">
        {currentLabel === null ? t("stockUntracked") : currentLabel}
      </p>
      <p className="text-sm text-muted-foreground">{t("stockOnlyYou")}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit("add", add, () => setAdd(""));
          }}
        >
          <label htmlFor="stock-add" className="text-sm font-medium">{t("stockAddLabel")}</label>
          <Input id="stock-add" inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} disabled={disabled} />
          <p className="text-xs text-muted-foreground">{t("stockAddHint")}</p>
          <Button type="submit" variant="outline" disabled={disabled || pending || add.trim() === ""}>{t("stockAdd")}</Button>
        </form>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit("set", set, () => setSet(""));
          }}
        >
          <label htmlFor="stock-set" className="text-sm font-medium">{t("stockSetLabel")}</label>
          <Input id="stock-set" inputMode="decimal" value={set} onChange={(e) => setSet(e.target.value)} disabled={disabled} />
          <p className="text-xs text-muted-foreground">{t("stockSetHint")}</p>
          <Button type="submit" variant="outline" disabled={disabled || pending || set.trim() === ""}>{t("stockSet")}</Button>
        </form>
      </div>
    </section>
  );
}
