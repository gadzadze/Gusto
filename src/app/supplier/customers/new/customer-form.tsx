"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { describedBy, Field } from "@/components/forms/field";
import { InvitePanel } from "@/components/customers/invite-panel";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { zodFormResolver } from "@/lib/validation/form-resolver";
import { customerSchema } from "@/lib/validation/customer";
import { createCustomerAction, type InviteLinks } from "../actions";

type Fields = { businessName: string; contactName: string; phone: string; email: string; priceListId: string };
const resolver = zodFormResolver<Fields>(customerSchema);

export function CustomerForm({
  priceLists,
  defaultPriceListId,
}: {
  priceLists: { id: string; name: string }[];
  defaultPriceListId: string;
}) {
  const t = useTranslations("customers");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<InviteLinks | null>(null);
  const defaultValues: Fields = { businessName: "", contactName: "", phone: "", email: "", priceListId: defaultPriceListId };
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    reset,
    formState: { errors },
  } = useForm<Fields>({ resolver, defaultValues });

  if (links) {
    return (
      <div className="space-y-4">
        <InvitePanel links={links} />
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/supplier/customers/${links.customerId}`}>{t("invite.toCustomer")}</Link>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              reset(defaultValues);
              setLinks(null);
            }}
          >
            {t("invite.another")}
          </Button>
        </div>
      </div>
    );
  }

  const onSubmit = handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await createCustomerAction(values);
      if (result.ok) return setLinks(result.links);
      setError(t(`errors.${result.error}`));
      for (const [field, key] of Object.entries(result.fieldErrors ?? {}) as [string, string][]) {
        setFieldError(field as keyof Fields, { type: "server", message: key });
      }
    });
  });

  const err = (name: keyof Fields) => errors[name]?.message;
  const input = (name: keyof Fields, hint?: string) => ({
    id: name,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": describedBy(name, err(name), hint),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-5">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Field id="businessName" label={t("form.businessName")} error={err("businessName")}>
        <Input autoComplete="organization" {...input("businessName")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contactName" label={t("form.contactName")} error={err("contactName")} optional>
          <Input autoComplete="name" {...input("contactName")} />
        </Field>
        <Field id="phone" label={t("form.phone")} error={err("phone")}>
          <Input type="tel" autoComplete="tel" {...input("phone")} />
        </Field>
        <Field id="email" label={t("form.email")} error={err("email")} optional>
          <Input type="email" autoComplete="email" {...input("email")} />
        </Field>
        <Field id="priceListId" label={t("form.priceList")} hint={t("form.priceListHint")} error={err("priceListId")}>
          <Select {...input("priceListId", t("form.priceListHint"))}>
            <option value="">{t("basePrices")}</option>
            {priceLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {t("form.submit")}
      </Button>
    </form>
  );
}
