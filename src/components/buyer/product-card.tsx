"use client";

import { SheetGrabber } from "@/components/ui/sheet-grabber";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { ProductImage } from "@/components/catalog/product-image";
import { QuantityStepper } from "@/components/orders/quantity-stepper";
import { Button } from "@/components/ui/button";
import type { ProductView } from "./product-view";

/** A catalog item at the buyer's own price; opens a detail sheet. */
export function ProductCard({ product, layout = "card", caption }: { product: ProductView; layout?: "card" | "row"; caption?: string }) {
  const t = useTranslations("buyer");
  const dialog = useRef<HTMLDialogElement>(null);
  const hints = product.hints;
  const price = (
    <span className="tabular-nums">
      <span className="font-semibold">{product.price}</span>
      <span className="text-muted-foreground"> / {product.unit}</span>
    </span>
  );

  const detailDialog = (
    <dialog
      ref={dialog}
      data-motion="sheet"
      aria-label={product.name}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none rounded-t-2xl bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <SheetGrabber dialogRef={dialog} />
      <div className="space-y-4 p-5 max-sm:pt-1">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{product.name}</h2>
          <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => dialog.current?.close()}>
            <X />
          </Button>
        </div>
        {product.imagePath ? (
          <div className="flex justify-center rounded-xl bg-muted p-2">
            <ProductImage path={product.imagePath} alt={product.name} size={280} />
          </div>
        ) : null}
        <div className="text-base">{price}</div>
        <p className="text-sm text-muted-foreground">{product.vatNote}</p>
        {hints.length ? <p className="text-sm">{hints.join(" · ")}</p> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {product.brand ? (<><dt className="text-muted-foreground">{t("brand")}</dt><dd>{product.brand}</dd></>) : null}
          {product.packDescription ? (<><dt className="text-muted-foreground">{t("pack")}</dt><dd>{product.packDescription}</dd></>) : null}
          {product.sku ? (<><dt className="text-muted-foreground">{t("sku")}</dt><dd>{product.sku}</dd></>) : null}
        </dl>
        {product.description ? <p className="whitespace-pre-line text-sm">{product.description}</p> : null}
      </div>
    </dialog>
  );

  if (layout === "row") {
    // Dense list: a small picture, the name, one muted line (who sells it and at what price) and a round + on the right.
    return (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <button type="button" onClick={() => dialog.current?.showModal()} className="flex min-w-0 flex-[1_1_11rem] items-center gap-3 rounded-md text-left">
            <ProductImage path={product.imagePath} alt="" size={48} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-medium leading-snug">{product.name}</span>
              <span className="mt-0.5 block text-sm tabular-nums text-muted-foreground">
                {product.price} / {product.unit}
              </span>
              {caption ? <span className="block truncate text-sm text-muted-foreground">{caption}</span> : null}
            </span>
          </button>
          <QuantityStepper
            compact
            className="ml-auto"
            supplierOrgId={product.supplierOrgId}
            productId={product.id}
            qtyMilli={product.cartQtyMilli}
            minQtyMilli={product.minQtyMilli}
            qtyStepMilli={product.qtyStepMilli}
            unit={product.unit}
            productName={product.name}
          />
        </div>
        {detailDialog}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 glass p-3">
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="flex w-full items-center gap-3 rounded-md text-left transition-colors hover:bg-muted/50"
        >
          <ProductImage path={product.imagePath} alt="" size={64} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium leading-snug">{product.name}</span>
            {product.packDescription ? (
              <span className="block text-sm text-muted-foreground">{product.packDescription}</span>
            ) : null}
            <span className="mt-1 block text-sm">{price}</span>
            {hints.length ? <span className="block text-xs text-muted-foreground">{hints.join(" · ")}</span> : null}
          </span>
        </button>
        <QuantityStepper
          className="self-end"
          supplierOrgId={product.supplierOrgId}
          productId={product.id}
          qtyMilli={product.cartQtyMilli}
          minQtyMilli={product.minQtyMilli}
          qtyStepMilli={product.qtyStepMilli}
          unit={product.unit}
          productName={product.name}
        />
      </div>

      {detailDialog}
    </>
  );
}
