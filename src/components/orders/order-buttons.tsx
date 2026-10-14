"use client";

import { RotateCcw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { cancelOrderAction, reorderAction } from "@/app/buyer/orders/actions";

export function ReorderButton({ orderId, size = "default" }: { orderId: string; size?: "default" | "sm" }) {
  const t = useTranslations("orders");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant="outline"
        size={size}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reorderAction(orderId);
            setError(!result.ok);
          })
        }
      >
        <RotateCcw />
        {t("orderAgain")}
      </Button>
      {error ? <span className="text-xs text-destructive">{t("errors.unknown")}</span> : null}
    </span>
  );
}

export function BuyerCancelButton({ orderId }: { orderId: string }) {
  const t = useTranslations("orders");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {confirming ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await cancelOrderAction(orderId);
                if (!result.ok) setError(t(`errors.${result.error as "unknown"}`));
                setConfirming(false);
              })
            }
          >
            <XCircle />
            {t("actions.buyerCancelConfirm")}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t("actions.back")}
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <XCircle />
          {t("actions.buyerCancel")}
        </Button>
      )}
    </div>
  );
}
