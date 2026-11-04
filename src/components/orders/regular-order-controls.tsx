"use client";

import { CalendarClock, ShoppingCart, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { deleteRegularOrderAction, loadRegularOrderAction, saveRegularOrderAction } from "@/app/buyer/regular/actions";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** On a placed order: "save as a regular order" with the usual weekday. */
export function SaveRegularOrder({ orderId, defaultName, defaultWeekday }: { orderId: string; defaultName: string; defaultWeekday: number }) {
  const t = useTranslations("regular");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [weekday, setWeekday] = useState(defaultWeekday);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock />
        {t("save")}
      </Button>
    );
  }
  return (
    <form
      className="w-full max-w-md space-y-3 rounded-xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await saveRegularOrderAction(orderId, { name, weekday });
          if (result.ok) {
            setMessage({ tone: "success", text: t("saved") });
            setOpen(false);
          } else {
            setMessage({ tone: "error", text: t(`errors.${result.error as "unknown"}`) });
          }
        });
      }}
    >
      <p className="font-semibold">{t("save")}</p>
      <p className="text-sm text-muted-foreground">{t("saveHint")}</p>
      <div className="space-y-2">
        <Label htmlFor="regular-name">{t("name")}</Label>
        <Input id="regular-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="regular-weekday">{t("weekday")}</Label>
        <Select id="regular-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>{t(`days.${d}`)}</option>
          ))}
        </Select>
      </div>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || name.trim() === ""}>{t("saveConfirm")}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
    </form>
  );
}

/** One row's buttons on the regular-orders page. */
export function RegularOrderButtons({ id }: { id: string }) {
  const t = useTranslations("regular");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await loadRegularOrderAction(id);
            setError(!result.ok);
          })
        }
      >
        <ShoppingCart />
        {t("putInCart")}
      </Button>
      {confirming ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteRegularOrderAction(id);
              setError(!result.ok);
            })
          }
        >
          <Trash2 />
          {t("deleteConfirm")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          <Trash2 />
          {t("delete")}
        </Button>
      )}
      {error ? <span className="text-xs text-destructive">{t("errors.unknown")}</span> : null}
    </div>
  );
}
