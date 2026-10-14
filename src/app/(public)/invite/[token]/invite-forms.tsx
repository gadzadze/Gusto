"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { describedBy, Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { zodFormResolver } from "@/lib/validation/form-resolver";
import { BUYER_BUSINESS_TYPES, buyerOnboardingSchema } from "@/lib/validation/onboarding";
import { acceptInviteAction, acceptInviteWithOnboardingAction, type AcceptResult } from "./actions";

function useErrorText() {
  const t = useTranslations("invite");
  return (result: AcceptResult) => t(`errors.${result.error}`);
}

export function AcceptButton({ token, label }: { token: string; label: string }) {
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInviteAction(token);
            setError(errorText(result));
          })
        }
      >
        {label}
      </Button>
    </div>
  );
}

type Fields = {
  kind: "buyer";
  businessName: string;
  businessType: string;
  contactName: string;
  phone: string;
  city: string;
  addressLine: string;
  deliveryInstructions: string;
};
const resolver = zodFormResolver<Fields>(buyerOnboardingSchema);

/** Short buyer onboarding, prefilled from what the supplier entered. */
export function NewBuyerForm({
  token,
  prefill,
}: {
  token: string;
  prefill: { businessName: string; contactName: string; phone: string };
}) {
  const t = useTranslations("onboarding");
  const ti = useTranslations("invite");
  const errorText = useErrorText();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors },
  } = useForm<Fields>({
    resolver,
    defaultValues: { kind: "buyer", businessType: "", city: "", addressLine: "", deliveryInstructions: "", ...prefill },
  });

  const err = (name: keyof Fields) => errors[name]?.message;
  const input = (name: keyof Fields, hint?: string) => ({
    id: name,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": describedBy(name, err(name), hint),
    ...register(name),
  });

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit((values) => {
        setError(null);
        startTransition(async () => {
          const result = await acceptInviteWithOnboardingAction(token, values);
          setError(errorText(result));
          for (const [field, key] of Object.entries(result.fieldErrors ?? {}) as [string, string][]) {
            setFieldError(field as keyof Fields, { type: "server", message: key });
          }
        });
      })}
    >
      <h2 className="font-semibold">{ti("newBuyerTitle")}</h2>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Field id="businessName" label={t("businessName")} error={err("businessName")}>
        <Input autoComplete="organization" {...input("businessName")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="businessType" label={t("businessType")} error={err("businessType")}>
          <Select {...input("businessType")}>
            <option value="">{t("businessTypePlaceholder")}</option>
            {BUYER_BUSINESS_TYPES.map((type) => (
              <option key={type} value={type}>{t(`businessTypes.${type}`)}</option>
            ))}
          </Select>
        </Field>
        <Field id="contactName" label={t("contactName")} error={err("contactName")}>
          <Input autoComplete="name" {...input("contactName")} />
        </Field>
        <Field id="phone" label={t("phone")} error={err("phone")}>
          <Input type="tel" autoComplete="tel" {...input("phone")} />
        </Field>
        <Field id="city" label={t("city")} error={err("city")}>
          <Input autoComplete="address-level2" placeholder={t("cityPlaceholder")} {...input("city")} />
        </Field>
      </div>
      <Field id="addressLine" label={t("addressLine")} error={err("addressLine")}>
        <Input autoComplete="street-address" {...input("addressLine")} />
      </Field>
      <Field id="deliveryInstructions" label={t("deliveryInstructions")} hint={t("deliveryInstructionsHint")} error={err("deliveryInstructions")} optional>
        <Textarea rows={2} {...input("deliveryInstructions", t("deliveryInstructionsHint"))} />
      </Field>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? t("submitting") : ti("newBuyerSubmit")}
      </Button>
    </form>
  );
}
