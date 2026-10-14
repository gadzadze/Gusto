"use client";

import { CircleCheck, PauseCircle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrgStatus } from "@/server/db/schema";

type ReviewResult = { ok: true } | { ok: false; error: string };

/**
 * Approve / suspend / reactivate controls. The server action is passed in, so
 * the same panel serves suppliers (all three) and buyers (no approval step).
 */
export function ReviewPanel({
  orgId,
  status,
  review,
}: {
  orgId: string;
  status: OrgStatus;
  review: (input: { orgId: string; action: "approve" | "suspend" | "reactivate"; reason?: string }) => Promise<ReviewResult>;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");

  const run = (action: "approve" | "suspend" | "reactivate") => {
    setError(null);
    startTransition(async () => {
      const result = await review({ orgId, action, reason: reason || undefined });
      if (result.ok) {
        setReasonFor(null);
        setReason("");
        return;
      }
      setError(
        result.error === "stale_status" || result.error === "reason_required"
          ? t(`reviewErrors.${result.error}`)
          : t("reviewErrors.stale_status"),
      );
    });
  };

  return (
    <div className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {reasonFor ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="reason">{t("actions.reason")}</Label>
            <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-sm text-muted-foreground">{t("actions.reasonHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={reasonFor === "suspend" ? "outline" : "default"} disabled={pending} onClick={() => run(reasonFor)}>
              {reasonFor === "suspend" ? <PauseCircle /> : <RotateCcw />}
              {reasonFor === "suspend" ? t("actions.confirmSuspend") : t("actions.confirmReactivate")}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setReasonFor(null)}>
              {tc("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === "pending_review" ? (
            <Button disabled={pending} onClick={() => run("approve")}>
              <CircleCheck />
              {t("actions.approve")}
            </Button>
          ) : null}
          {status !== "suspended" ? (
            <Button variant="outline" disabled={pending} onClick={() => setReasonFor("suspend")}>
              <PauseCircle />
              {t("actions.suspend")}
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => setReasonFor("reactivate")}>
              <RotateCcw />
              {t("actions.reactivate")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
