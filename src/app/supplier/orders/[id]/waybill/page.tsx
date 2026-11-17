import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { WaybillSheet } from "@/components/orders/waybill-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { minorToInput } from "@/lib/money";
import { milliToInput } from "@/lib/quantity";
import { requireSupplier } from "@/server/auth/guards";
import { NotFoundError } from "@/server/domain/errors";
import { getWaybillSheet } from "@/server/domain/orders/waybill";
import { getFormats } from "@/server/i18n/formats";

export default async function WaybillPage(props: PageProps<"/supplier/orders/[id]/waybill">) {
  const t = await getTranslations("waybill");
  const { id } = await props.params;
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground print:hidden">
        <Link href={`/supplier/orders/${id}`}>
          <ArrowLeft />
          {t("back")}
        </Link>
      </Button>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <Sheet {...props} />
      </Suspense>
    </>
  );
}

// Formatting happens here, on the server: the client component only gets strings.
async function Sheet({ params }: PageProps<"/supplier/orders/[id]/waybill">) {
  const fmt = await getFormats();
  const ctx = await requireSupplier();
  const tu = await getTranslations("units");
  const format = await getFormatter();
  const { id } = await params;
  const sheet = await getWaybillSheet(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const money = (minor: number) => fmt.money(minor, sheet.currency);
  return (
    <WaybillSheet
      number={`GST-${sheet.number}`}
      seller={{ name: sheet.seller.name, legalId: sheet.seller.legalId ?? "" }}
      buyer={{ name: sheet.buyer.name, legalId: sheet.buyer.legalId ?? "" }}
      delivery={{
        address: sheet.deliveryAddress,
        city: sheet.deliveryCity,
        instructions: sheet.deliveryInstructions ?? "",
        date: sheet.deliveryDate ?? "",
        dateLabel: sheet.deliveryDate ? format.dateTime(new Date(`${sheet.deliveryDate}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" }) : "",
      }}
      note={sheet.note ?? ""}
      lines={sheet.lines.map((l) => ({
        n: l.lineNo,
        name: l.name,
        code: l.code ?? "",
        unit: tu(l.unit as "kg"),
        qty: fmt.qty(l.qtyMilli),
        qtyPlain: milliToInput(l.qtyMilli, "."),
        price: money(l.unitPriceMinor),
        pricePlain: minorToInput(l.unitPriceMinor, "."),
        vat: `${l.vatRateBp / 100}%`,
        total: money(l.lineTotalMinor),
        totalPlain: minorToInput(l.lineTotalMinor, "."),
      }))}
      totals={{ subtotal: money(sheet.subtotalMinor), vat: money(sheet.vatMinor), total: money(sheet.totalMinor) }}
      vatIncluded={sheet.pricesIncludeVat}
    />
  );
}
