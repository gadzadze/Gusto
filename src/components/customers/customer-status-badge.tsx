import { Ban, CircleCheck, Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { CustomerStatus } from "@/server/db/schema";

export async function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  const t = await getTranslations("customers.status");
  if (status === "active") {
    return (
      <Badge tone="green">
        <CircleCheck aria-hidden />
        {t("active")}
      </Badge>
    );
  }
  if (status === "invited") {
    return (
      <Badge tone="amber">
        <Mail aria-hidden />
        {t("invited")}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <Ban aria-hidden />
      {t("blocked")}
    </Badge>
  );
}
