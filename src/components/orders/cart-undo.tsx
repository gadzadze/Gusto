"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { setCartQuantityAction } from "@/app/buyer/cart/actions";
import { StatusToast } from "@/components/ui/status-toast";

/** Sent by the quantity stepper when it removed a line from the cart, so the cart page can offer to take it back. */
export const CART_REMOVED = "cart:removed";
export type CartRemoved = { supplierOrgId: string; productId: string; qtyMilli: number; name: string };

/**
 * "Removed: <product> - Undo". It lives on the cart page rather than in the line, because the line is gone once the page refreshes.
 * Like every notice it stays until it is closed. Undo puts the same quantity back through the normal cart action.
 */
export function CartUndoHost() {
  const t = useTranslations("cart");
  const router = useRouter();
  const [removed, setRemoved] = useState<CartRemoved | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onRemoved = (event: Event) => {
      setRemoved((event as CustomEvent<CartRemoved>).detail);
      setError(false);
    };
    window.addEventListener(CART_REMOVED, onRemoved);
    return () => window.removeEventListener(CART_REMOVED, onRemoved);
  }, []);

  if (!removed) return null;
  return (
    <StatusToast onDismiss={() => setRemoved(null)}>
      <span className="flex flex-wrap items-center gap-x-3">
        <span className="min-w-0 truncate">{error ? t("undoFailed") : t("removedNotice", { name: removed.name })}</span>
        <button
          type="button"
          disabled={pending}
          className="inline-flex min-h-11 items-center font-semibold text-brand hover:underline disabled:opacity-60"
          onClick={() =>
            startTransition(async () => {
              const result = await setCartQuantityAction({ supplierOrgId: removed.supplierOrgId, productId: removed.productId, qtyMilli: removed.qtyMilli });
              if (result.ok) {
                setRemoved(null);
                router.refresh();
              } else setError(true);
            })
          }
        >
          {t("undo")}
        </button>
      </span>
    </StatusToast>
  );
}
