import { CircleCheck, CircleOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

export async function ProductStatusBadge({ isActive }: { isActive: boolean }) {
  const t = await getTranslations("products.status");
  return isActive ? (
    <Badge tone="green">
      <CircleCheck aria-hidden />
      {t("active")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <CircleOff aria-hidden />
      {t("inactive")}
    </Badge>
  );
}
