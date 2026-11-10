import { UnitPrice } from "@/components/orders/unit-price";
import { getFormatter, getTranslations } from "next-intl/server";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { TotalsBlock } from "@/components/orders/totals-block";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { OrderDetail } from "@/server/domain/orders/queries";
import { getFormats } from "@/server/i18n/formats";

/** The read-only body of an order, shared by the buyer and supplier pages (and printing). */
export async function OrderView({ detail, viewer }: { detail: OrderDetail; viewer: "buyer" | "supplier" }) {
  const fmt = await getFormats();
  const t = await getTranslations("orders");
  const tu = await getTranslations("units");
  const ts = await getTranslations("orderStatus");
  const format = await getFormatter();
  // A calendar day has no time or zone: format it as UTC so it never shifts.
  const formatDay = (day: string) => format.dateTime(new Date(`${day}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const { order, items, history } = detail;
  const qty = (milli: number, unit: (typeof items)[number]["unit"]) => `${fmt.input(milli)} ${tu(unit)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tabular-nums">{t("number", { number: order.number })}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="-mt-4 text-sm text-muted-foreground">
        {t("detail.placedAt", { date: format.dateTime(order.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
      </p>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{viewer === "supplier" ? t("detail.buyer") : t("detail.supplier")}</dt>
          <dd className="font-medium">{viewer === "supplier" ? order.buyerName : order.supplierName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("detail.delivery")}</dt>
          <dd>
            {order.deliveryAddress}, {order.deliveryCity}
            {order.deliveryInstructions ? <span className="block text-muted-foreground">{order.deliveryInstructions}</span> : null}
          </dd>
        </div>
        {order.paymentMethod || order.paymentIntervalDays !== null ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("terms.paymentLabel")}</dt>
            <dd className="font-medium">
              {[
                order.paymentMethod ? t(`terms.method.${order.paymentMethod as "cash"}`) : null,
                order.paymentIntervalDays === null ? null : order.paymentIntervalDays === 0 ? t("terms.onDelivery") : t("terms.days", { count: order.paymentIntervalDays }),
              ]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
        ) : null}
        {order.requestedDeliveryDate || order.deliveryDate ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("detail.deliveryDay")}</dt>
            <dd>
              {order.deliveryDate ? (
                <span className="font-medium">
                  {t("detail.deliveryAgreed", { date: formatDay(order.deliveryDate) })}
                </span>
              ) : (
                <span>{t("detail.deliveryRequested", { date: formatDay(order.requestedDeliveryDate as string) })}</span>
              )}
              {order.deliveryDate && order.requestedDeliveryDate && order.deliveryDate !== order.requestedDeliveryDate ? (
                <span className="block text-muted-foreground">
                  {t("detail.deliveryRequested", { date: formatDay(order.requestedDeliveryDate) })}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {order.note ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">{t("detail.note")}</dt>
            <dd className="whitespace-pre-line">{order.note}</dd>
          </div>
        ) : null}
      </dl>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("detail.lines")}</h2>
        <Table>
          <THead>
            <TR>
              <TH className="w-8">#</TH>
              <TH>{t("detail.product")}</TH>
              <TH className="text-right">{t("detail.qty")}</TH>
              <TH className="hidden text-right sm:table-cell">{t("detail.price")}</TH>
              <TH className="text-right">{t("detail.lineTotal")}</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((item) => {
              const changed = item.confirmedQtyMilli !== null && item.confirmedQtyMilli !== item.orderedQtyMilli;
              return (
                <TR key={item.id} className={cn(changed && "bg-[var(--status-amber-bg)]/40")}>
                  <TD className="text-muted-foreground tabular-nums">{item.lineNo}</TD>
                  <TD>
                    <span className="font-medium">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[item.sku, item.packDescription].filter(Boolean).join(" · ")}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {changed ? (
                      <>
                        <span className="block text-xs text-muted-foreground line-through">
                          {t("detail.ordered", { qty: qty(item.orderedQtyMilli, item.unit) })}
                        </span>
                        <span className="block font-medium">
                          {item.confirmedQtyMilli === 0
                            ? t("detail.unavailableLine")
                            : t("detail.confirmedQty", { qty: qty(item.confirmedQtyMilli!, item.unit) })}
                        </span>
                      </>
                    ) : (
                      qty(item.confirmedQtyMilli ?? item.orderedQtyMilli, item.unit)
                    )}
                  </TD>
                  <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                    <UnitPrice price={fmt.money(item.unitPriceMinor, order.currency)} listPrice={item.listPriceMinor === null ? null : fmt.money(item.listPriceMinor, order.currency)} adjustBp={item.adjustBp} />
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{fmt.money(item.lineTotalMinor, order.currency)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <TotalsBlock subtotalMinor={order.subtotalMinor} vatMinor={order.vatMinor} totalMinor={order.totalMinor} currency={order.currency} />
        <p className="text-right text-xs text-muted-foreground">{t("detail.pricesNote")}</p>
      </section>

      <section className="space-y-3 print:hidden">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("detail.history")}</h2>
        <ol className="space-y-2 text-sm">
          {history.map((h, i) => (
            <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
              <span className="w-44 shrink-0 text-muted-foreground">
                {format.dateTime(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              <span>
                <span className="font-medium">{ts(h.toStatus)}</span>
                <span className="text-muted-foreground"> · {h.byBuyer ? t("detail.byBuyer") : t("detail.bySupplier")}</span>
                {h.note ? <span className="block text-muted-foreground">{h.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
