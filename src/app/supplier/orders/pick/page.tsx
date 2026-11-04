import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PrintButton } from "@/components/orders/print-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { parseDateInput, todayIn } from "@/lib/dates";
import { formatQuantityNumber } from "@/lib/quantity";
import { requireSupplier } from "@/server/auth/guards";
import { getPickList } from "@/server/domain/orders/pick-list";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export default async function PickPage({ searchParams }: PageProps<"/supplier/orders/pick">) {
  const t = await getTranslations("orders.pick");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground print:hidden">
        <Link href="/supplier/orders?tab=confirmed">
          <ArrowLeft />
          {t("back")}
        </Link>
      </Button>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Pick searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Pick({ searchParams }: Pick<PageProps<"/supplier/orders/pick">, "searchParams">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("orders.pick");
  const tu = await getTranslations("units");
  const format = await getFormatter();
  const params = await searchParams;
  const [org] = await getDb().select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const raw = typeof params.day === "string" ? params.day : "";
  const day = raw === "none" ? "none" : (parseDateInput(raw) ?? todayIn(org?.timezone ?? "UTC"));
  const list = await getPickList(ctx, day);
  const dayLabel = day === "none" ? t("noDay") : format.dateTime(new Date(`${day}T00:00:00Z`), { dateStyle: "full", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="space-y-1">
          <label htmlFor="day" className="text-sm font-medium">{t("day")}</label>
          <Input id="day" name="day" type="date" defaultValue={day === "none" ? "" : day} className="w-48" />
        </div>
        <Button type="submit" variant="outline">{t("show")}</Button>
        <Button asChild variant="ghost"><Link href="/supplier/orders/pick?day=none">{t("noDayLink")}</Link></Button>
        <PrintButton label={t("print")} />
      </form>

      <h2 className="text-lg font-semibold">{dayLabel}</h2>
      {list.orders.length === 0 ? (
        <EmptyState icon={Printer} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("summary", { orders: list.orders.length })}</p>
          {list.groups.map((g) => (
            <section key={g.category} className="space-y-1 break-inside-avoid">
              <h3 className="text-sm font-semibold text-muted-foreground">{g.category || t("otherCategory")}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {g.rows.map((r) => (
                  <li key={`${r.name}-${r.sku}`} className="flex items-center gap-3 px-4 py-2">
                    <span aria-hidden className="size-4 shrink-0 rounded border border-foreground/50" />
                    <span className="min-w-0 flex-1">
                      {r.name}
                      {r.sku ? <span className="block text-xs text-muted-foreground">{r.sku}</span> : null}
                    </span>
                    <span className="whitespace-nowrap tabular-nums font-semibold">
                      {formatQuantityNumber(r.qtyMilli)} {tu(r.unit as "kg")}
                    </span>
                    <span className="hidden w-24 text-right text-xs text-muted-foreground sm:block">{t("inOrders", { count: r.orderCount })}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="space-y-1 break-inside-avoid">
            <h3 className="text-sm font-semibold text-muted-foreground">{t("stops")}</h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {list.orders.map((o) => (
                <li key={o.id} className="px-4 py-2 text-sm">
                  <Link href={`/supplier/orders/${o.id}`} className="font-medium tabular-nums hover:underline">GST-{o.number}</Link>{" "}
                  {o.buyerName}
                  <span className="block text-muted-foreground">
                    {o.address}, {o.city}
                    {o.instructions ? ` · ${o.instructions}` : ""}
                  </span>
                  {o.note ? <span className="block text-muted-foreground">{o.note}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
