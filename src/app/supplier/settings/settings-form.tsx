"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { describedBy, Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { zodFormResolver } from "@/lib/validation/form-resolver";
import { supplierSettingsSchema, type SupplierSettingsInput } from "@/lib/validation/supplier-settings";
import { updateSupplierSettingsAction } from "./actions";

type Fields = Required<SupplierSettingsInput>;
const resolver = zodFormResolver<Fields>(supplierSettingsSchema);

export function SupplierSettingsForm({ defaultValues, disabled }: { defaultValues: Fields; disabled: boolean }) {
  const t = useTranslations("settings");
  const tp = useTranslations("products");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | string>("idle");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Fields>({ resolver, defaultValues });

  const onSubmit = handleSubmit((values) => {
    setStatus("idle");
    startTransition(async () => {
      const result = await updateSupplierSettingsAction(values);
      if (result.ok) return setStatus("saved");
      setStatus(tp(`errors.${result.error}`));
      for (const [field, key] of Object.entries(result.fieldErrors ?? {}) as [string, string][]) {
        setError(field as keyof Fields, { type: "server", message: key });
      }
    });
  });

  const err = (name: keyof Fields) => errors[name]?.message;
  const input = (name: Exclude<keyof Fields, "pricesIncludeVat">, hint?: string) => ({
    id: name,
    disabled,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": describedBy(name, err(name), hint),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-8">
      {status === "saved" ? <FormAlert tone="success">{t("saved")}</FormAlert> : null}
      {status !== "idle" && status !== "saved" ? <FormAlert tone="error">{status}</FormAlert> : null}

      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("sectionContact")}</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="contactName" label={t("contactName")} error={err("contactName")}>
            <Input autoComplete="name" {...input("contactName")} />
          </Field>
          <Field id="phone" label={t("phone")} hint={t("phoneHint")} error={err("phone")}>
            <Input type="tel" autoComplete="tel" {...input("phone", t("phoneHint"))} />
          </Field>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("sectionOrders")}</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="minOrder" label={t("minOrder")} hint={t("minOrderHint")} error={err("minOrder")}>
            <Input inputMode="decimal" {...input("minOrder", t("minOrderHint"))} />
          </Field>
          <Field id="deliveryArea" label={t("deliveryArea")} error={err("deliveryArea")}>
            <Input {...input("deliveryArea")} />
          </Field>
        </div>
        <Checkbox
          id="pricesIncludeVat"
          label={t("pricesIncludeVat")}
          hint={t("pricesIncludeVatHint")}
          disabled={disabled}
          {...register("pricesIncludeVat")}
        />
        <Field id="deliveryTerms" label={t("deliveryTerms")} hint={t("deliveryTermsHint")} error={err("deliveryTerms")}>
          <Textarea rows={3} {...input("deliveryTerms", t("deliveryTermsHint"))} />
        </Field>
        <Field id="orderCutoffNote" label={t("orderCutoffNote")} hint={t("orderCutoffHint")} error={err("orderCutoffNote")}>
          <Input {...input("orderCutoffNote", t("orderCutoffHint"))} />
        </Field>
      </section>

      <Button type="submit" disabled={pending || disabled}>
        {pending ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
