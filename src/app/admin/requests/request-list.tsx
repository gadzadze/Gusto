"use client";

import { CircleCheck, Inbox, PhoneCall, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewRequestAction } from "./actions";

export type RequestRow = {
  id: string;
  businessName: string;
  legalId: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  note: string | null;
  adminNote: string | null;
  status: "new" | "contacted" | "approved" | "rejected";
  freeMail: boolean;
  createdAt: string;
};

export function RequestList({ rows }: { rows: RequestRow[] }) {
  const t = useTranslations("admin.requests");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const run = (id: string, action: "contacted" | "approve" | "reject") => {
    setMessage(null);
    startTransition(async () => {
      const result = await reviewRequestAction({ id, action, note: note || undefined });
      if (result.ok) {
        setRejecting(null);
        setNote("");
        if (action === "approve") {
          setMessage({ tone: "success", text: result.authUserFailed ? t("approvedAuthWarning") : t("approved") });
        }
        return;
      }
      const known = ["stale_status", "note_required", "legal_id_taken", "invalid_legal_id"];
      setMessage({ tone: "error", text: known.includes(result.error) ? t(`errors.${result.error}`) : t("errors.unknown") });
    });
  };

  return (
    <div className="space-y-4">
      {/* Stays mounted when the last open request leaves the list, so the result is still shown. */}
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      {rows.length === 0 ? <EmptyState icon={Inbox} title={t("empty")} /> : null}
      <ul className="space-y-4">
        {rows.map((r) => {
          const open = r.status === "new" || r.status === "contacted";
          return (
            <li key={r.id} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{r.businessName}</p>
                  <p className="text-sm text-muted-foreground">{r.createdAt}</p>
                </div>
                <Badge tone={r.status === "new" ? "amber" : r.status === "approved" ? "green" : "neutral"}>{t(`status.${r.status}`)}</Badge>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("legalId")}</dt>
                  <dd className="tabular-nums">{r.legalId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("city")}</dt>
                  <dd>{r.city}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{r.contactName}</dt>
                  <dd className="tabular-nums">{r.phone}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("email")}</dt>
                  <dd className="break-all">{r.email}</dd>
                </div>
                {r.note ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">{t("note")}</dt>
                    <dd className="whitespace-pre-wrap">{r.note}</dd>
                  </div>
                ) : null}
                {r.adminNote ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">{t("adminNote")}</dt>
                    <dd className="whitespace-pre-wrap">{r.adminNote}</dd>
                  </div>
                ) : null}
              </dl>
              {r.freeMail ? (
                <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {t("freeMail")}
                </p>
              ) : null}
              {open ? (
                rejecting === r.id ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor={`note-${r.id}`}>{t("reasonLabel")}</Label>
                      <Textarea id={`note-${r.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" disabled={pending} onClick={() => run(r.id, "reject")}>
                        <X />
                        {t("confirmReject")}
                      </Button>
                      <Button variant="ghost" disabled={pending} onClick={() => setRejecting(null)}>
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={pending} onClick={() => run(r.id, "approve")}>
                      <CircleCheck />
                      {t("approve")}
                    </Button>
                    {r.status === "new" ? (
                      <Button variant="outline" disabled={pending} onClick={() => run(r.id, "contacted")}>
                        <PhoneCall />
                        {t("markContacted")}
                      </Button>
                    ) : null}
                    <Button variant="outline" disabled={pending} onClick={() => { setNote(""); setRejecting(r.id); }}>
                      <X />
                      {t("reject")}
                    </Button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
