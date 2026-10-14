"use client";

import { Ban, RotateCcw, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allowEmailAction, restoreEmailAction, revokeEmailAction } from "./actions";

export type AccessRow = { id: string; email: string; note: string | null; revoked: boolean; addedAt: string };

type Message = { tone: "success" | "error"; text: string } | null;

export function AccessManager({ rows }: { rows: AccessRow[] }) {
  const t = useTranslations("admin.access");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const errorText = (code: string) => {
    if (code === "invalid_email" || code === "invalid") return t("errors.invalid_email");
    if (code === "cannot_revoke_self") return t("errors.cannot_revoke_self");
    return t("errors.unknown");
  };

  return (
    <div className="space-y-6">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          startTransition(async () => {
            const result = await allowEmailAction({ email, note });
            if (result.ok) {
              setMessage({ tone: "success", text: result.authUserFailed ? t("authUserWarning") : t(`done.${result.status}`) });
              setEmail("");
              setNote("");
            } else {
              setMessage({ tone: "error", text: errorText(result.error) });
            }
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="access-email">{t("email")}</Label>
          <Input id="access-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="access-note">{t("note")}</Label>
          <Input id="access-note" value={note} maxLength={200} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={pending}>
          <UserPlus />
          {t("add")}
        </Button>
      </form>

      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.email}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {row.note ? `${row.note} · ` : ""}
                  {t("added")} {row.addedAt}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{row.revoked ? t("status.revoked") : t("status.active")}</span>
              {row.revoked ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await restoreEmailAction(row.email);
                      setMessage(result.ok ? { tone: "success", text: t("done.restored") } : { tone: "error", text: errorText(result.error) });
                    })
                  }
                >
                  <RotateCcw />
                  {t("restore")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await revokeEmailAction(row.id);
                      setMessage(result.ok ? null : { tone: "error", text: errorText(result.error) });
                    })
                  }
                >
                  <Ban />
                  {t("revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
