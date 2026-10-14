"use client";

import { Building2, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { describedBy, Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { zodFormResolver } from "@/lib/validation/form-resolver";
import { BUYER_BUSINESS_TYPES, onboardingSchema } from "@/lib/validation/onboarding";
import { submitOnboarding, type OnboardingResult } from "./actions";

// One flat set of fields for both kinds; the shared Zod schema (also run by
// the Server Action) decides which ones apply.
type FormFields = {
  kind: "buyer" | "supplier" | "";
  businessName: string;
  businessType: string;
  legalId: string;
  contactName: string;
  phone: string;
  city: string;
  addressLine: string;
  deliveryInstructions: string;
  deliveryArea: string;
};

const resolver = zodFormResolver<FormFields>(onboardingSchema);

export function OnboardingForm() {
  const t = useTranslations("onboarding");
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<OnboardingResult["error"] | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<FormFields>({
    resolver,
    defaultValues: {
      kind: "",
      businessName: "",
      businessType: "",
      legalId: "",
      contactName: "",
      phone: "",
      city: "",
      addressLine: "",
      deliveryInstructions: "",
      deliveryArea: "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await submitOnboarding(values);
      // On success the action redirects and never returns.
      setFormError(result.error);
      for (const [field, key] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof FormFields, { type: "server", message: key });
      }
    });
  });

  const err = (name: keyof FormFields) => errors[name]?.message;
  const input = (name: keyof FormFields, hint?: string) => ({
    id: name,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": describedBy(name, err(name), hint),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      {formError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${formError}`)}
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium">{t("kindLegend")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <KindOption
            value="buyer"
            icon={Building2}
            title={t("kindBuyer")}
            hint={t("kindBuyerHint")}
            checked={kind === "buyer"}
            registration={register("kind")}
          />
          <KindOption
            value="supplier"
            icon={Truck}
            title={t("kindSupplier")}
            hint={t("kindSupplierHint")}
            checked={kind === "supplier"}
            registration={register("kind")}
          />
        </div>
        {err("kind") ? <p className="text-sm text-destructive">{t("kindRequired")}</p> : null}
      </fieldset>

      {kind ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              id="businessName"
              label={kind === "buyer" ? t("businessName") : t("supplierBusinessName")}
              error={err("businessName")}
            >
              <Input autoComplete="organization" {...input("businessName")} />
            </Field>
          </div>

          {kind === "buyer" ? (
            <Field id="businessType" label={t("businessType")} error={err("businessType")}>
              <Select {...input("businessType")}>
                <option value="">{t("businessTypePlaceholder")}</option>
                {BUYER_BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`businessTypes.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field id="legalId" label={t("legalId")} hint={t("legalIdHint")} error={err("legalId")} optional>
              <Input inputMode="numeric" {...input("legalId", t("legalIdHint"))} />
            </Field>
          )}

          <Field id="contactName" label={t("contactName")} error={err("contactName")}>
            <Input autoComplete="name" {...input("contactName")} />
          </Field>

          <Field id="phone" label={t("phone")} error={err("phone")}>
            <Input type="tel" autoComplete="tel" placeholder={t("phonePlaceholder")} {...input("phone")} />
          </Field>

          <Field id="city" label={t("city")} error={err("city")}>
            <Input autoComplete="address-level2" placeholder={t("cityPlaceholder")} {...input("city")} />
          </Field>

          {kind === "buyer" ? (
            <>
              <div className="sm:col-span-2">
                <Field id="addressLine" label={t("addressLine")} error={err("addressLine")}>
                  <Input autoComplete="street-address" {...input("addressLine")} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  id="deliveryInstructions"
                  label={t("deliveryInstructions")}
                  hint={t("deliveryInstructionsHint")}
                  error={err("deliveryInstructions")}
                  optional
                >
                  <Textarea rows={3} {...input("deliveryInstructions", t("deliveryInstructionsHint"))} />
                </Field>
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <Field
                id="deliveryArea"
                label={t("deliveryArea")}
                hint={t("deliveryAreaHint")}
                error={err("deliveryArea")}
              >
                <Input {...input("deliveryArea", t("deliveryAreaHint"))} />
              </Field>
            </div>
          )}

          <div className="sm:col-span-2">
            <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
              {pending ? t("submitting") : t("submit")}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function KindOption({
  value,
  icon: Icon,
  title,
  hint,
  checked,
  registration,
}: {
  value: "buyer" | "supplier";
  icon: typeof Building2;
  title: string;
  hint: string;
  checked: boolean;
  registration: ReturnType<ReturnType<typeof useForm<FormFields>>["register"]>;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-brand bg-brand-soft" : "border-border hover:bg-muted",
      )}
    >
      <input type="radio" value={value} className="sr-only" {...registration} />
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", checked ? "text-brand" : "text-muted-foreground")} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
