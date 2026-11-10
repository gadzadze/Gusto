"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { saveConditionsAction } from "@/app/supplier/pricing/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INTERVAL_PRESETS, PAYMENT_METHODS, bpToInput, type PaymentMethod } from "@/lib/pricing/conditions";
import { milliToInput } from "@/lib/quantity";

/** One row as the server sends it (plain data). */
export type ConditionRule = {
  productId: string | null;
  kind: "method" | "interval" | "qty";
  method: PaymentMethod | null;
  intervalDays: number | null;
  minQtyMilli: number | null;
  adjustBp: number;
};

type Props = {
  priceListId: string;
  rules: ConditionRule[];
  products: { id: string; name: string }[];
  disabled: boolean;
};

/**
 * Conditions on a price list: how the price changes with the way the customer pays and how much they order.
 * A scope picker chooses "all products on the list" or one product; a product's own values replace the list's.
 */
export function PriceConditions({ priceListId, rules, products, disabled }: Props) {
  const t = useTranslations("pricing.conditions");
  const [scope, setScope] = useState<string>("list");
  const productId = scope === "list" ? null : scope;
  const mine = rules.filter((r) => r.productId === productId);
  const stamp = JSON.stringify(mine);
  const productsWithOwn = new Set(rules.filter((r) => r.productId).map((r) => r.productId));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div className="max-w-md space-y-2">
        <Label htmlFor="cond-scope">{t("scope")}</Label>
        <Select id="cond-scope" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="list">{t("scopeList")}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {productsWithOwn.has(product.id) ? ` (${t("hasOwn")})` : ""}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{productId === null ? t("scopeListHint") : t("scopeProductHint")}</p>
      </div>
      <ScopeEditor key={`${scope}:${stamp}`} priceListId={priceListId} productId={productId} initial={mine} inherited={rules.filter((r) => r.productId === null)} disabled={disabled} />
    </div>
  );
}


