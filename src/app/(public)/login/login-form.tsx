"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "./actions";

export type LoginError = "auth" | "not_allowed" | null;

export function LoginForm({ next, error }: { next: string | null; error: LoginError }) {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, {
    status: "idle",
  });
  const [retrying, setRetrying] = useState(false);

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
        </p>
      ) : null}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Button type="submit" variant="outline" className="w-full">
          <GoogleIcon />
          {t("google")}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>

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
            required
            placeholder={t("emailPlaceholder")}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("sending") : t("sendLink")}
        </Button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}
