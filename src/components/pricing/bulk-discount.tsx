"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyBulkAction, previewBulkAction, type BulkPreviewView } from "@/app/supplier/pricing/actions";

export function BulkDiscount({ priceListId, disabled }: { priceListId: string; disabled: boolean }) {
  const t = useTranslations("pricing");
  const [percent, setPercent] = useState("");
  const [preview, setPreview] = useState<{ preview: BulkPreviewView; discountBp: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("detail.bulkHint")}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <div className="flex max-w-md items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="bulk-percent">{t("detail.bulkPercent")}</Label>
          <Input
            id="bulk-percent"
            inputMode="decimal"
            value={percent}
            disabled={disabled}
            onChange={(e) => {
              setPercent(e.target.value);
              setPreview(null);
            }}
          />
        </div>
        <Button
          variant="outline"
          disabled={disabled || pending || !percent}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await previewBulkAction(priceListId, percent);
              if (result.ok) setPreview({ preview: result.preview, discountBp: result.discountBp });
              else setMessage({ tone: "error", text: t(`errors.${result.error as "unknown"}`) });
            });
          }}
        >
          {t("detail.bulkPreview")}
        </Button>
      </div>
      {preview ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm font-medium">{t("detail.bulkSample")}</p>
          <ul className="space-y-1 text-sm">
            {preview.preview.sample.map((s) => (
              <li key={s.name} className="flex justify-between gap-4">
                <span className="truncate">{s.name}</span>
                <span className="whitespace-nowrap tabular-nums">
                  <span className="text-muted-foreground line-through">{s.base}</span> {s.next}
                </span>
              </li>
            ))}
          </ul>
          <Button
            disabled={pending || preview.preview.count === 0}
            onClick={() =>
              startTransition(async () => {
                const result = await applyBulkAction(priceListId, preview.discountBp);
                setPreview(null);
                if (result.ok) setMessage({ tone: "success", text: t("detail.bulkApplied", { count: result.count }) });
                else setMessage({ tone: "error", text: t(`errors.${result.error as "unknown"}`) });
              })
            }
          >
            {t("detail.bulkApply", { count: preview.preview.count })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
