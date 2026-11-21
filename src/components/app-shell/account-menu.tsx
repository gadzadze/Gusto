"use client";

import { CircleUserRound, KeyRound, LogOut, Settings, ShieldCheck, UserCog } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import type { Area } from "./nav";

/**
 * The phone header's one account button: team, change password and sign out used to be three icons side by side
 * (and squeezed the company name to a few letters); now they open from this single menu. It uses the browser's
 * Popover API (top layer, light dismiss, Escape), like the Select.
 */
export function AccountMenu({ area, email, showAdminLink }: { area: Area; email: string | null; showAdminLink?: boolean }) {
  const t = useTranslations("nav");
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const close = () => menu.current?.hidePopover?.();
  const item = "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm hover:bg-muted";
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={t("account")}
        title={t("account")}
        className="inline-flex size-11 items-center justify-center text-muted-foreground"
      >
        <CircleUserRound aria-hidden className="size-5" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="fixed inset-auto right-3 top-14 m-0 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-surface p-2 text-foreground shadow-lg"
      >
        {email ? <p className="truncate px-3 py-2 text-xs text-muted-foreground" title={email}>{email}</p> : null}
        {showAdminLink && area !== "admin" ? (
          <Link href="/admin" onClick={close} className={item}>
            <ShieldCheck aria-hidden className="size-4" />
            {t("admin")}
          </Link>
        ) : null}
        {area === "supplier" ? (
          <Link href="/supplier/settings" onClick={close} className={item}>
            <Settings aria-hidden className="size-4" />
            {t("settings")}
          </Link>
        ) : null}
        {area !== "admin" ? (
          <Link href={`/${area}/team`} onClick={close} className={item}>
            <UserCog aria-hidden className="size-4" />
            {t("team")}
          </Link>
        ) : null}
        <Link href="/account/password" onClick={close} className={item}>
          <KeyRound aria-hidden className="size-4" />
          {t("changePassword")}
        </Link>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className={item}>
            <LogOut aria-hidden className="size-4" />
            {t("signOut")}
          </button>
        </form>
      </div>
    </>
  );
}
