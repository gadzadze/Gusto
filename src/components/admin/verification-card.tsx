import { TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VerificationInfo } from "@/server/domain/admin/organizations";

/**
 * What an admin checks before approving: the legal ID (look it up in the
 * registry), the sign-in address (company mailbox or personal), who vouched
 * for the business, and whether it came pre-registered by the admin.
 */
export async function VerificationCard({ info }: { info: VerificationInfo }) {
  const t = await getTranslations("admin.verification");
  const none = "—";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("legalId")}</dt>
            <dd className="tabular-nums">{info.legalId ?? none}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("email")}</dt>
            <dd>{info.ownerEmails.join(", ") || none}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("source")}</dt>
            <dd>
              {info.preRegistered
                ? t("preRegistered")
                : info.invitedBy.length > 0
                  ? t("invitedBy", { names: info.invitedBy.join(", ") })
                  : t("selfRegistered")}
            </dd>
          </div>
        </dl>
        {info.freeMail ? (
          <p className="flex items-start gap-2 rounded-md bg-muted p-3">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("freeMail")}
          </p>
        ) : null}
        <p className="text-muted-foreground">{t("howTo")}</p>
      </CardContent>
    </Card>
  );
}
