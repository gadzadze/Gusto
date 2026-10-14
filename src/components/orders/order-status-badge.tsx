import { CircleCheck, Clock, PackageCheck, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/server/db/schema";

// Muted tones + icons (CLAUDE.md, "Design system"): rejected/cancelled are
// gray, not red, so they don't compete with the brand or with errors.
export async function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = await getTranslations("orderStatus");
  switch (status) {
    case "pending":
      return <Badge tone="amber"><Clock aria-hidden />{t("pending")}</Badge>;
    case "confirmed":
      return <Badge tone="blue"><CircleCheck aria-hidden />{t("confirmed")}</Badge>;
    case "delivered":
      return <Badge tone="green"><PackageCheck aria-hidden />{t("delivered")}</Badge>;
    default:
      return <Badge tone="neutral"><XCircle aria-hidden />{t(status)}</Badge>;
  }
}
