"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { deleteProductAction } from "@/app/supplier/products/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

/** Delete a product for good: a two-step inline confirmation that says what will and will not be affected. */
export function ProductDelete({
  productId,
  name,
  openOrders,
  orderLines,
  disabled,
}: {
  productId: string;
  name: string;
  openOrders: number;
  orderLines: number;
  disabled?: boolean;
}) {
  const t = useTranslations("products.delete");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setConfirming(true)}>
          <Trash2 />
          {t("button")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-border p-4" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-body">
      <p id="delete-title" className="font-semibold">{t("title", { name })}</p>
      <div id="delete-body" className="space-y-1 text-sm text-muted-foreground">
        <p>{t("effects")}</p>
        <p>{orderLines > 0 ? t("history", { count: orderLines }) : t("noHistory")}</p>
        {openOrders > 0 ? <p className="font-medium text-foreground">{t("openOrders", { count: openOrders })}</p> : null}
        <p>{t("hideInstead")}</p>
      </div>
      {error ? <FormAlert tone="error">{t("error")}</FormAlert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(false);
              const result = await deleteProductAction(productId);
              if (result.ok) router.replace("/supplier/products");
              else setError(true);
            })
          }
        >
          <Trash2 />
          {t("confirm")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
