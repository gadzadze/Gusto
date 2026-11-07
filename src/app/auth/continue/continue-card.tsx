"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ContinueCard({ valid, tokenHash, type }: { valid: boolean; tokenHash: string; type: string }) {
  const t = useTranslations("authContinue");
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{valid ? t("body") : t("invalid")}</CardDescription>
      </CardHeader>
      <CardContent>
        {valid ? (
          // A real form POST: the token is only used when a person presses the button.
          <form method="POST" action="/auth/confirm">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <Button type="submit" className="w-full">
              {t("button")}
            </Button>
          </form>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">{t("toLogin")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
