import { CircleCheck, Clock, PauseCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { OrgStatus } from "@/server/db/schema";

// "Active" is shown as "approved": it means an admin approved the supplier,
// nothing more (CLAUDE.md, "Product honesty rules").
export async function SupplierStatusBadge({ status }: { status: OrgStatus }) {
  const t = await getTranslations("admin.status");
  if (status === "pending_review") {
    return (
      <Badge tone="amber">
        <Clock aria-hidden />
        {t("pending_review")}
      </Badge>
    );
  }
  if (status === "active") {
    return (
      <Badge tone="green">
        <CircleCheck aria-hidden />
        {t("active")}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <PauseCircle aria-hidden />
      {t("suspended")}
    </Badge>
  );
}
