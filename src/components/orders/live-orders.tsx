"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { StatusToast } from "@/components/ui/status-toast";

const VISIBLE_MS = 20_000;
const HIDDEN_MS = 60_000;
const MAX_FAILURES = 3;

/**
 * Keeps an open supplier page current: it asks /api/supplier/pulse every 20 s (60 s in a background tab,
 * and at once when the tab comes back), and when the waiting queue changed it re-renders the page with
 * router.refresh(). A refresh is never forced while a dialog is open, so a half-finished review is not
 * disturbed; the next poll applies it. A new order also shows a notice (kept until closed) and, in a background tab,
 * the waiting count in the tab title. Renders nothing otherwise.
 */
export function LiveOrders({ signature, pending }: { signature: string; pending: number }) {
  const t = useTranslations("orders.live");
  const router = useRouter();
  const seen = useRef(signature);
  const seenPending = useRef(pending);
  const baseTitle = useRef<string | null>(null);
  const [notice, setNotice] = useState(false);

  // The page re-rendered with fresh data: that is the new baseline.
  useEffect(() => {
    seen.current = signature;
    seenPending.current = pending;
  }, [signature, pending]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const setTitle = (count: number) => {
      if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\)\s/, "");
      document.title = count > 0 && document.hidden ? `(${count}) ${baseTitle.current}` : baseTitle.current;
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/supplier/pulse", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("pulse");
        const data = (await res.json()) as { pending: number; signature: string };
        failures = 0;
        if (data.signature !== seen.current && !document.querySelector("dialog[open]")) {
          if (data.pending > seenPending.current) {
            setNotice(true); // stays until the person closes it
          }
          seen.current = data.signature;
          seenPending.current = data.pending;
          router.refresh();
        }
        setTitle(data.pending);
      } catch {
        failures += 1; // signed out, offline, or the server is struggling: back off, then stop
      }
      if (!stopped && failures < MAX_FAILURES) timer = setTimeout(poll, document.hidden ? HIDDEN_MS : VISIBLE_MS);
    };

    const onVisible = () => {
      if (document.hidden) {
        setTitle(seenPending.current);
        return;
      }
      if (baseTitle.current !== null) document.title = baseTitle.current;
      clearTimeout(timer);
      failures = 0;
      void poll();
    };

    timer = setTimeout(poll, VISIBLE_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, [router]);

  if (!notice) return null;
  return (
    <StatusToast icon={<BellRing className="size-4 shrink-0 text-brand" aria-hidden />} onDismiss={() => setNotice(false)}>
      {t("newOrder")}
    </StatusToast>
  );
}
