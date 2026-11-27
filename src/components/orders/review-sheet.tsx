"use client";

import { ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  loadOrderReviewAction,
  type ReviewData,
} from "@/app/supplier/orders/actions";
import { SupplierOrderActions } from "@/app/supplier/orders/[id]/order-actions";
import { SheetGrabber } from "@/components/ui/sheet-grabber";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";

/** The order summary and the confirm / reject controls shown inside the panel. */
export function ReviewBody({
  data,
  orderId,
  onDone,
}: {
  data: ReviewData;
  orderId: string;
  onDone: () => void;
}) {
  const t = useTranslations("orders");
  return (
    <>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("detail.delivery")}</dt>
          <dd>
            {data.address}
            {data.instructions ? ` · ${data.instructions}` : ""}
          </dd>
        </div>
        {data.requestedDay ? (
          <div>
            <dt className="text-muted-foreground">{t("detail.deliveryDay")}</dt>
            <dd>
              {t("detail.deliveryRequested", { date: data.requestedDay })}
            </dd>
          </div>
        ) : null}
        {data.note ? (
          <div>
            <dt className="text-muted-foreground">{t("detail.note")}</dt>
            <dd>{data.note}</dd>
          </div>
        ) : null}
        <div className="text-muted-foreground">
          {t("detail.placedAt", { date: data.placedAt })}
        </div>
      </dl>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {data.lines.map((line) => (
          <li
            key={line.id}
            className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <span className="min-w-0">
              {line.name}
              <span className="block text-xs text-muted-foreground">
                {line.qty} × {line.price}
              </span>
            </span>
            <span className="whitespace-nowrap font-medium tabular-nums">
              {line.total}
            </span>
          </li>
        ))}
      </ul>
      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("review.subtotal")}</dt>
          <dd className="tabular-nums">{data.totals.subtotal}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("review.vat")}</dt>
          <dd className="tabular-nums">{data.totals.vat}</dd>
        </div>
        <div className="flex justify-between gap-4 font-semibold">
          <dt>{t("review.total")}</dt>
          <dd className="tabular-nums">{data.totals.total}</dd>
        </div>
      </dl>
      <SupplierOrderActions
        hidePrint
        orderId={orderId}
        actions={data.actions.filter((a) => a === "confirm" || a === "reject")}
        lines={data.actionLines}
        requestedDate={data.requestedDate}
        minDate={data.minDate}
        maxDate={data.maxDate}
        onDone={onDone}
      />
    </>
  );
}

/**
 * "Review" on a queue row: the order opens in a side panel so a supplier can answer a stack of orders
 * without leaving the page. It is a native modal dialog (focus trap, Escape and the backdrop close it),
 * and the order is loaded only when it is opened. The same confirm / reject controls as the order page.
 */
export function ReviewSheet({
  orderId,
  number,
  buyerName,
  label,
  children,
}: {
  orderId: string;
  number: string;
  buyerName: string;
  label: string;
  /** With children the whole row is the trigger (no separate button); the label stays as its accessible name. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function open() {
    dialog.current?.showModal();
    setState("loading");
    const result = await loadOrderReviewAction(orderId);
    if (result.ok) {
      setData(result.data);
      setState("idle");
    } else setState("error");
  }

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      {children ? (
        <button
          type="button"
          onClick={open}
          aria-label={`${label}: ${buyerName} ${number}`}
          className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-brand"
        >
          {children}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={open}>
          {label}
        </Button>
      )}
      <dialog
        ref={dialog}
        data-motion="side"
        aria-label={`${number} ${buyerName}`}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === dialog.current) close();
        }}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40 max-sm:mt-auto max-sm:ml-0 max-sm:h-auto max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:rounded-t-2xl max-sm:border-l-0 max-sm:border-t"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-surface">
        <SheetGrabber dialogRef={dialog} />
        <div className="flex items-center justify-between gap-3 px-5 py-3 max-sm:pt-0">
          <div className="min-w-0">
            <p className="truncate font-semibold">{buyerName}</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {number}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label={t("review.close")}
          >
            <X />
          </Button>
        </div>
        </div>
        <div className="space-y-6 px-5 py-5">
          {state === "loading" ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          ) : null}
          {state === "error" ? (
            <FormAlert tone="error">{t("review.error")}</FormAlert>
          ) : null}
          {data && state === "idle" ? (
            <ReviewBody
              data={data}
              orderId={orderId}
              onDone={() => {
                close();
                router.refresh();
              }}
            />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
