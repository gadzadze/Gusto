"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitSupplierRequest, type RequestFormState } from "./actions";

export function RequestForm() {
  const t = useTranslations("supplierRequest");
  const [state, action, pending] = useActionState<RequestFormState, FormData>(submitSupplierRequest, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="space-y-3 rounded-xl border border-border p-6" role="status">
        <div className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Check aria-hidden className="size-5" />
        </div>
        <h2 className="text-lg font-semibold">{t("sentTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("sentBody")}</p>
      </div>
    );
  }

  const fe = state.status === "error" ? state.fieldErrors : undefined;
  const err = (name: string) => fe?.[name];

  return (
    <form action={action} className="space-y-5">
      {state.status === "error" && !fe ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {/* Trap for bots; people never see or reach it. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="businessName" label={t("businessName")} error={err("businessName")}>
            <Input id="businessName" name="businessName" autoComplete="organization" required />
          </Field>
        </div>
        <Field id="legalId" label={t("legalId")} hint={t("legalIdHint")} error={err("legalId")}>
          <Input id="legalId" name="legalId" inputMode="numeric" required />
        </Field>
        <Field id="city" label={t("city")} error={err("city")}>
          <Input id="city" name="city" autoComplete="address-level2" placeholder={t("cityPlaceholder")} required />
        </Field>
        <Field id="contactName" label={t("contactName")} error={err("contactName")}>
          <Input id="contactName" name="contactName" autoComplete="name" required />
        </Field>
        <Field id="phone" label={t("phone")} error={err("phone")}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder={t("phonePlaceholder")} required />
        </Field>
        <div className="sm:col-span-2">
          <Field id="email" label={t("email")} hint={t("emailHint")} error={err("email")}>
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="note" label={t("note")} error={err("note")} optional>
            <Textarea id="note" name="note" rows={3} maxLength={500} />
          </Field>
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
