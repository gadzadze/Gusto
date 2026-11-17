import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type * as React from "react";
import { BuyerSearchForm } from "@/components/buyer/search-form";
import { OrderProgress } from "@/components/dashboard/order-progress";
import { Panel, PanelRow } from "@/components/dashboard/panel";
import { ReorderButton } from "@/components/orders/order-buttons";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { RegularOrderButtons } from "@/components/orders/regular-order-controls";
import { Button } from "@/components/ui/button";
import type { ConnectedSupplier } from "@/server/domain/buyer/catalog";
import type { OrderListItem } from "@/server/domain/orders/queries";
import type { RegularOrderView } from "@/server/domain/orders/regular";
import { getFormats } from "@/server/i18n/formats";

type OrderRow = Omit<OrderListItem, "itemCount">;

export type BuyerHomeProps = {
  suppliers: ConnectedSupplier[];
  recent: OrderRow[];
  open: OrderRow[];
  regular: RegularOrderView[];
  /** When this buyer last ordered from each supplier, by supplier id. */
  lastOrders: Record<string, Date>;
  /** The "often ordered" product grid, built by the page (it needs the catalog's product views). */
  topSection: React.ReactNode;
  now: Date;
};

/** The buyer's home: search, what is due, what is on its way, and the suppliers to order from. */
export async function BuyerHome({ suppliers, recent, open, regular, lastOrders, topSection, now }: BuyerHomeProps) {
  const fmt = await getFormats();
  const t = await getTranslations("buyer");
  const tr = await getTranslations("regular");
  const to = await getTranslations("orders");
  const td = await getTranslations("buyer.dashboard");
  const th = await getTranslations("buyer.home");
  const dueToday = regular.filter((r) => r.dueToday);
  const format = await getFormatter();
  const openTotal = open.reduce((sum, o) => sum + o.totalMinor, 0);
  const currency = open[0]?.currency ?? "GEL";
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const regularShown = dueToday.length > 0 ? dueToday : regular.slice(0, 3);
  return (
    <div className="space-y-6">
      <BuyerSearchForm />
      <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          {regular.length > 0 ? (
            <Panel
              id="regular-orders"
              title={dueToday.length > 0 ? tr("dueTitle") : tr("title")}
              tone={dueToday.length > 0 ? "accent" : "plain"}
              action={{ href: "/buyer/regular", label: tr("viewAll") }}
            >
              {regularShown.map((r) => (
                <PanelRow key={r.id} className="flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-sm text-muted-foreground">{r.supplierName} · {tr("every", { day: tr(`days.${r.weekday as 1}`) })}</p>
                  </div>
                  <RegularOrderButtons id={r.id} />
                </PanelRow>
              ))}
            </Panel>
          ) : null}

          <Panel id="open-orders" title={th("inProgress")} count={open.length > 0 ? open.length : undefined} action={{ href: "/buyer/orders", label: to("viewAll") }}>
            {open.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">{td("openEmpty")}</p>
            ) : (
              open.map((o) => (
                <Link key={o.id} href={`/buyer/orders/${o.id}`} className="block border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/50">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{o.supplierName}</span>
                      <span className="block text-sm text-muted-foreground">
                        <span className="tabular-nums">{to("number", { number: o.number })}</span> · {fmt.money(o.totalMinor, o.currency)}
                        {o.deliveryDate ? ` · ${th("deliveryOn", { date: day(o.deliveryDate) })}` : ""}
                      </span>
                    </span>
                    <OrderStatusBadge status={o.status} />
                  </span>
                  <OrderProgress step={o.status === "confirmed" ? 2 : 1} />
                </Link>
              ))
            )}
          </Panel>

          {recent.length > 0 ? (
            <Panel id="recent-orders" title={to("recent")} action={{ href: "/buyer/orders", label: to("viewAll") }}>
              {recent.map((o) => (
                <PanelRow key={o.id} className="flex-wrap">
                  <Link href={`/buyer/orders/${o.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate font-semibold">{o.supplierName}</span>
                    <span className="block text-sm text-muted-foreground">
                      <span className="tabular-nums">{to("number", { number: o.number })}</span> · {fmt.money(o.totalMinor, o.currency)}
                    </span>
                  </Link>
                  <OrderStatusBadge status={o.status} />
                  <ReorderButton orderId={o.id} size="sm" />
                </PanelRow>
              ))}
            </Panel>
          ) : null}

          {topSection}
        </div>

        <div className="space-y-5">
          <Panel id="suppliers" title={t("suppliersTitle")} action={{ href: "/buyer/suppliers", label: th("findBusiness") }}>
            {suppliers.map((s) => {
              const last = lastOrders[s.id];
              return (
                <PanelRow key={s.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {last ? th("lastOrder", { when: format.relativeTime(last, now) }) : th("neverOrdered")}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/buyer/suppliers/${s.id}`}>{th("catalog")}</Link>
                  </Button>
                </PanelRow>
              );
            })}
          </Panel>
          {open.length > 0 ? (
            <section aria-labelledby="open-total" className="rounded-xl border border-border bg-surface px-4 py-4">
              <h2 id="open-total" className="text-sm text-muted-foreground">{td("open")}</h2>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{open.length}</p>
              <p className="text-xs text-muted-foreground">{th("openTotal", { amount: fmt.money(openTotal, currency) })}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
