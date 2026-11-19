"use client";

import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { deletePushSubscriptionAction, pushSubscriptionStatusAction, savePushSubscriptionAction, sendTestPushAction } from "@/app/push/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

type State = "checking" | "unsupported" | "ios_install" | "denied" | "off" | "on";

/** The browser wants the VAPID public key as bytes, not as base64url text. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Turning Web Push on for this browser: registers the service worker, asks for permission when the person taps
 * (browsers refuse to ask any other way), subscribes with the server's public key and tells the server. `nudge`
 * is the short, dismissible version for the supplier's home; the full one lives with the notification settings.
 */
export function PushSettings({ publicKey, variant = "card" }: { publicKey: string; variant?: "card" | "nudge" }) {
  const t = useTranslations("push");
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await Promise.resolve(); // keep every state update below out of the effect's synchronous part
      let next: State = "off";
      try {
        if (!supported()) next = isIos() ? "ios_install" : "unsupported";
        else if (Notification.permission === "denied") next = "denied";
        else {
          const registration = await navigator.serviceWorker.getRegistration("/");
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription && (await pushSubscriptionStatusAction(subscription.endpoint))) next = "on";
        }
        if (variant === "nudge" && window.localStorage.getItem("push-nudge-dismissed") === "1") setDismissed(true);
      } catch {
        next = "off";
      }
      if (!cancelled) setState(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [variant]);

  const enable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
        const result = await savePushSubscriptionAction(subscription.toJSON());
        if (!result.ok) {
          await subscription.unsubscribe();
          setMessage({ tone: "error", text: result.error === "too_many" ? t("tooMany") : result.error === "not_configured" ? t("notConfigured") : t("error") });
          return;
        }
        setState("on");
      } catch {
        setMessage({ tone: "error", text: t("error") });
      }
    });

  const disable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await deletePushSubscriptionAction(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setState("off");
      } catch {
        setMessage({ tone: "error", text: t("error") });
      }
    });

  const test = () =>
    startTransition(async () => {
      const result = await sendTestPushAction();
      setMessage(result.ok ? { tone: "success", text: t("testSent") } : { tone: "error", text: t("testFailed") });
    });

  if (state === "checking") return null;
  // The nudge only invites people who could turn it on; once it is on, unsupported or dismissed it disappears.
  if (variant === "nudge" && (dismissed || state === "on" || state === "unsupported")) return null;

  const body =
    state === "on" ? (
      <p className="text-sm font-medium text-green-700 dark:text-green-400">{t("on")}</p>
    ) : state === "denied" ? (
      <p className="text-sm text-muted-foreground">{t("denied")}</p>
    ) : state === "unsupported" ? (
      <p className="text-sm text-muted-foreground">{t("unsupported")}</p>
    ) : state === "ios_install" ? (
      <p className="text-sm text-muted-foreground">{t("iosInstall")}</p>
    ) : null;

  return (
    <section className={variant === "nudge" ? "rounded-xl border border-border bg-surface-2 p-4" : "space-y-3 border-t border-border pt-6"} aria-labelledby={`push-title-${variant}`}>
      <div className="flex items-start gap-3">
        <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={`push-title-${variant}`} className="font-semibold">{variant === "nudge" ? t("nudgeTitle") : t("title")}</h2>
          <p className="text-sm text-muted-foreground">{variant === "nudge" ? t("nudgeBody") : t("hint")}</p>
          {body}
        </div>
      </div>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <div className="flex flex-wrap gap-2 pl-8">
        {state === "off" ? (
          <Button type="button" size="sm" disabled={pending} onClick={enable}>{t("enable")}</Button>
        ) : null}
        {state === "on" ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={test}>{t("test")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={disable}>{t("disable")}</Button>
          </>
        ) : null}
        {variant === "nudge" && state !== "on" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              try {
                window.localStorage.setItem("push-nudge-dismissed", "1");
              } catch {
                /* private mode: it just comes back next time */
              }
              setDismissed(true);
            }}
          >
            {t("nudgeLater")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
