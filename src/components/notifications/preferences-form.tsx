"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { savePreferencesAction } from "@/app/notifications/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";

export function PreferencesForm({ initial }: { initial: { emailNewOrders: boolean; emailOrderUpdates: boolean } }) {
  const t = useTranslations("notifications.preferences");
  const tc = useTranslations("common");
  const [newOrders, setNewOrders] = useState(initial.emailNewOrders);
  const [updates, setUpdates] = useState(initial.emailOrderUpdates);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <Checkbox
        id="pref-new-orders"
        label={t("newOrders")}
        checked={newOrders}
        onChange={(e) => {
          setNewOrders(e.target.checked);
          setState("idle");
        }}
      />
      <Checkbox
        id="pref-order-updates"
        label={t("orderUpdates")}
        checked={updates}
        onChange={(e) => {
          setUpdates(e.target.checked);
          setState("idle");
        }}
      />
      {state === "saved" ? <FormAlert tone="success">{t("saved")}</FormAlert> : null}
      {state === "error" ? <FormAlert tone="error">{tc("error")}</FormAlert> : null}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await savePreferencesAction({ emailNewOrders: newOrders, emailOrderUpdates: updates });
            setState(result.ok ? "saved" : "error");
          })
        }
      >
        {t("save")}
      </Button>
    </section>
  );
}
