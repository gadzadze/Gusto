import { getTranslations } from "next-intl/server";
import { getFormats } from "@/server/i18n/formats";

export async function TotalsBlock({
  subtotalMinor,
  vatMinor,
  totalMinor,
  currency,
}: {
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  currency: string;
}) {
  const fmt = await getFormats();
  const t = await getTranslations("cart");
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1 text-sm tabular-nums">
      <div className="flex justify-between gap-4 text-muted-foreground">
        <dt>{t("subtotal")}</dt>
        <dd>{fmt.money(subtotalMinor, currency)}</dd>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <dt>{t("vat")}</dt>
        <dd>{fmt.money(vatMinor, currency)}</dd>
      </div>
      <div className="flex justify-between gap-4 border-t border-border pt-1 text-base font-semibold">
        <dt>{t("total")}</dt>
        <dd>{fmt.money(totalMinor, currency)}</dd>
      </div>
    </dl>
  );
}
