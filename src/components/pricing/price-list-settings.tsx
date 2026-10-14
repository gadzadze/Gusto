"use client";

import { Check, Pencil, Star, StarOff, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  deletePriceListAction,
  renamePriceListAction,
  setDefaultPriceListAction,
} from "@/app/supplier/pricing/actions";

export function PriceListSettings({
  priceListId,
  name,
  isDefault,
  customerCount,
  disabled,
}: {
  priceListId: string;
  name: string;
  isDefault: boolean;
  customerCount: number;
  disabled: boolean;
}) {
  const t = useTranslations("pricing");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) return after?.();
      setError(t(`errors.${(result.error ?? "unknown") as "unknown"}`));
    });
  };

  return (
    <div className="space-y-3">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {editing ? (
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renamePriceListAction(priceListId, draft), () => setEditing(false));
          }}
        >
          <Input aria-label={t("detail.rename")} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <Button type="submit" variant="outline" size="icon" aria-label={t("detail.rename")} disabled={pending}>
            <Check />
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!editing ? (
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
            <Pencil />
            {t("detail.rename")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || pending}
          onClick={() => run(() => setDefaultPriceListAction(priceListId, !isDefault))}
        >
          {isDefault ? <StarOff /> : <Star />}
          {isDefault ? t("detail.unsetDefault") : t("detail.makeDefault")}
        </Button>
        {confirmDelete ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => deletePriceListAction(priceListId))}>
            <Trash2 />
            {t("detail.deleteConfirm")}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            {t("detail.delete")}
          </Button>
        )}
      </div>
      {!isDefault ? <p className="text-sm text-muted-foreground">{t("detail.defaultHint")}</p> : null}
      {confirmDelete ? (
        <p className="text-sm text-muted-foreground">{t("detail.deleteHint", { count: customerCount })}</p>
      ) : null}
    </div>
  );
}
