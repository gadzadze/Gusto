"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN } from "@/lib/validation/password";
import { savePassword, type PasswordState } from "./actions";

export function PasswordForm({ first }: { first: boolean }) {
  const t = useTranslations("password");
  const [state, action, pending] = useActionState<PasswordState, FormData>(savePassword, { error: null });
  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">{t("new")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-muted-foreground">{t("hint", { min: PASSWORD_MIN })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
        {pending ? t("saving") : first ? t("submitFirst") : t("submitChange")}
      </Button>
    </form>
  );
}
