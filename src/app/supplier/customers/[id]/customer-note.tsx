"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setCustomerNoteAction } from "../actions";

/** The supplier's private remark about this customer. The buyer never sees it. */
export function CustomerNote({ customerId, initial, disabled }: { customerId: string; initial: string; disabled: boolean }) {
  const t = useTranslations("customers.detail");
  const [note, setNote] = useState(initial);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await setCustomerNoteAction(customerId, note);
          setMessage(result.ok ? { tone: "success", text: t("noteSaved") } : { tone: "error", text: t("noteFailed") });
        });
      }}
    >
      <Label htmlFor="customer-note">{t("noteTitle")}</Label>
      <Textarea id="customer-note" rows={3} maxLength={2000} value={note} disabled={disabled} onChange={(e) => setNote(e.target.value)} aria-describedby="customer-note-hint" />
      <p id="customer-note-hint" className="text-xs text-muted-foreground">{t("noteHint")}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <Button type="submit" variant="outline" disabled={disabled || pending || note === initial}>{t("noteSave")}</Button>
    </form>
  );
}
