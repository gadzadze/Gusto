"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * When someone taps a push notification while 202 is already open, the service worker brings the window to the front
 * and sends this message with the page to show (browsers differ in whether the worker can navigate the window itself;
 * an iPhone web app often cannot). Only an internal path is followed.
 */
export function PushNavigation() {
  const router = useRouter();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type !== "202:navigate" || typeof data.url !== "string") return;
      if (!data.url.startsWith("/") || data.url.startsWith("//") || data.url.includes("\\")) return;
      router.push(data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages?.(); // messages that arrived before this listener existed are delivered now
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
