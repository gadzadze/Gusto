"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitLogin, type MagicLinkState } from "./actions";

export type LoginError = "auth" | "not_allowed" | null;

export function LoginForm({ next, error, contactEmail }: { next: string | null; error: LoginError; contactEmail: string | null }) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(submitLogin, {
    status: "idle",
  });
  const [retrying, setRetrying] = useState(false);
  // Controlled so a failed attempt (React clears uncontrolled fields) keeps the address.
  const [email, setEmail] = useState("");

  const redirectTo = state.status === "redirect" ? state.to : null;
  useEffect(() => {
    if (redirectTo) window.location.assign(redirectTo);
  }, [redirectTo]);
  if (redirectTo) return <p className="text-center text-sm text-muted-foreground" aria-live="polite">{t("signingIn")}</p>;

  if (state.status === "sent" && !retrying) {
    return (
      <div className="space-y-4 text-center" aria-live="polite">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Mail aria-hidden className="size-5" />
        </div>
        <h2 className="font-semibold">{t("sentTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("sentBody", { email: state.email })}</p>
        <Button variant="link" onClick={() => setRetrying(true)}>
          {t("useAnotherEmail")}
        </Button>
      </div>
    );
  }

  const errorKey = state.status === "error" ? state.error : error;

  return (
    <div className="space-y-5">
      {errorKey ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`errors.${errorKey}`)}
          {errorKey === "not_allowed" && contactEmail ? (
            <>
              {" "}
              {t("notAllowedContact")}{" "}
              <a href={`mailto:${contactEmail}`} className="font-medium underline">{contactEmail}</a>
            </>
          ) : null}
        </p>
      ) : null}

      <form action={(formData) => { setRetrying(false); formAction(formData); }} className="space-y-3">
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" />
        </div>
        <Button type="submit" name="intent" value="password" className="w-full" disabled={pending}>
          {pending ? t("signingIn") : t("signIn")}
        </Button>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Button type="submit" name="intent" value="reset" variant="link" className="h-auto p-0" disabled={pending}>
            {t("forgot")}
          </Button>
        </div>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t("supplierPrompt")}{" "}
        <Link href="/suppliers" className="text-brand underline-offset-2 hover:underline">
          {t("supplierLink")}
        </Link>
      </p>
    </div>
  );
}
