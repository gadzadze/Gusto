import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { TotalsBlock } from "@/components/orders/totals-block";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { milliToInput } from "@/lib/quantity";
import { requireBuyer } from "@/server/auth/guards";
import { listAddresses } from "@/server/domain/buyer/addresses";
import { NotFoundError } from "@/server/domain/errors";
import { getCart } from "@/server/domain/orders/cart";
import { CheckoutForm } from "./checkout-form";

export default async function CheckoutPage(props: PageProps<"/buyer/checkout/[supplierId]">) {
  const t = await getTranslations("checkout");
  const tc = await getTranslations("cart");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/buyer/cart">
          <ArrowLeft />
          {tc("title")}
        </Link>
      </Button>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <Checkout {...props} />
      </Suspense>
    </>
  );
}

async function Checkout({ params }: PageProps<"/buyer/checkout/[supplierId]">) {
  const ctx = await requireBuyer();
  const t = await getTranslations("checkout");
  const tc = await getTranslations("cart");
  const to = await getTranslations("orders.detail");
  const tu = await getTranslations("units");
  const { supplierId } = await params;
  const cart = await getCart(ctx, supplierId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (cart.lines.length === 0) redirect("/buyer/cart");
  const addresses = await listAddresses(ctx);
  const orderable = cart.lines.filter((l) => l.problem === null);
  const canSubmit = orderable.length === cart.lines.length && cart.shortfallMinor === 0;
  const currency = cart.supplier.currency;

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">{cart.supplier.name}</h2>
          <Link href="/buyer/cart" className="text-sm font-medium text-brand hover:underline">{t("editCart")}</Link>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>{to("product")}</TH>
              <TH className="text-right">{to("qty")}</TH>
              <TH className="hidden text-right sm:table-cell">{to("price")}</TH>
              <TH className="text-right">{to("lineTotal")}</TH>
            </TR>
          </THead>
          <TBody>
            {cart.lines.map((l) => (
              <TR key={l.productId}>
                <TD>
                  {l.name}
                  {l.problem ? (
                    <span className="block text-xs text-destructive">
                      {l.problem === "unavailable" ? tc("problemUnavailable") : tc("problemQuantity")}
                    </span>
                  ) : null}
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{milliToInput(l.qtyMilli, ",")} {tu(l.unit)}</TD>
                <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">{formatMoney(l.unitPriceMinor, currency)}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{formatMoney(l.lineTotalMinor, currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <TotalsBlock {...cart.totals} currency={currency} />
        {cart.shortfallMinor > 0 ? (
          <FormAlert tone="error">{tc("shortfall", { amount: formatMoney(cart.shortfallMinor, currency) })}</FormAlert>
        ) : null}
      </section>

      <CheckoutForm
        supplierOrgId={cart.supplier.id}
        canSubmit={canSubmit}
        expected={orderable.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor }))}
        addresses={addresses.map((a) => ({
          id: a.id,
          label: [a.addressLine, a.city, a.instructions].filter(Boolean).join(" · "),
        }))}
      />
    </div>
  );
}
