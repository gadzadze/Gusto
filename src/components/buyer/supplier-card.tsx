import { ChevronRight, Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import type { ConnectedSupplier } from "@/server/domain/buyer/catalog";

export async function SupplierCard({ supplier }: { supplier: ConnectedSupplier }) {
  const t = await getTranslations("buyer");
  return (
    <Link
      href={`/buyer/suppliers/${supplier.id}`}
      className="flex items-center gap-4 rounded-xl border border-border p-4 transition-colors hover:bg-muted/50"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Store aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{supplier.name}</span>
        <span className="block text-sm text-muted-foreground">
          {t("productCount", { count: supplier.productCount })} ·{" "}
          {supplier.minOrderMinor > 0
            ? t("minOrder", { amount: formatMoney(supplier.minOrderMinor, supplier.currency) })
            : t("noMinOrder")}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
