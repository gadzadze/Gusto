import { createTranslator } from "next-intl";
import messages from "../../../messages/ka.json";
import { formatMoney } from "@/lib/money";
import type { NotificationEvent } from "@/server/db/schema";

// Rendering for in-app titles and emails. Works outside a request (cron,
// tests), so it builds its own translator from the message file instead of
// using next-intl's request-scoped getTranslations().

type Messages = typeof messages;
const translator = createTranslator({ locale: "ka", messages: messages as Messages, namespace: "notifications" });
const t = translator as unknown as (key: string, values?: Record<string, string | number>) => string;

export type CounterpartyRole = "buyer" | "supplier";

/** The other side's role from the recipient's point of view. */
export function counterpartyRoleFor(recipientOrgType: "buyer" | "supplier"): CounterpartyRole {
  return recipientOrgType === "supplier" ? "buyer" : "supplier";
}

export function notificationTitle(event: NotificationEvent, orderNumber: number): string {
  return t(`event.${event}`, { number: orderRef(orderNumber) });
}

export function counterpartyLine(role: CounterpartyRole, name: string): string {
  return t(`counterparty.${role}`, { name });
}

export function orderRef(number: number): string {
  return `GST-${number}`;
}

/** Everything an email needs, all taken from the persisted order. */
export type OrderEmailData = {
  event: NotificationEvent;
  orderNumber: number;
  counterpartyName: string;
  counterpartyRole: CounterpartyRole;
  itemCount: number;
  totalMinor: number;
  currency: string;
  link: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOrderEmail(data: OrderEmailData): RenderedEmail {
  const number = orderRef(data.orderNumber);
  const subject = t(`event.${data.event}`, { number });
  const intro = t(`email.intro.${data.event}`);
  const lines = [
    t("email.order", { number }),
    counterpartyLine(data.counterpartyRole, data.counterpartyName),
    t("email.items", { count: data.itemCount }),
    t("email.total", { total: formatMoney(data.totalMinor, data.currency) }),
  ];
  const open = t("email.open", { link: data.link });
  const footer = t("email.footer");

  const text = [intro, "", ...lines, "", open, "", "-", footer].join("\n");
  const html = `<!doctype html>
<html lang="ka"><body style="margin:0;padding:24px;background:#ffffff;color:#0b0b0c;font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px;font-size:17px;font-weight:600">${escapeHtml(subject)}</p>
<p style="margin:0 0 16px">${escapeHtml(intro)}</p>
<p style="margin:0 0 20px">${lines.map(escapeHtml).join("<br>")}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(data.link)}" style="display:inline-block;padding:10px 18px;background:#0b0b0c;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(t("email.openLabel"))}</a></p>
<p style="margin:0;color:#57534e;font-size:13px">${escapeHtml(footer)}</p>
</body></html>`;
  return { subject, text, html };
}
