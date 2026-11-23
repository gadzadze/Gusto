"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { deleteProductAction } from "@/app/supplier/products/actions";
import { SheetGrabber } from "@/components/ui/sheet-grabber";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

/** Delete button for a row of the product list: an icon button that opens a confirmation dialog. */
export function ProductRowDelete({
  productId,
  name,
  openOrders,
  orderLines,
}: {
  productId: string;
  name: string;
  openOrders: number;
  orderLines: number;
}) {
  const t = useTranslations("products.delete");
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`${t("button")}: ${name}`}
        title={t("button")}
        onClick={() => {
          setError(false);
          ref.current?.showModal();
        }}
      >
        <Trash2 />
      </Button>
      <dialog
        ref={ref}
        data-motion="sheet"
        aria-labelledby={`del-${productId}`}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-foreground backdrop:bg-black/40 max-sm:m-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:pt-0"
      >
        <SheetGrabber dialogRef={ref} />
        <div className="space-y-3">
          <p id={`del-${productId}`} className="font-semibold">{t("title", { name })}</p>
          <div className="space-y-1 text-sm text-muted-foreground">
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
                  if (result.ok) {
                    ref.current?.close();
                    router.refresh();
                  } else setError(true);
                })
              }
            >
              <Trash2 />
              {t("confirm")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => ref.current?.close()}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
