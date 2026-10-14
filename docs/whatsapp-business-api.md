# WhatsApp Business API (not implemented)

Gusto does **not** send WhatsApp messages. Today WhatsApp is a "send on
WhatsApp" button that opens `wa.me` with a prefilled Georgian message; the
person presses send, and Gusto records nothing as delivered (see
`CLAUDE.md`, "Product honesty rules").

This note lists what an automated channel would need, so the decision after
the pilot is informed. Nothing here is built.

## Where it would plug in

`src/server/notifications/channels/` defines the `Channel` interface that the
in-app and email channels implement:

- `enqueue(tx, draft)` writes rows inside the transaction that caused the
  event.
- `send(delivery)` is called later by the outbox processor
  (`server/notifications/process.ts`) and throws to request a retry.

A `whatsapp` channel would implement the same two methods, add `whatsapp` to
the `delivery_channel` enum (a migration), and be added to the list in
`channels/index.ts`. Retry/backoff, the cron drain and dedupe keys
(`order:{id}:status:{status}:whatsapp:{userId}`) work unchanged.

## What it needs first

1. **Meta Business verification.** A verified Meta Business account and a
   WhatsApp Business Account (WABA), with a phone number registered to the
   Cloud API (it can no longer be used in the regular WhatsApp app). Business
   verification takes days to weeks and needs company documents.
2. **Approved message templates, in Georgian.** Outside the 24-hour customer
   service window, a business can only send pre-approved templates. Order
   events are *utility* templates ("order {{1}} confirmed, total {{2}}, link
   {{3}}"). Each template and language is submitted to Meta and can be
   rejected. Template text lives in `messages/ka.json` today and would need a
   one-to-one mapping to approved template names and variables.
3. **Recipient opt-in.** Meta requires users to have opted in to receive
   messages from the business. Capture it explicitly (a checkbox with the
   phone number, stored with a timestamp and the wording shown) in
   preferences or at invitation acceptance. Without a stored opt-in the channel
   must not send. A supplier typing a customer's number is not consent.
4. **Per-message cost.** Meta charges per delivered template message, priced by
   category and by the recipient's country. Georgia's rate and the current
   free allowances should be checked on Meta's pricing page before committing.
   Gusto's core is free for both sides, so decide who pays (Gusto, or an
   opt-in paid tier) before turning it on.
5. **Webhook delivery statuses.** Meta posts `sent` / `delivered` / `read` /
   `failed` events to a webhook. A route handler (signature-verified with the
   app secret) would update the delivery row by the message id returned at
   send time. Add `provider_message_id` and a `delivered` status to
   `notification_deliveries` at that point. Only then may the UI say a message
   was delivered, and only for this channel; `wa.me` links stay "send".
6. **Operations.** An access token (system user) kept as a server secret,
   quality-rating monitoring (too many blocks lowers the sending limit), and
   a fallback to email or in-app when a number is not on WhatsApp.
