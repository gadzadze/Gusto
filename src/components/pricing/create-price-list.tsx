"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { createPriceListAction } from "@/app/supplier/pricing/actions";

export function CreatePriceList({ disabled }: { disabled: boolean }) {
  const t = useTranslations("pricing");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="max-w-xl space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createPriceListAction(name);
          // Success redirects to the new list.
          if (!result.ok) setError(t(`errors.${result.error as "unknown"}`));
        });
      }}
    >
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <div className="flex gap-2">
        <Input aria-label={t("newPlaceholder")} placeholder={t("newPlaceholder")} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={pending || disabled}>
          <Plus />
          {t("create")}
        </Button>
      </div>
    </form>
  );
}
