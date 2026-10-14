import { Bell, CheckCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { markAllReadAction, openNotificationAction } from "@/app/notifications/actions";
import { Pagination } from "@/components/app-shell/pagination";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { counterpartyLine, counterpartyRoleFor, notificationTitle } from "@/lib/notifications/templates";
import { cn } from "@/lib/utils";
import { getPreferences, listNotifications } from "@/server/notifications/queries";
import { PreferencesForm } from "./preferences-form";

/** The list page body, shared by the buyer and supplier areas. */
export async function NotificationsView({
  userId,
  area,
  page,
}: {
  userId: string;
  area: "buyer" | "supplier";
  page: number;
}) {
  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const [list, preferences] = await Promise.all([listNotifications(userId, page), getPreferences(userId)]);
  const hasUnread = list.items.some((n) => !n.readAt);
  const role = counterpartyRoleFor(area);

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-4">
        {hasUnread ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              <CheckCheck />
              {t("markAllRead")}
            </Button>
          </form>
        ) : null}
        {list.items.length === 0 ? (
          <EmptyState icon={Bell} title={t("empty")} />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {list.items.map((n) => (
                <li key={n.id}>
                  <form action={openNotificationAction.bind(null, n.id)}>
                    <button
                      type="submit"
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50",
                        !n.readAt && "bg-brand-soft",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", !n.readAt && "font-semibold")}>
                          {notificationTitle(n.event, n.orderNumber)}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {counterpartyLine(role, n.counterpartyName)} ·{" "}
                          {format.dateTime(n.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      </span>
                      {!n.readAt ? <span className="sr-only">{t("unread")}</span> : null}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <Pagination basePath={`/${area}/notifications`} params={{}} page={list.page} pageCount={list.pageCount} />
          </>
        )}
      </section>
      <PreferencesForm initial={preferences} />
    </div>
  );
}
