import { Bell } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { countUnread } from "@/server/notifications/queries";

/** Header bell with the unread count. Async: render inside <Suspense>. */
export async function NotificationBell({ userId, area }: { userId: string; area: "buyer" | "supplier" }) {
  const t = await getTranslations("notifications");
  const unread = await countUnread(userId);
  const label = unread > 0 ? t("bellUnread", { count: unread }) : t("bell");
  return (
    <Link
      href={`/${area}/notifications`}
      aria-label={label}
      title={label}
      className="relative inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
    >
      <Bell aria-hidden className="size-5" />
      {unread > 0 ? (
        <span
          data-testid="unread-count"
          className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-5 text-white tabular-nums"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

export function NotificationBellFallback() {
  return <span aria-hidden className="inline-block size-11" />;
}
