"use client";

import { Ban, RotateCcw, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { allowEmailAction, bulkAllowAction, restoreEmailAction, revokeEmailAction, type BulkResult } from "./actions";

export type AccessRow = { id: string; email: string; note: string | null; role: "buyer" | "supplier" | null; businessName: string | null; legalId: string | null; revoked: boolean; addedAt: string };

type Message = { tone: "success" | "error"; text: string } | null;

export function AccessManager({ rows }: { rows: AccessRow[] }) {
  const t = useTranslations("admin.access");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [legalId, setLegalId] = useState("");
  const [role, setRole] = useState<"" | "buyer" | "supplier">("");
  const [message, setMessage] = useState<Message>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulk, setBulk] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  const errorText = (code: string) => {
    if (code === "invalid_email" || code === "invalid") return t("errors.invalid_email");
    if (code === "invalid_legal_id") return t("errors.invalid_legal_id");
    if (code === "legal_id_taken") return t("errors.legal_id_taken");
    if (code === "cannot_revoke_self") return t("errors.cannot_revoke_self");
    return t("errors.unknown");
  };

  return (
    <div className="space-y-6">
      <form
        className="grid gap-3 sm:grid-cols-2 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          startTransition(async () => {
            const result = await allowEmailAction({ email, note, role, businessName, legalId });
            if (result.ok) {
              setMessage({ tone: "success", text: result.authUserFailed ? t("authUserWarning") : t(`done.${result.status}`) });
              setEmail("");
              setNote("");
              setRole("");
              setBusinessName("");
              setLegalId("");
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
          <Label htmlFor="access-business">{t("businessName")}</Label>
          <Input id="access-business" value={businessName} maxLength={160} onChange={(e) => setBusinessName(e.target.value)} autoComplete="off" required={legalId !== ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="access-legal-id">{t("legalId")}</Label>
          <Input id="access-legal-id" inputMode="numeric" value={legalId} onChange={(e) => setLegalId(e.target.value)} autoComplete="off" required={businessName !== ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="access-note">{t("note")}</Label>
          <Input id="access-note" value={note} maxLength={200} placeholder={t("notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="access-role">{t("role")}</Label>
          <Select id="access-role" value={role} onChange={(e) => setRole(e.target.value as "" | "buyer" | "supplier")} aria-describedby="access-role-hint">
            <option value="">{t("roles.any")}</option>
            <option value="supplier">{t("roles.supplier")}</option>
            <option value="buyer">{t("roles.buyer")}</option>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          <UserPlus />
          {t("add")}
        </Button>
      </form>

      <p id="access-role-hint" className="-mt-3 text-xs text-muted-foreground">{t("roleHint")} {t("verifiedHint")}</p>

      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}

      <details className="rounded-xl border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{t("bulk.title")}</summary>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBulk(null);
            startTransition(async () => {
              const result = await bulkAllowAction(bulkText);
              setBulk(result);
              if (result.ok && result.results.every((r) => r.outcome !== "error") && result.parseErrors.length === 0) setBulkText("");
            });
          }}
        >
          <Label htmlFor="access-bulk">{t("bulk.title")}</Label>
          <Textarea id="access-bulk" rows={6} value={bulkText} placeholder={t("bulk.placeholder")} onChange={(e) => setBulkText(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("bulk.hint")}</p>
          <Button type="submit" variant="outline" disabled={pending || bulkText.trim() === ""}>
            <UserPlus />
            {t("bulk.submit")}
          </Button>
        </form>
        {bulk && !bulk.ok ? <FormAlert tone="error">{errorText(bulk.error)}</FormAlert> : null}
        {bulk?.ok ? (
          <div className="mt-3 space-y-2 text-sm" aria-live="polite">
            <p className="font-medium">
              {t("bulk.summary", {
                done: bulk.results.filter((r) => r.outcome !== "error").length,
                failed: bulk.results.filter((r) => r.outcome === "error").length + bulk.parseErrors.length,
              })}
            </p>
            {bulk.tooMany ? <p className="text-muted-foreground">{t("bulk.tooMany")}</p> : null}
            <ul className="space-y-1">
              {bulk.parseErrors.map((e) => (
                <li key={`p${e.line}`} className="text-muted-foreground">
                  {t("bulk.line", { line: e.line })}: {t(`bulk.parse.${e.key}`)}
                </li>
              ))}
              {bulk.results.filter((r) => r.outcome === "error").map((r) => (
                <li key={`r${r.line}`} className="text-muted-foreground">
                  {t("bulk.line", { line: r.line })} ({r.email}): {errorText(r.error ?? "unknown")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.email}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {row.role ? `${t(`roles.${row.role}`)} · ` : ""}
                  {row.legalId ? `${row.businessName ?? ""} (${row.legalId}) · ` : `${t("unverified")} · `}
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
