import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PickCheck } from "@/components/orders/pick-check";
import { PrintButton } from "@/components/orders/print-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { parseDateInput, todayIn } from "@/lib/dates";
import { requireSupplier } from "@/server/auth/guards";
import { getPickList } from "@/server/domain/orders/pick-list";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getFormats } from "@/server/i18n/formats";

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
  const fmt = await getFormats();
  const ctx = await requireSupplier();
  const t = await getTranslations("orders.pick");
  const tu = await getTranslations("units");
  const format = await getFormatter();
  const params = await searchParams;
  const [org] = await getDb().select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const raw = typeof params.day === "string" ? params.day : "";
  const day = raw === "none" ? "none" : (parseDateInput(raw) ?? todayIn(org?.timezone ?? "UTC"));
  const list = await getPickList(ctx, day);
  const view = params.view === "stops" ? "stops" : "products";
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
          <nav aria-label={t("viewLabel")} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 print:hidden sm:max-w-md">
            {(["products", "stops"] as const).map((v) => (
              <Link
                key={v}
                href={`/supplier/orders/pick?day=${day}&view=${v}`}
                replace
                aria-current={view === v ? "true" : undefined}
                className={`inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium ${view === v ? "bg-surface shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(v === "products" ? "viewProducts" : "viewStops")}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-muted-foreground">{t(view === "products" ? "hintProducts" : "hintStops")}</p>
          {view === "products" ? (
            list.groups.map((g) => (
              <section key={g.category} className="space-y-1 break-inside-avoid">
                <h3 className="text-sm font-semibold text-muted-foreground">{g.category || t("otherCategory")}</h3>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {g.rows.map((r) => (
                    <li key={r.key}>
                      <PickCheck storageKey={`pick:${day}:p:${r.key}`}>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            {r.name}
                            {r.sku ? <span className="block text-xs text-muted-foreground">{r.sku}</span> : null}
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-base font-semibold">
                            {fmt.qty(r.qtyMilli)} {tu(r.unit as "kg")}
                          </span>
                        </span>
                        {r.parts.length > 1 ? (
                          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            {r.parts.map((part) => (
                              <span key={part.orderNumber}>
                                {part.buyerName}: <b className="font-semibold text-foreground">{fmt.qty(part.qtyMilli)}</b>
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </PickCheck>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <ol className="space-y-4">
              {list.orders.map((o, index) => (
                <li key={o.id} className="break-inside-avoid space-y-1">
                  <div className="text-sm">
                    <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{index + 1}</span>
                    <Link href={`/supplier/orders/${o.id}`} className="font-medium tabular-nums hover:underline">GST-{o.number}</Link>{" "}
                    <b>{o.buyerName}</b>
                    <span className="block pl-8 text-muted-foreground">
                      {o.address}, {o.city}
                      {o.instructions ? ` · ${o.instructions}` : ""}
                    </span>
                    {o.note ? <span className="block pl-8 text-muted-foreground">{o.note}</span> : null}
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {(list.stopLines[o.id] ?? []).map((line) => (
                      <li key={line.key}>
                        <PickCheck storageKey={`pick:${day}:s:${o.id}:${line.key}`}>
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0">{line.name}</span>
                            <span className="whitespace-nowrap tabular-nums font-semibold">
                              {fmt.qty(line.qtyMilli)} {tu(line.unit as "kg")}
                            </span>
                          </span>
                        </PickCheck>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
