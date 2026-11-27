import { ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type * as React from "react";
import { BuyerSearchForm } from "@/components/buyer/search-form";
import type { VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { VoiceLauncher } from "@/components/buyer/voice/voice-launcher";
import { ListRow, ListSection } from "@/components/dashboard/list-section";
import { ReorderButton } from "@/components/orders/order-buttons";
import { OrderStatusText } from "@/components/orders/order-status-text";
import { RegularOrderButtons } from "@/components/orders/regular-order-controls";
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
  /** Given only when voice ordering is available to this buyer: adds the mic in the search field and a card under it. */
  voiceSuppliers?: VoiceSupplier[];
};

/** The buyer's home: search, what is due, what is on its way, and the suppliers to order from. */
export async function BuyerHome({ suppliers, recent, open, regular, lastOrders, topSection, now, voiceSuppliers }: BuyerHomeProps) {
  const fmt = await getFormats();
  const t = await getTranslations("buyer");
  const tr = await getTranslations("regular");
  const to = await getTranslations("orders");
  const td = await getTranslations("buyer.dashboard");
  const th = await getTranslations("buyer.home");
  const dueToday = regular.filter((r) => r.dueToday);
  const format = await getFormatter();
  const openIds = new Set(open.map((o) => o.id));
  const earlier = recent.filter((o) => !openIds.has(o.id)); // the ones in progress are already shown above
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const regularShown = dueToday.length > 0 ? dueToday : regular.slice(0, 3);
  return (
    <div className="space-y-8">
      <BuyerSearchForm voiceSuppliers={voiceSuppliers} />
      {voiceSuppliers ? <VoiceLauncher variant="card" suppliers={voiceSuppliers} /> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[1.55fr_1fr]">
        <div className="space-y-8">
          {regular.length > 0 ? (
            <ListSection id="regular-orders" title={dueToday.length > 0 ? tr("dueTitle") : tr("title")} action={{ href: "/buyer/regular", label: th("all") }}>
              {regularShown.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-[1_1_12rem]">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-sm text-muted-foreground">{r.supplierName} · {tr("every", { day: tr(`days.${r.weekday as 1}`) })}</p>
                  </div>
                  <RegularOrderButtons id={r.id} />
                </div>
              ))}
            </ListSection>
          ) : null}

          <ListSection id="open-orders" title={th("inProgress")} action={{ href: "/buyer/orders", label: th("all") }}>
            {open.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{td("openEmpty")}</p>
            ) : (
              open.map((o) => (
                <ListRow
                  key={o.id}
                  href={`/buyer/orders/${o.id}`}
                  title={o.supplierName}
                  subtitle={
                    <>
                      <OrderStatusText status={o.status} className="mr-2" />
                      <span className="whitespace-nowrap tabular-nums">{to("number", { number: o.number })} · {fmt.money(o.totalMinor, o.currency)}</span>
                      {o.deliveryDate ? <span className="mt-0.5 block">{th("deliveryOn", { date: day(o.deliveryDate) })}</span> : null}
                    </>
                  }
                />
              ))
            )}
          </ListSection>

          {earlier.length > 0 ? (
            <ListSection id="recent-orders" title={to("recent")} action={{ href: "/buyer/orders", label: th("all") }}>
              {earlier.map((o) => (
                <ListRow
                  key={o.id}
                  href={`/buyer/orders/${o.id}`}
                  title={o.supplierName}
                  subtitle={
                    <>
                      <span className="tabular-nums">{to("number", { number: o.number })}</span> · {fmt.money(o.totalMinor, o.currency)}
                      {o.status !== "delivered" ? <OrderStatusText status={o.status} className="ml-2" /> : null}
                    </>
                  }
                  trailing={<ReorderButton orderId={o.id} iconOnly />}
                />
              ))}
            </ListSection>
          ) : null}

          {topSection}
        </div>

        <ListSection id="suppliers" title={t("suppliersTitle")} action={{ href: "/buyer/suppliers", label: th("all") }}>
          {suppliers.map((s) => {
            const last = lastOrders[s.id];
            return (
              <ListRow
                key={s.id}
                href={`/buyer/suppliers/${s.id}`}
                title={s.name}
                subtitle={last ? th("lastOrder", { when: format.relativeTime(last, now) }) : th("neverOrdered")}
                trailing={<ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              />
            );
          })}
        </ListSection>
      </div>
    </div>
  );
}
