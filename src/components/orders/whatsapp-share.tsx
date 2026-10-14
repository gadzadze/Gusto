import { MessageCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { whatsappLink } from "@/lib/whatsapp";
import type { OrderDetail } from "@/server/domain/orders/queries";
import { appUrl } from "@/server/notifications/links";

/**
 * "Send on WhatsApp": opens WhatsApp with a prefilled message. The person
 * sends it; Gusto records nothing as delivered (CLAUDE.md, product honesty
 * rules), and the copy says "send", never "sent".
 */
export async function WhatsappShare({ detail, kind }: { detail: OrderDetail; kind: "to_supplier" | "confirmed" | "rejected" }) {
  const { order, items, counterpartyPhone } = detail;
  if (!counterpartyPhone) return null;
  const t = await getTranslations("notifications.whatsapp");
  const to = await getTranslations("orders.whatsapp");
  const values = {
    number: `GST-${order.number}`,
    buyer: order.buyerName,
    count: items.length,
    total: formatMoney(order.totalMinor, order.currency),
    link: `${appUrl()}/o/${order.number}`,
  };
  const message =
    kind === "to_supplier" ? t("toSupplier", values) : kind === "confirmed" ? t("toBuyerConfirmed", values) : t("toBuyerRejected", values);
  const href = whatsappLink(counterpartyPhone, message);
  if (!href) return null;
  return (
    <div className="space-y-1.5 print:hidden">
      <Button asChild variant="outline">
        <a href={href} target="_blank" rel="noopener noreferrer">
          <MessageCircle />
          {kind === "to_supplier" ? to("sendToSupplier") : to("tellBuyer")}
        </a>
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">{to("hint")}</p>
    </div>
  );
}
