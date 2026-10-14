"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { setProductActiveAction } from "@/app/supplier/products/actions";

export function ProductActiveToggle({
  productId,
  isActive,
  disabled,
}: {
  productId: string;
  isActive: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("products");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div className="space-y-2">
      {error ? <FormAlert tone="error">{t("errors.unknown")}</FormAlert> : null}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setProductActiveAction(productId, !isActive);
            setError(!result.ok);
          })
        }
      >
        {isActive ? <EyeOff /> : <Eye />}
        {isActive ? t("form.deactivate") : t("form.activate")}
      </Button>
      <p className="text-sm text-muted-foreground">{t("form.deactivateHint")}</p>
    </div>
  );
}
