import { MessageCircle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { milliToInput } from "@/lib/quantity";
import { whatsappLink } from "@/lib/whatsapp";
import type { OrderDetail } from "@/server/domain/orders/queries";
import { appUrl } from "@/server/notifications/links";

/**
 * "Send on WhatsApp": opens WhatsApp with a prefilled message. The person
 * sends it; Gusto records nothing as delivered (CLAUDE.md, product honesty
 * rules), and the copy says "send", never "sent".
 */
/** Order lines shown in the message to the supplier; the rest is "and N more" (a link has a length limit). */
const MAX_LINES = 25;

export async function WhatsappShare({
  detail,
  kind,
  prominent = false,
}: {
  detail: OrderDetail;
  kind: "to_supplier" | "confirmed" | "rejected" | "delivered";
  /** Right after placing an order: the main next step, a filled full-width button. */
  prominent?: boolean;
}) {
  const { order, items, counterpartyPhone } = detail;
  if (!counterpartyPhone) return null;
  const t = await getTranslations("notifications.whatsapp");
  const to = await getTranslations("orders.whatsapp");
  const tu = await getTranslations("units");
  const format = await getFormatter();
  const values = {
    number: `GST-${order.number}`,
    buyer: order.buyerName,
    count: items.length,
    total: formatMoney(order.totalMinor, order.currency),
    link: `${appUrl()}/o/${order.number}`,
    date: order.deliveryDate ?? "",
  };
  // The whole order in the message, so the supplier can read it in WhatsApp as they do today.
  const supplierMessage = () => {
    const parts = [t("order.header", { number: values.number, buyer: values.buyer })];
    const lines = items
      .slice(0, MAX_LINES)
      .map((i) => t("order.line", { name: i.name, qty: `${milliToInput(i.orderedQtyMilli, ",")} ${tu(i.unit)}` }));
    if (items.length > MAX_LINES) lines.push(t("order.more", { count: items.length - MAX_LINES }));
    parts.push(lines.join("\n"));
    const facts = [t("order.total", { total: values.total }), t("order.address", { address: `${order.deliveryAddress}, ${order.deliveryCity}` })];
    if (order.requestedDeliveryDate) {
      // A calendar day has no time or zone: format it as UTC so it never shifts.
      facts.push(t("order.day", { date: format.dateTime(new Date(`${order.requestedDeliveryDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) }));
    }
    if (order.note) facts.push(t("order.note", { note: order.note }));
    parts.push(facts.join("\n"));
    parts.push(t("order.link", { link: values.link }));
    return parts.join("\n\n");
  };
  const message =
    kind === "to_supplier"
      ? supplierMessage()
      : kind === "confirmed"
        ? t(order.deliveryDate ? "toBuyerConfirmedWithDate" : "toBuyerConfirmed", values)
        : kind === "delivered"
          ? t("toBuyerDelivered", values)
          : t("toBuyerRejected", values);
  const href = whatsappLink(counterpartyPhone, message);
  if (!href) return null;
  const prominentNow = prominent && kind === "to_supplier";
  return (
    <div className="min-w-0 space-y-1.5 print:hidden">
      <Button
        asChild
        variant={prominentNow ? "default" : "outline"}
        className={prominentNow ? "h-auto min-h-11 w-full max-w-full whitespace-normal py-3 text-center sm:w-auto" : "h-auto max-w-full whitespace-normal py-2 text-center"}
      >
        <a href={href} target="_blank" rel="noopener noreferrer">
          <MessageCircle />
          {prominentNow ? to("sendNow") : kind === "to_supplier" ? to("sendToSupplier") : to("tellBuyer")}
        </a>
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">{prominentNow ? to("sendNowHint") : to("hint")}</p>
    </div>
  );
}
