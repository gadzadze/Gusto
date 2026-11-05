"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { revokeSupplierInviteAction } from "@/app/buyer/suppliers/invite/actions";

export type InviteRow = {
  id: string;
  supplierName: string;
  contact: string;
  state: "open" | "expired" | "revoked" | "joined" | "connected";
  requestStatus: "new" | "contacted" | "approved" | "rejected" | null;
  createdAt: string;
};

export function SupplierInviteList({ rows }: { rows: InviteRow[] }) {
  const t = useTranslations("supplierInvite.list");
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  const label = (r: InviteRow) => {
    if (r.state === "joined") {
      return r.requestStatus === "approved" ? t("state.joinedApproved") : r.requestStatus === "rejected" ? t("state.joinedRejected") : t("state.joinedNew");
    }
    return t(`state.${r.state}`);
  };
  return (
    <ul className="max-w-xl divide-y divide-border rounded-xl border border-border">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.supplierName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.contact} · {r.createdAt}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={r.state === "connected" ? "green" : r.state === "joined" && r.requestStatus !== "rejected" ? "blue" : "neutral"}>{label(r)}</Badge>
            {r.state === "open" ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => void (await revokeSupplierInviteAction(r.id)))}>
                {t("revoke")}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
