# Milestone 5 — Notifications

Read `CLAUDE.md` fully before starting. Milestones 1–4 are merged.

## Goal

The right people learn about order events quickly and reliably, without a
notification failure ever affecting an order. WhatsApp is supported honestly:
as a user-sent message, not an automated one.

## Build

1. **Schema.** `notifications` (in-app) and `notification_deliveries` (the
   outbox), per `CLAUDE.md`. `dedupe_key` is unique, e.g.
   `order:{id}:status:{status}:email:{userId}`.
2. **Events.**
   - `src/server/notifications/events.ts` maps domain events to recipients
     and channels:
     - `order.submitted` → all supplier members;
     - `order.confirmed` / `rejected` / `cancelled` / `delivered` → all buyer
       members, except the actor;
     - `invitation.created` → the invitee email, if one was given.
   - Event rows are written **inside the same transaction** as the change that
     caused them (the hook point left in milestone 4). If the transaction
     rolls back, no notification exists.
3. **In-app notifications.**
   - Bell with unread count in the header, a list page, mark read and mark all
     read.
   - Clicking one opens the order.
4. **Email** via Resend.
   - Georgian templates from `messages/ka.json`: simple HTML plus a plain-text
     part.
   - Every value comes from the persisted order: number, buyer or supplier
     name, item count, total with currency, and a link to `/o/[number]`. No
     example values anywhere.
   - With no `RESEND_API_KEY`, log `[DEV EMAIL]` and mark the delivery
     `skipped`.
   - Also configure Supabase Auth to send magic links through Resend SMTP.
     Document it in README; it's a dashboard setting, not code.
5. **Delivery processing.**
   - After commit, use Next.js `after()` to attempt pending deliveries for
     that event immediately.
   - `/api/cron/notifications` (Bearer `CRON_SECRET`) drains due rows:
     - claim them with `FOR UPDATE SKIP LOCKED`, in batches of 50;
     - retry with backoff of 1, 5, 15 and 60 minutes, then `failed`;
     - store `last_error`, but never log tokens or full message bodies.
   - Schedule the cron with **Supabase Cron** (`pg_cron` + `pg_net`) every
     minute. Vercel Hobby cron is too infrequent. Ship the schedule SQL as a
     migration whose URL and secret come from Supabase Vault, not from the
     repo. Document it.
6. **WhatsApp share buttons.** The `wa.me` builder from milestone 3, now used
   on orders:
   - After a buyer submits: "Send to supplier on WhatsApp", to the supplier's
     contact phone, with a prefilled Georgian message (order number, buyer
     name, item count, total, link).
   - On the supplier's order page, after confirm or reject: "Tell the buyer on
     WhatsApp".
   - The button opens WhatsApp. Gusto records nothing as delivered, and the
     UI copy says "send", not "sent".
7. **Notification preferences** (minimal).
   - Per user: email on or off, per event group (new orders / order updates).
   - In-app is always on.
8. **WhatsApp Business API seam.**
   - `src/server/notifications/channels/` exposes a `Channel` interface that
     the email and in-app channels implement.
   - Add a short `docs/whatsapp-business-api.md` covering what a future
     `whatsapp` channel needs: Meta Business verification, approved utility
     templates in Georgian, recipient opt-in capture, per-message cost, and
     webhook delivery statuses.
   - **Do not implement it.**

## Out of scope

Automated WhatsApp sending, SMS, web push, digest emails.

## Tests

- **Unit:**
  - the event → recipients/channels mapping;
  - template rendering uses real order values and correct currency
    formatting;
  - backoff schedule.
- **Integration:**
  - an order submit creates exactly the expected outbox rows;
  - a rolled-back submit creates none;
  - running the drain twice sends once (dedupe and claiming);
  - a channel that throws marks the row for retry, and the order is untouched;
  - the cron route returns 401 without the secret;
  - a user from another org never receives the notification.
- **E2E:** buyer submits → supplier sees an unread notification and opens the
  order from it. Email is in dev-log mode in tests.

## Done when

- For a committed order:
  - the event is generated in the same transaction;
  - delivery is attempted, or the dev fallback is clearly labelled;
  - the link points to the real order;
  - reprocessing creates no duplicates;
  - failure leaves the order intact.
- CI is green.
