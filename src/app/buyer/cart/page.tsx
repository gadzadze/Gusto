import { UnitPrice } from "@/components/orders/unit-price";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductImage } from "@/components/catalog/product-image";
import { QuantityStepper } from "@/components/orders/quantity-stepper";
import { TotalsBlock } from "@/components/orders/totals-block";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { requireBuyer } from "@/server/auth/guards";
import { getCart, listCarts } from "@/server/domain/orders/cart";
import { getFormats } from "@/server/i18n/formats";

export default async function CartPage({ searchParams }: PageProps<"/buyer/cart">) {
  const t = await getTranslations("cart");
  return (
    <>
      <PageHeader title={t("title")} />
      <Carts searchParams={searchParams} />
    </>
  );
}

async function Carts({ searchParams }: Pick<PageProps<"/buyer/cart">, "searchParams">) {
  const fmt = await getFormats();
  const ctx = await requireBuyer();
  const t = await getTranslations("cart");
  const tu = await getTranslations("units");
  const params = await searchParams;
  const summaries = await listCarts(ctx);
  const carts = await Promise.all(summaries.map((s) => getCart(ctx, s.supplierOrgId)));
  const skipped = typeof params.skipped === "string" && params.skipped ? params.skipped.split("|").slice(0, 20) : [];

  return (
    <div className="space-y-6">
      {params.reordered ? <FormAlert tone="success">{t("reordered")}</FormAlert> : null}
      {skipped.length ? <FormAlert tone="error">{t("skipped", { names: skipped.join(", ") })}</FormAlert> : null}

      {carts.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Button asChild variant="outline">
              <Link href="/buyer/suppliers">{t("toSuppliers")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {carts.length > 1 ? <p className="text-sm text-muted-foreground">{t("separateNote")}</p> : null}
          {carts.map((cart) => (
            <section key={cart.supplier.id} id={cart.supplier.id} className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  <Link href={`/buyer/suppliers/${cart.supplier.id}`} className="hover:underline">{cart.supplier.name}</Link>
                </h2>
                <span className="text-sm text-muted-foreground">{t("items", { count: cart.lines.length })}</span>
              </div>
              <ul className="divide-y divide-border">
                {cart.lines.map((line) => (
                  // Phone: picture and name on top, then the quantity control and the line total on one row (one flex row
                  // left the name a few letters wide). From sm up it is the single row it always was.
                  <li key={line.productId} data-cart-line className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 sm:flex sm:flex-wrap sm:items-center">
                    <ProductImage path={line.imagePath} alt="" size={48} />
                    <div className="min-w-0 sm:flex-1">
                      <p className="font-medium leading-snug">{line.name}</p>
                      <p className="text-sm tabular-nums text-muted-foreground">
                        <UnitPrice price={fmt.money(line.unitPriceMinor, cart.supplier.currency)} listPrice={fmt.money(line.listPriceMinor, cart.supplier.currency)} adjustBp={line.adjustBp} /> / {tu(line.unit)}
                      </p>
                      {line.problem ? (
                        <p className="flex items-center gap-1 text-sm text-destructive">
                          <AlertTriangle aria-hidden className="size-3.5" />
                          {line.problem === "unavailable" ? t("problemUnavailable") : t("problemQuantity")}
                        </p>
                      ) : null}
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-3 sm:contents">
                      <QuantityStepper
                        supplierOrgId={cart.supplier.id}
                        productId={line.productId}
                        qtyMilli={line.qtyMilli}
                        minQtyMilli={line.minQtyMilli}
                        qtyStepMilli={line.qtyStepMilli}
                        unit={tu(line.unit)}
                        productName={line.name}
                      />
                      <p className="text-right text-sm font-medium tabular-nums sm:w-24">
                        {fmt.money(line.lineTotalMinor, cart.supplier.currency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <TotalsBlock {...cart.totals} currency={cart.supplier.currency} />
              {cart.shortfallMinor > 0 ? (
                <p className="text-right text-sm text-[var(--status-amber-fg)]">
                  {t("shortfall", { amount: fmt.money(cart.shortfallMinor, cart.supplier.currency) })}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={`/buyer/suppliers/${cart.supplier.id}`}>{t("continue")}</Link>
                </Button>
                {cart.shortfallMinor === 0 && cart.lines.every((l) => l.problem === null) ? (
                  <Button asChild>
                    <Link href={`/buyer/checkout/${cart.supplier.id}`}>{t("checkout")}</Link>
                  </Button>
                ) : null}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
