"use client";

import { Check, PackageCheck, Printer, X, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrderAction } from "@/lib/orders/transitions";
import {
  cancelOrderBySupplierAction,
  confirmOrderAction,
  deliverOrderAction,
  rejectOrderAction,
} from "../actions";

type Line = { itemId: string; name: string; orderedQty: string; unit: string };
type Mode = null | "confirm" | "reject" | "cancel";

/** Buttons exist only for actions valid in the current status; the server enforces it regardless. */
export function SupplierOrderActions({ orderId, actions, lines }: { orderId: string; actions: OrderAction[]; lines: Line[] }) {
  const t = useTranslations("orders");
  const [mode, setMode] = useState<Mode>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.itemId, l.orderedQty])),
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMode(null);
        setText("");
        return;
      }
      setError(t(`errors.${(result.error ?? "unknown") as "unknown"}`));
    });
  };

  return (
    <div className="space-y-4 print:hidden">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {mode === "confirm" ? (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <p className="font-semibold">{t("actions.confirmTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("actions.confirmHint")}</p>
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.itemId} className="flex items-center gap-3">
                <Label htmlFor={`qty-${l.itemId}`} className="min-w-0 flex-1 font-normal">
                  {l.name}
                  <span className="block text-xs text-muted-foreground">{t("detail.ordered", { qty: `${l.orderedQty} ${l.unit}` })}</span>
                </Label>
                <Input
                  id={`qty-${l.itemId}`}
                  aria-label={`${l.name}: ${t("actions.confirmQty")}`}
                  inputMode="decimal"
                  className="w-28 text-right tabular-nums"
                  value={quantities[l.itemId]}
                  onChange={(e) => setQuantities({ ...quantities, [l.itemId]: e.target.value })}
                />
                <span className="w-12 text-sm text-muted-foreground">{l.unit}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="confirm-note">{t("actions.noteOptional")}</Label>
            <Textarea id="confirm-note" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              disabled={pending}
              onClick={() =>
                run(() =>
                  confirmOrderAction(orderId, {
                    lines: lines.map((l) => ({ itemId: l.itemId, qty: quantities[l.itemId] })),
                    note: text || undefined,
                  }),
                )
              }
            >
              <Check />
              {t("actions.submitConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>{t("actions.back")}</Button>
          </div>
        </div>
      ) : null}

      {mode === "reject" || mode === "cancel" ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Label htmlFor="reason">{mode === "reject" ? t("actions.rejectReason") : t("actions.cancelReason")}</Label>
          <Textarea id="reason" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => (mode === "reject" ? rejectOrderAction(orderId, text) : cancelOrderBySupplierAction(orderId, text)))
              }
            >
              <XCircle />
              {mode === "reject" ? t("actions.reject") : t("actions.supplierCancel")}
            </Button>
            <Button variant="ghost" onClick={() => setMode(null)}>{t("actions.back")}</Button>
          </div>
        </div>
      ) : null}

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {actions.includes("confirm") ? (
            <Button onClick={() => setMode("confirm")}>
              <Check />
              {t("actions.confirm")}
            </Button>
          ) : null}
          {actions.includes("deliver") ? (
            <Button disabled={pending} onClick={() => run(() => deliverOrderAction(orderId))}>
              <PackageCheck />
              {t("actions.deliver")}
            </Button>
          ) : null}
          {actions.includes("reject") ? (
            <Button variant="outline" onClick={() => setMode("reject")}>
              <X />
              {t("actions.reject")}
            </Button>
          ) : null}
          {actions.includes("supplier_cancel") ? (
            <Button variant="outline" onClick={() => setMode("cancel")}>
              <XCircle />
              {t("actions.supplierCancel")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer />
            {t("detail.print")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