function ScopeEditor({
  priceListId,
  productId,
  initial,
  inherited,
  disabled,
}: {
  priceListId: string;
  productId: string | null;
  initial: ConditionRule[];
  inherited: ConditionRule[];
  disabled: boolean;
}) {
  const t = useTranslations("pricing.conditions");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const isProduct = productId !== null;

  const [methods, setMethods] = useState<Record<PaymentMethod, string>>(() => {
    const out = {} as Record<PaymentMethod, string>;
    for (const m of PAYMENT_METHODS) {
      const r = initial.find((x) => x.kind === "method" && x.method === m);
      out[m] = r ? bpToInput(r.adjustBp) : "";
    }
    return out;
  });
  const [intervals, setIntervals] = useState<{ days: number; pct: string }[]>(() => {
    const days = new Set<number>([...INTERVAL_PRESETS, ...initial.filter((x) => x.kind === "interval").map((x) => x.intervalDays ?? 0), ...inherited.filter((x) => x.kind === "interval").map((x) => x.intervalDays ?? 0)]);
    return [...days]
      .sort((a, b) => a - b)
      .map((d) => {
        const r = initial.find((x) => x.kind === "interval" && x.intervalDays === d);
        return { days: d, pct: r ? bpToInput(r.adjustBp) : "" };
      });
  });
  const [tiers, setTiers] = useState<{ qty: string; pct: string }[]>(() =>
    initial.filter((x) => x.kind === "qty").map((x) => ({ qty: milliToInput(x.minQtyMilli ?? 0), pct: bpToInput(x.adjustBp) })),
  );
  const [newDays, setNewDays] = useState("");

  const inheritedMethod = (m: PaymentMethod) => inherited.find((x) => x.kind === "method" && x.method === m);
  const inheritedInterval = (d: number) => inherited.find((x) => x.kind === "interval" && x.intervalDays === d);
  const inheritedTiers = inherited.filter((x) => x.kind === "qty");

  function save(rowsOverride?: "clear") {
    setMessage(null);
    const rows: { kind: "method" | "interval" | "qty"; method?: string; intervalDays?: number; qty?: string; pct: string }[] = [];
    if (rowsOverride !== "clear") {
      for (const m of PAYMENT_METHODS) if (methods[m].trim() !== "") rows.push({ kind: "method", method: m, pct: methods[m] });
      for (const i of intervals) if (i.pct.trim() !== "") rows.push({ kind: "interval", intervalDays: i.days, pct: i.pct });
      for (const tier of tiers) if (tier.qty.trim() !== "" || tier.pct.trim() !== "") rows.push({ kind: "qty", qty: tier.qty, pct: tier.pct });
    }
    startTransition(async () => {
      const result = await saveConditionsAction(priceListId, productId, rows);
      setMessage(result.ok ? { tone: "success", text: t("saved") } : { tone: "error", text: t(`errors.${result.error === "invalid_rule" ? "invalid_rule" : "unknown"}`) });
    });
  }

  function addInterval() {
    const days = Number.parseInt(newDays, 10);
    if (!Number.isInteger(days) || days < 0 || days > 365 || intervals.some((i) => i.days === days)) return;
    setIntervals([...intervals, { days, pct: "" }].sort((a, b) => a.days - b.days));
    setNewDays("");
  }

  const pctInput = (value: string, onChange: (v: string) => void, label: string, placeholder?: string) => (
    <div className="relative w-28 shrink-0">
      <Input
        aria-label={label}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? t("pctPlaceholder")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="pr-7 text-right tabular-nums"
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("howToType")}</p>

      <section className="space-y-2 rounded-xl border border-border p-4" aria-labelledby="cond-method">
        <h3 id="cond-method" className="font-medium">{t("methodTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("methodHint")}</p>
        <ul className="space-y-2">
          {PAYMENT_METHODS.map((m) => (
            <li key={m} className="flex items-center justify-between gap-3">
              <span>{t(`method.${m}`)}</span>
              {pctInput(methods[m], (v) => setMethods({ ...methods, [m]: v }), t(`method.${m}`), isProduct && inheritedMethod(m) ? bpToInput(inheritedMethod(m)!.adjustBp) : undefined)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2 rounded-xl border border-border p-4" aria-labelledby="cond-interval">
        <h3 id="cond-interval" className="font-medium">{t("intervalTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("intervalHint")}</p>
        <ul className="space-y-2">
          {intervals.map((row) => (
            <li key={row.days} className="flex items-center justify-between gap-3">
              <span>{row.days === 0 ? t("onDelivery") : t("days", { count: row.days })}</span>
              {pctInput(row.pct, (v) => setIntervals(intervals.map((x) => (x.days === row.days ? { ...x, pct: v } : x))), row.days === 0 ? t("onDelivery") : t("days", { count: row.days }), isProduct && inheritedInterval(row.days) ? bpToInput(inheritedInterval(row.days)!.adjustBp) : undefined)}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2 pt-1">
          <div className="w-32 space-y-1">
            <Label htmlFor="cond-new-days" className="text-xs text-muted-foreground">{t("otherInterval")}</Label>
            <Input id="cond-new-days" inputMode="numeric" value={newDays} placeholder="45" disabled={disabled} onChange={(event) => setNewDays(event.target.value)} />
          </div>
          <Button type="button" variant="outline" disabled={disabled || newDays.trim() === ""} onClick={addInterval}>
            <Plus />
            {t("add")}
          </Button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-border p-4" aria-labelledby="cond-qty">
        <h3 id="cond-qty" className="font-medium">{t("qtyTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("qtyHint")}</p>
        {isProduct && tiers.length === 0 && inheritedTiers.length > 0 ? (
          <p className="text-sm text-muted-foreground">{t("qtyInherited", { count: inheritedTiers.length })}</p>
        ) : null}
        <ul className="space-y-2">
          {tiers.map((tier, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("from")}</span>
              <Input
                aria-label={t("qtyLabel")}
                inputMode="decimal"
                value={tier.qty}
                disabled={disabled}
                placeholder="10"
                onChange={(event) => setTiers(tiers.map((x, i) => (i === index ? { ...x, qty: event.target.value } : x)))}
                className="w-24 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">→</span>
              {pctInput(tier.pct, (v) => setTiers(tiers.map((x, i) => (i === index ? { ...x, pct: v } : x))), t("qtyPctLabel"))}
              <Button type="button" variant="ghost" size="icon" aria-label={t("remove")} disabled={disabled} onClick={() => setTiers(tiers.filter((_, i) => i !== index))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setTiers([...tiers, { qty: "", pct: "" }])}>
          <Plus />
          {t("addTier")}
        </Button>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={disabled || pending} onClick={() => save()}>
          {t("save")}
        </Button>
        {isProduct && initial.length > 0 ? (
          <Button type="button" variant="outline" disabled={disabled || pending} onClick={() => save("clear")}>
            {t("useList")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

