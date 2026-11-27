"use client";

import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { milliToInput, stepDown, stepUp } from "@/lib/quantity";
import { cn } from "@/lib/utils";
import { setCartQuantityAction } from "@/app/buyer/cart/actions";

/**
 * Add-to-cart / quantity control. Steps respect the product's minimum and
 * step; going below the minimum removes it. The number shown is plain
 * digits with the language's decimal mark (comma in Georgian, point in English) - no Intl on the client.
 */
export function QuantityStepper({
  supplierOrgId,
  productId,
  qtyMilli,
  minQtyMilli,
  qtyStepMilli,
  unit,
  productName,
  className,
  compact = false,
}: {
  supplierOrgId: string;
  productId: string;
  qtyMilli: number;
  minQtyMilli: number;
  qtyStepMilli: number;
  unit: string;
  /** Used in button labels so screen readers know which product they change. */
  productName: string;
  className?: string;
  /** In a dense list: "add" is a round + button without the label. */
  compact?: boolean;
}) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const [qty, setQty] = useState(qtyMilli);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const root = useRef<HTMLDivElement>(null);

  const update = (next: number) => {
    const previous = qty;
    setQty(next);
    setError(null);
    // Removing a cart line: it fades while the server removes it, instead of vanishing on the refresh.
    const line = next === 0 ? root.current?.closest("[data-cart-line]") : null;
    line?.setAttribute("data-removing", "");
    startTransition(async () => {
      const result = await setCartQuantityAction({ supplierOrgId, productId, qtyMilli: next });
      if (!result.ok) {
        line?.removeAttribute("data-removing");
        setQty(previous);
        setError(
          result.error === "product_unavailable" || result.error === "invalid_quantity"
            ? t(`errors.${result.error}`)
            : t("errors.unknown"),
        );
      }
    });
  };

  return (
    <div ref={root} className={cn("space-y-1", className)}>
      {qty === 0 ? (
        <Button
          type="button"
          variant="outline"
          size={compact ? "icon" : "sm"}
          className={compact ? "rounded-full" : undefined}
          aria-label={`${t("add")}: ${productName}`}
          disabled={pending}
          onClick={() => update(stepUp(0, minQtyMilli, qtyStepMilli))}
        >
          {compact ? <Plus /> : <ShoppingCart />}
          {compact ? null : t("add")}
        </Button>
      ) : (
        <div className="inline-flex items-center rounded-md border border-border" aria-busy={pending}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={`${t("decrease")}: ${productName}`}
            disabled={pending}
            onClick={() => update(stepDown(qty, minQtyMilli, qtyStepMilli))}
          >
            <Minus />
          </Button>
          <span className="min-w-16 px-1 text-center text-sm tabular-nums" aria-live="polite">
            {milliToInput(qty, locale === "en" ? "." : ",")} {unit}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={`${t("increase")}: ${productName}`}
            disabled={pending}
            onClick={() => update(stepUp(qty, minQtyMilli, qtyStepMilli))}
          >
            <Plus />
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
