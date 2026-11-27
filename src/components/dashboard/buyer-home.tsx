import { ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type * as React from "react";
import { BuyerSearchForm } from "@/components/buyer/search-form";
import type { VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { VoiceLauncher, type VoiceChip } from "@/components/buyer/voice/voice-launcher";
import { ListRow, ListSection } from "@/components/dashboard/list-section";
import { OrderSteps } from "@/components/dashboard/order-progress";
import Link from "next/link";
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
  /** "The usual" shortcuts under the command bar, built from this buyer's own history. */
  voiceChips?: VoiceChip[];
};

/** The buyer's home: search, what is due, what is on its way, and the suppliers to order from. */
export async function BuyerHome({ suppliers, recent, open, regular, lastOrders, topSection, now, voiceSuppliers, voiceChips }: BuyerHomeProps) {
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
  const shortDay = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const regularShown = dueToday.length > 0 ? dueToday : regular.slice(0, 3);
  return (
    <div className="space-y-8">
      {/* With the assistant on, the command bar is the first thing; plain search is the Search tab. Without it, the search field. */}
      {voiceSuppliers ? <VoiceLauncher variant="bar" suppliers={voiceSuppliers} chips={voiceChips} /> : <BuyerSearchForm />}
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

          <ListSection id="orders" title={to("title")} action={{ href: "/buyer/orders", label: th("all") }}>
            {open.length === 0 && earlier.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{td("openEmpty")}</p>
            ) : null}
            {open.map((o) => (
              <Link key={o.id} href={`/buyer/orders/${o.id}`} className="block py-3 transition-colors hover:text-brand">
                <span className="flex items-start gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-snug">{o.supplierName}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      <OrderStatusText status={o.status} />
                      <span className="tabular-nums">{to("number", { number: o.number })}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">{fmt.money(o.totalMinor, o.currency)}</span>
                    {o.deliveryDate ? <span className="block text-sm text-muted-foreground">{th("deliveryOn", { date: shortDay(o.deliveryDate) })}</span> : null}
                  </span>
                </span>
                <OrderSteps step={o.status === "confirmed" ? 2 : 1} />
              </Link>
            ))}
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
