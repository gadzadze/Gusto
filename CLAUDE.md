# 202 (formerly Gusto)

B2B ordering for HoReCa in Georgia. Suppliers (distributors, importers,
producers) put their catalog and their **existing** customers on 202; those
customers (restaurants, cafés, hotels) reorder in a few taps instead of over
WhatsApp and phone calls.

The core is free for both sides. There are no payments, no commissions and no
delivery logistics: an order is a purchase request, and the buyer and supplier
settle it the way they already do.

The build plan lives in [`docs/milestones/`](docs/milestones/README.md). Each
milestone is a self-contained prompt. Do them in order, one per session.

## The MVP, and why it is this small

Pilot: **Tbilisi, one product category, 3–5 distributors and their existing
customers.** Georgian UI by default, with English as a second language (landing and app, 2026-11-07). Web app, mobile-first. The pilot succeeds if,
after 6 weeks, at least one supplier receives ≥30% of their orders through
202 and buyers reorder weekly without being reminded. Every scope decision
serves that test.

Go-to-market is **supplier-led**: a supplier invites the buyers it already
serves. Buyers do not browse an open marketplace and cannot see a supplier
they are not connected to. This is deliberate. Distributors will not publish
prices openly, and an empty marketplace convinces nobody.

### In scope

- **Supplier:** sign-up and admin approval. Catalog with Excel/CSV import and
  per-customer assortment and prices (a list says which products a
  customer may order, and at what price). Customer invites. Order inbox with
  confirm (quantities adjustable, delivery day agreed) / reject / delivered.
  Optional stock count per product (supplier-only), a per-customer history and
  private note, and a printable pick list per delivery day.
- **Buyer:** join from an invite, a catalog showing their own prices, one cart
  per supplier, checkout (with an optional wanted delivery day), order tracking,
  one-tap reorder, and regular orders (saved reorders with a weekday reminder).
- **Notifications:** in-app and email, plus a user-clicked `wa.me` "send on
  WhatsApp" button.
- **Admin:** approve or suspend suppliers, manage categories, look up orders,
  audit log.

### Out of scope — do not build without asking

- Ads, sponsored placements and campaigns. No tables, no UI. Design so they
  *can* be added later, nothing more.
- An open marketplace or public supplier discovery.
- Online payments, commissions, invoicing, credit/debt tracking.
- RS.ge e-waybills, accounting/ERP sync, AI parsing of WhatsApp orders. These
  are v2 candidates, to be chosen from what pilot suppliers actually ask for.
- Automated WhatsApp Business API messages. They need Meta approval, paid
  templates and recipient opt-in; that comes after the pilot.
- Order statuses beyond the five below, product substitutions, the
  "changes requested" flow, analytics charts, a third language, native apps.
  (Regular orders, decided 2026-11-04, are the one kind of saved list that
  exists: a reminder plus a one-tap cart fill. They never create an order by
  themselves.)

## Product honesty rules

- **No fake data in the product.** No hardcoded businesses, orders, metrics or
  "trusted by" logos. Empty states instead.
- **Seed data is dev-only**, clearly fictional (names prefixed `[DEMO]`), and
  the seed script refuses to run against a non-local database.
- **Never call a `wa.me` link a delivered notification.** The UI says "send on
  WhatsApp"; the user sends it. Nothing in the database records it as
  delivered.
- **No verification badges** except `supplier.status = active`, which means an
  admin approved it. Label it as exactly that.
- **Order value is not revenue.** 202 never knows whether an order was paid.
  Analytics say "order value", never "revenue" or "sales".

## Stack

| Concern | Choice |
|---|---|
| App | One Next.js 16 app (App Router, TypeScript strict), npm |
| UI | Tailwind CSS v4, shadcn/ui, lucide-react |
| Auth | Supabase Auth via `@supabase/ssr`: email + password, emailed one-time link (no Google sign-in; removed 2026-11-10) |
| Database | Supabase Postgres (region `eu-west-1`, Ireland) |
| Data access | Drizzle ORM + `postgres` driver, **server-only** |
| Migrations | Drizzle Kit, SQL files committed under `drizzle/` |
| File storage | Supabase Storage, `product-images` bucket |
| Email | Resend (transactional email + SMTP for Supabase auth emails) |
| Error monitoring | Sentry (`@sentry/nextjs`): errors only, scrubbed, off without a DSN |
| Background work | Notification outbox table, drained by a cron-triggered route |
| Validation | Zod at every server boundary |
| i18n | `next-intl`, messages in `messages/ka.json` (default) and `messages/en.json`; the language is the `gusto-locale` cookie |
| Tests | Vitest (unit + integration), Playwright (e2e) |
| Hosting | Vercel (region `dub1`, Dublin: next to the database), deployed from `main` by Vercel's Git integration |

There is **no separate backend service**. 202 has no long-lived sockets or
heavy jobs, so Server Components, Server Actions and a few Route Handlers
cover everything.

Do not add a second library for a job already covered above (no Prisma, no
second form library, no second icon set, no state-management library unless a
real need appears).

## Security model — read before touching data access

**Authorization lives in the app, in one place.**

1. The browser never talks to the database or to Supabase. There is no
   browser Supabase client: sign-in runs in Server Actions
   (`src/app/(public)/login/actions.ts`), and the session lives in
   httpOnly cookies managed by `@supabase/ssr`.
2. All database access goes through Drizzle on the server, connected as the
   database owner. That connection **bypasses Row Level Security**, so RLS is
   not what protects tenants: the app layer is.
3. RLS is still **enabled with zero policies on every table in `public`**, so
   Supabase's auto-generated Data API (PostgREST) cannot read or write
   anything even if the anon key leaks. A test asserts this for every table.
   Any new table's migration must enable RLS.
4. Every Server Action / Route Handler / data-loading function starts with a
   guard from `src/server/auth/guards.ts`: `requireUser()`, `requireBuyer()`,
   `requireSupplier()`, `requireAdmin()`. The guard returns a context
   `{ userId, orgId, orgType, role }`.
5. **Tenant scope comes from the context, never from input.** Domain functions
   take `ctx` as their first argument and filter every tenant-owned query by
   `ctx.orgId`. An `orgId`, `supplierId` or `buyerId` arriving in a request
   body or URL is used only to look something up *within* that scope.
6. Fetching another tenant's object returns **404, not 403**, so IDs cannot be
   probed.
7. Roles are never accepted from the client. Org type is fixed when the org is
   created; platform admin is granted only by `npm run admin:grant`.
8. Server-only modules import `server-only`. `SUPABASE_SERVICE_ROLE_KEY` is
   never referenced outside `src/server/`.
9. Server Actions rely on Next.js's built-in Origin check. The cron Route
   Handler requires `Authorization: Bearer $CRON_SECRET`.
10. Never log tokens, magic links, invite URLs, cookies or full request
    bodies.
11. **Sign-in is closed until the admin accepts the business.** Nobody registers
    themselves, and nobody gets a sign-in link or an account first. An address
    may get a link only if it is on `allowed_emails` and not revoked
    (`server/auth/allow-list.ts`, `isEmailAllowed`: that is the whole rule).
    **An invitation does not open the door**, neither its link nor an invitation
    addressed to an email: it only connects a buyer to a supplier after the buyer
    has signed in (decided 2026-11-03, so unaccepted people never become junk
    accounts). Supabase sign-ups are switched off, so the
    app creates auth users itself (`server/supabase/admin.ts`) for allowed
    addresses only. `completeSignIn` re-checks and signs out anyone not
    allowed. A revoked row stays blocked.
    The admin adds every business, buyers included, at `/admin/access` (ideally
    with business name + legal ID, which also makes the organization start
    `active`); scripts use
    `npm run user:allow`. Being allowed gives no role, but the admin may pin
    `allowed_emails.intended_role` (`buyer`, `supplier` or `both`; text with a check constraint, since
    the org-type enum can't hold `both`): onboarding then offers only that kind and
    `submitOnboarding` / the invite action refuse the other (`wrong_role`). **`both`** is a business
    that buys and resells: the form has no choice and creates both sides at once (active when the
    address carries a vetted legal ID); a `both` address can also add either side later. Its legal
    ID clashes with a `buyer` or `supplier` row for the same ID, since it uses the ID on both kinds.
12. **Partners use their own company address and their own password.** Nobody
    creates accounts or passwords for them. The first sign-in is the emailed link
    (proof they control the mailbox). **The link is sent automatically when the
    business is accepted** (`server/auth/welcome-email.ts`: admin adds or restores an
    address, bulk add, or approves a supplier request; re-adding an already allowed
    address sends nothing). It is generated with `signInLinkFor` (our own
    `/auth/confirm` URL), sent directly (never through the outbox, never stored or
    logged), and the admin screens say sent / not sent (no email provider
    configured) / failed. A lost or expired link is replaced from the sign-in page
    ("set or reset password", the `reset` intent, which lands on `/account/password`);
    there is no separate "first sign-in" button. **Until an email provider is connected the
    admin can hand the link over by hand**: "ბმულის შექმნა" on a row of `/admin/access`
    (`domain/admin/access-link.ts`, 30/h per admin) makes the same one-time link, shows it once
    with a WhatsApp button (the number of the address's supplier request if there is one,
    otherwise WhatsApp asks who to send to) and a copy button. It is never stored or logged;
    `access.link_created` is audited. Whoever opens it first gets in, so it is admin-only and
    for the right person only. This is the one place a person's sign-in link is shown to anyone.
    **Links 202 makes point at `/auth/continue`, not `/auth/confirm`**: that page only shows a
    "continue" button which POSTs the token to `/auth/confirm`. A plain GET to `/auth/confirm`
    verifies at once, so a WhatsApp or mail link preview that merely fetches the URL used up the
    one-time token before the person opened it (seen in production, 2026-11-05). GET stays for
    the Supabase email templates and the e2e helpers. Link lifetime is Supabase's email OTP
    expiry (Auth settings). Until `profiles.password_set_at` is set,
    every guard sends them to `/account/password` (`decideAccess` →
    `set_password`). After that: email + password (`submitLogin`), "forgot" =
    the same link landing on `/account/password`, change in the shell. The
    emailed link stays as the fallback. Passwords go straight to Supabase Auth
    (`auth.updateUser`), min 10 characters (`lib/validation/password.ts`,
    `supabase/config.toml`), and are never stored, logged or audited.
13. **The admin vets who is real.** The legal ID (9 digits company / 11 sole
    trader, `lib/legal-id.ts`; format only, the registry lookup is manual) is
    required for both kinds and unique per kind. Two paths:
    - *Pre-registered*: the admin adds the address with business name + legal ID
      (Access page / `user:allow --name --legal-id`). That ID is authoritative
      (`registrationFor`, shown read-only at onboarding) and the organization
      starts `active`.
    - *Unvetted* (the admin allowed the address without a legal ID): the
      organization starts `pending_review`. A buyer sees
      only `/pending` (`decideAccess` → `pending`) and `submitOrder` refuses
      (`buyer_not_verified`); a supplier may prepare its catalog but can't invite.
      Admins get an email (`notifyAdminsOrgPending`) and a nav badge, review at
      `/admin/suppliers` or `/admin/organizations?status=pending_review`, where the
      `VerificationCard` shows ID, sign-in address (free-mail warning), who invited.
      Suppliers see "awaiting 202 verification" on such customers.
14. **Suppliers can also ask to be onboarded.** The public page `/suppliers`
    (explainer + short form) is for a supplier who got a partner's WhatsApp
    message. It only inserts a `supplier_requests` row: no account, no sign-in
    access. Abuse controls: hidden honeypot field, 5 per hour per IP
    (`RATE_LIMITS.supplierRequest`), and the same thank-you for duplicates
    (open request for the address or legal ID, or an already-registered
    supplier) so nothing about who is known leaks. The admin works the queue at
    `/admin/requests` (email alert via `notifyAdminsSupplierRequest`, sidebar
    count): mark contacted, reject (reason required), or approve, which calls
    `allowEmail(..., "supplier", { businessName, legalId })` so the supplier then
    signs in like any pre-registered one and starts `active`.

## Domain model

Tables (snake_case in SQL, camelCase in TypeScript):

- `profiles`: 1:1 with `auth.users`; name, phone (E.164), `is_platform_admin`,
  `password_set_at` (null until the person chose their own password).
- `organizations`:
  - `type` is `buyer` | `supplier`, immutable (a database trigger enforces
    this).
  - `status`:
    - both kinds: `pending_review` → `active` → `suspended`. Pre-registered
      businesses start `active`; unvetted ones start `pending_review` (a buyer
      then sees only the pending page until approved).
  - Both types: name, contact name, city, phone, `timezone` (default
    `Asia/Tbilisi`), `currency` (default `GEL`).
  - `legal_id` (required at onboarding, unique per type). Buyers only: `business_type`.
- `organization_memberships`: user ↔ org, `role` `owner` | `member`. A user
  belongs to one org, or to **two when a business both buys and resells**: one
  `buyer` and one `supplier` organization (never two of a kind), the same legal
  ID allowed once per type. See "Both sides" below.
- `supplier_settings`: `min_order_minor`, `prices_include_vat`,
  `delivery_area`, `delivery_terms`, `order_cutoff_note` (text fields).
- `addresses`: buyer delivery locations.
- `categories`: admin-managed, a flat list for now.
- `products`:
  - owner: `supplier_org_id`; `category_id`;
  - name, description, brand, sku, `unit`, `pack_description`, `image_path`;
  - `base_price_minor`, `vat_rate_bp`, `min_qty_milli`, `qty_step_milli`;
  - `stock_milli`: the supplier's own count, null = not tracked. **Never
    selected by buyer-side queries** (a test asserts it). Confirming an order
    subtracts the confirmed quantities, a supplier cancel of a confirmed order
    adds them back, rejects/pending cancels/delivery change nothing; the count
    may go negative (oversold). Hand edits are "received" (adds) or "recount"
    (replaces), both single SQL updates (`adjustStock`); the product form does
    not touch it on edit;
  - `is_active`, `search_text`.
- `price_lists`, `price_list_items`: per-supplier **assortment lists**. An item
  means "customers on this list may see and order this product"; its
  `price_minor` is optional (NULL = the product's base price).
- `supplier_customers`:
  - supplier org ↔ buyer org;
  - `status` `invited` | `active` | `blocked`;
  - `price_list_id` (null means the customer sees no products yet);
  - `private_note`: the supplier's remark, never shown to the buyer. The
    customer page also shows history from `domain/customers/insights.ts`
    (order value counts confirmed + delivered only).
- `invitations`: `token_hash`, `expires_at`, `revoked_at`, `accepted_at`, and
  the target supplier_customers row.
- `carts`, `cart_items`: persisted, one cart per (buyer org, supplier org).
- `regular_orders`, `regular_order_items`: a buyer's saved reorder with one
  supplier and a weekday (max 10 per buyer).
- `orders`:
  - `number` (sequence, shown as `GST-1001`), buyer org, supplier org,
    `status`;
  - currency, totals (subtotal, VAT, total);
  - address snapshot, note;
  - `idempotency_key`, unique per buyer org;
  - `requested_delivery_date` (buyer, optional) and `delivery_date` (agreed by
    the supplier when confirming): calendar days (`lib/dates.ts`), today up to
    90 days ahead on the **supplier's** timezone calendar.
- `order_items`: product ID (nullable on delete) plus an **immutable
  snapshot**: name, sku, unit, pack description, unit price, VAT rate,
  `ordered_qty_milli`, `confirmed_qty_milli`, line totals.
- `order_status_history`: order, from, to, actor user, actor org, note,
  timestamp.
- `notifications`: in-app, per recipient user, `read_at`.
- `notification_deliveries`: the outbox. Channel, recipient, payload,
  `status`, `attempts`, `next_attempt_at`, `last_error`, unique `dedupe_key`.
- `audit_logs`: admin and security-relevant actions.
- `allowed_emails`: the sign-in allow-list (lowercase email, note, optional `intended_role` (`buyer`/`supplier`/`both`), optional vetted `business_name` + `legal_id`, `revoked_at`); never deleted from.
- `supplier_requests`: public "onboard me" submissions (business name, legal ID, contact, phone, email, city, note; `status` new/contacted/approved/rejected, admin note, reviewer). At most one open request per legal ID and per email.
- `buyer_supplier_invites`: a buyer's invitation to a supplier (buyer org, supplier name, phone/email, `token_hash`, `expires_at`, `revoked_at`, `used_at` when a join request used it, `supplier_org_id` once that supplier has an organization, `connected_at`); `supplier_requests.invite_id` points back to it.
- `buyer_invite_links`: a buyer's reusable invitation link (buyer org as primary key, `token`; replaced on request). Each supplier that joins through it gets its own used `buyer_supplier_invites` row.
- `connection_requests`: one business asks another to connect (from/to organization, status pending/approved/declined/withdrawn/expired, optional message and offered price list, expiry). `organizations.findable` lets a business be looked up by its code.
- `team_invites`: a company owner's invitation of a colleague (organization, lowercase email, role `owner`/`member`, `accepted_at`, `revoked_at`; one open row per organization and address).
- `rate_limits`: fixed-window counters for abuse limits (key, window, hits).

### Order lifecycle

```
pending ──supplier confirms (may adjust qty)──▶ confirmed ──supplier──▶ delivered
   │                                               │
   ├──supplier rejects (reason required)──▶ rejected
   ├──buyer cancels──▶ cancelled                   └──supplier cancels (reason required)──▶ cancelled
```

- Terminal states: `delivered`, `rejected`, `cancelled`.
- Transitions are defined once in `src/lib/orders/transitions.ts` and applied by
  `src/server/domain/orders/transitions.ts`, enforced on the server inside the same transaction that writes the
  `order_status_history` row.
- Every transition is checked against the current status with a conditional
  update (`WHERE status = $expected`), so two people clicking at once cannot
  both win.

## Conventions

- **Money:** integer minor units (tetri) in `bigint` columns, always with a
  currency code. Never floats. Parsing, formatting and arithmetic live in
  `src/lib/money.ts` (shared by forms and the server); quantities in
  `src/lib/quantity.ts`.
- **Quantities:** integer thousandths of the unit (`*_milli`; 2.5 kg = 2500), so
  weighed goods work without decimals. Line total =
  `round_half_up(unit_price_minor × qty_milli / 1000)`, computed in one helper.
- **VAT:**
  - Each product has `vat_rate_bp` (basis points; 1800 = 18%, 0 = exempt).
  - Each supplier has `prices_include_vat`.
  - Orders snapshot both and show subtotal, VAT and total.
  - Never hardcode 18%.
- **Prices are re-resolved and re-validated on the server at submit time.**
  The cart's displayed price is advisory. If anything changed, the buyer sees
  what changed and confirms again.
- **Time:** `timestamptz`, stored in UTC. Render in the org's `timezone` at the
  display edge via `Intl`. Never hardcode Tbilisi or GEL in logic. They are
  defaults on the org row, not constants.
- **Phones:** E.164 via `libphonenumber-js`, default region `GE`. `wa.me` links
  use digits only (`lib/whatsapp.ts`). Display with `formatPhone()`.
- **Formatting happens on the server.** Money, quantities and dates are
  formatted in Server Components or actions, and client components receive
  strings.
  - Browsers' Intl data varies (a test Chromium rendered "GEL 15.00"
    instead of "15,00 ₾"), which also breaks hydration.
  - Client components may *parse* input with `lib/money.ts` and
    `lib/quantity.ts`, but must not format for display.
- **IDs:** UUIDs. Human references are `GST-<number>`, and the number is
  never used for authorization.
- **Deletes:** orgs are deactivated, not deleted. **A supplier can delete one of its own products for good**
  (decided 2026-11-18; `deleteProduct`, "Delete product" under the Disable button on the product page, an inline
  two-step confirmation that says how many order lines and open orders include it). Disabling stays the reversible
  way to hide it. Deleting removes it from price lists, carts and saved regular orders (a regular order left with no
  products is removed) and deletes its photo; **order items keep their snapshot** (`product_id` becomes null), so
  history, open orders, loading sheets and waybill data are unaffected. Audited as `product.deleted`.

## Language, search and typography

- **All user-facing text** goes through `next-intl`, in two languages (`ka` default, `en`; decided
  2026-11-07). No string literals of either language appear in components. The language is a cookie
  (`gusto-locale`, `i18n/locales.ts`), not a URL prefix, so every address is the same in both: the
  `LocaleSwitch` (landing nav, sign-in, public pages, the app sidebar and the account/password page)
  calls `setLocaleAction`; `i18n/request.ts` reads the cookie (anything but `en` is Georgian).
  - **`messages/en.json` mirrors `messages/ka.json` exactly** (same keys, same `{placeholders}` and
    rich-text tags; English may use ICU `plural` where Georgian has no plural). `tests/unit/messages-parity.test.ts`
    fails on a missing key, a placeholder mismatch, an empty string, Georgian letters or a dash in English.
    Add every new string to both files.
  - **English copy:** plain, short, no jargon, sentence case ("Request to join", "Order again"); amounts
    and quantities come from `getFormats()` (`server/i18n/formats.ts`: "₾12.50" and "2.5" in English,
    "12,50 ₾" and "2,5" in Georgian), never formatted by hand.
  - **Text that leaves for someone else is always Georgian**, whatever language the sender uses, because
    we don't know the recipient's: WhatsApp messages (order text, invitations, sign-in link hand-over),
    invitation and welcome emails (`getTranslations({ locale: "ka", ... })`), order and reminder emails
    (`lib/notifications/templates.ts`), admin alerts, the Supabase auth email. A per-user language for
    emails would need a `profiles.locale` column: not built.
  - **The switch is instant (no server round trip).** `ClientIntl` (`i18n/client-intl.tsx`, mounted in the root
    layout) holds both catalogs in the browser (the other language loads when idle), writes the cookie itself
    (`document.cookie`; there is no server action) and swaps the text at once; a background `router.refresh()`
    then updates the server-rendered parts of in-app pages. So pages that are only text (landing, sign-in shell,
    `/suppliers` join page, `/auth/continue`, legal) are **client components** using `useTranslations`
    (`landing-content.tsx`, `login-shell.tsx`, `join-page.tsx`, `continue-card.tsx`, `legal-view.tsx`) and never
    format with Intl in the browser (`formatMoneyPlain` for the landing mock-ups; the legal dates are made on the
    server for both languages). The legal wording is not in the shared catalog: the legal page passes both
    languages as props. Only `CLIENT_NAMESPACES` (`i18n/client-messages.ts`) reach the browser;
    `tests/unit/client-messages.test.ts` fails if a component uses a namespace that is not listed.
  - The legal pages and the landing text follow the cookie too. `global-error.tsx` (the last-resort
    error screen) stays Georgian. `<html lang>` is set by a tiny script from the cookie (the server
    renders `ka` statically).
- **Georgian copy** (English follows the rules under "English copy" above): short and natural, like a well-made local app, not
  bureaucratic or machine-translated.
  - Address the user with the polite "თქვენ" form ("შეამოწმეთ ელფოსტა").
  - Buttons use short verbal nouns ("შეკვეთის გაგზავნა", "გაგრძელება"),
    never "გთხოვთ განახორციელოთ…".
- **Search works in Georgian script and Latin transliteration.** Many people
  type "kveli" or "qveli" for "ყველი".
  - `src/server/domain/search/translit.ts` maps both scripts to one
    lowercase Latin *skeleton* that collapses common typing variants:
    - Georgian side: ქ/კ/ყ → k, წ/ც → c, ჭ/ჩ → ch, ღ → g, ხ → x, and similar.
    - Latin side: q/y → k (from the national system and the Georgian keyboard
      layout), w/ts → c, kh → x, gh → g, apostrophes dropped.
    - Queries get the same treatment.
  - `products.search_text` stores the name, brand and sku in both forms.
  - It is matched with `pg_trgm`.
- **Fonts:** Noto Sans Georgian for Georgian, Inter for Latin and numbers, both
  via `next/font`.
- **Never `text-transform: uppercase` on Georgian.** Browsers render it as
  Mtavruli (Georgian capitals), which reads as shouting or decoration. Use
  weight and size for hierarchy instead.
- Georgian strings run ~20–30% longer than English. Layouts must not truncate
  buttons or table headers.

## Design system

Minimal, premium B2B: think Linear or Stripe dashboards, not a landing page.
Black, burgundy and white.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ink` | `#0B0B0C` | `#F5F5F4` | Text, **primary buttons** |
| `--surface` | `#FFFFFF` | `#0B0B0C` | Page background |
| `--surface-2` | `#FAFAF9` | `#161617` | Cards, sidebar |
| `--border` | `#E7E5E4` | `#2A2A2C` | Hairlines |
| `--muted` | `#57534E` | `#A8A29E` | Secondary text |
| `--brand` | `#7A1F2B` | `#D46A7C` | Logo, active nav, focus rings, links, key highlights |
| `--brand-soft` | `#F6E9EB` | `#2A1418` | Selected rows, subtle brand fills |
| `--danger` | `#DC2626` | `#F87171` | Errors only, always with an icon |

- **Light and dark are both first-class.** The theme is `data-theme="light|dark"` on `<html>`,
  set by an inline script in `layout.tsx` before first paint (the saved choice in `localStorage`
  key `gusto-theme`, else the device's setting), changed by `components/theme-toggle.tsx`
  (light / dark / device; in the shell sidebar, as a single cycling 44px button in the phone
  header, and on the sign-in page). Tokens live in `globals.css`: `:root` = light,
  `:root[data-theme="dark"]` = dark, and Tailwind's `dark:` variant is bound to the attribute. The
  contrast test reads both blocks. Without JavaScript the page stays light. The landing page
  (`.lp`) has its own fixed light palette and does not follow the theme. Never use
  `prefers-color-scheme` in components: use the tokens or `dark:`.
- **Black is the primary action color.** Burgundy is the accent. Destructive
  or negative actions (reject, cancel) are outlined buttons with an icon, never
  burgundy-filled, so "Confirm" and "Reject" cannot be confused.
- **Burgundy on black fails contrast** (~2:1). Dark mode uses `#D46A7C`.
- **Status badges** use muted tones plus a lucide icon:
  - `pending`: amber, clock icon;
  - `confirmed`: blue, check icon;
  - `delivered`: green, package-check icon;
  - `rejected` / `cancelled`: neutral gray, x icon. Not red, so they don't
    compete with the brand or with errors.
- **Layout:** sidebar on desktop, bottom navigation on mobile. No horizontal
  scroll at 360px width. Touch targets ≥44px.
  The phone bottom bar (`BottomNav` in `components/app-shell/nav-links.tsx`) has five slots: with more
  than five items the first four show and the rest sit behind "More" (`nav.more`). A buyer and a supplier have exactly five
  (a supplier's Settings and a platform admin's Administration link carry `inAccountMenuOnPhone` and sit in the phone account
  menu instead); only the admin area still has a "More". Tabs show a **count badge** (`NavBadgesProvider`, `nav-badges.tsx`): a
  supplier's Orders = orders waiting for an answer (rendered by the layout, then refreshed every 45 s from `/api/supplier/pulse`
  while the tab is visible), a buyer's Cart = items in all carts, the admin's items as before; the badge is part of the link's
  accessible name (`nav.withCount`). Georgian words run
  about 7px per letter at 11px (the floor Apple sets is 11 pt, so bar labels are `0.6875rem`, never smaller), so the long labels have soft-hyphenated variants in `nav.bar.*`
  (`BAR_LABELS`) that wrap at a syllable on narrow phones; the real name stays as `aria-label`. A
  new nav item with a long label needs a `nav.bar.*` entry; `tests/e2e/bottom-nav.spec.ts` fails if
  any label is cut off at 360px or 320px.
- **States:** every list has empty, loading (skeleton) and error states.
  **Moving between pages should feel seamless** (2026-11-21, `globals.css`): the `Skeleton` primitive stays invisible for
  the first 150 ms and then fades in (a wait shorter than that shows no skeleton at all), and anything that is a direct
  child of the shell's `<main>` fades in over 180 ms when it arrives, except the page title (`data-page-header`) and
  `aria-hidden` skeleton wrappers. Opacity only (a transform would change how fixed-position children behave); both are
  off under `prefers-reduced-motion`. Use the `Skeleton` primitive for any new loading state so it inherits this.
- **Apple HIG review, 2026-11-21** (design review against Apple's guidelines; the rules it produced):
  - **Phone type scale** (`globals.css`, below 640px): `text-xs` is 14px, `text-sm` 16px, `text-base` 17px (Apple's iOS default is
    17 pt, the floor 11 pt); nothing is set below 12px, and the page title (`PageHeader`) is 28px on a phone. Rows with an action
    (`PanelRow`) wrap, with the text given a `flex-[1_1_12rem]` basis, so a button drops below the text instead of squeezing it.
  - **Control edges** use their own `--input` token (3:1 against the page and cards, tested in `contrast.test.ts`), not the hairline
    `--border`; cards use `--surface-raised` (`bg-card`), which is lighter than the page in dark mode.
  - **Nothing disappears on a timer**: notices float as `StatusToast` (kept until closed; the live "new order" notice and the bulk
    result). Hard-to-undo actions use `ConfirmAction` (an inline question with the action named and Cancel, focus on Cancel), never
    `window.confirm`.
  - **Phone dialogs are bottom sheets** with a `SheetGrabber` (drag down to dismiss; the close button and Escape stay): the order
    review, the product card, both delete confirmations. From `sm` up they are the side panel or centred dialog they were.
  - A "Skip to content" link leads the shell (`main#main-content`). The theme choice lives in the account menu on a phone (and in
    the sidebar on desktop). Two moments get a `SuccessMark` (a check that draws itself once, still under reduced motion): the
    buyer's order sent, the supplier's order confirmed.
- **Actions and taps answer at once** (2026-11-21, reworked 2026-11-24 after a review): `Button` takes `loading`: a spinner
  replaces the content (which keeps its space and its place in the accessibility tree, `opacity-0`, so the button never changes width and keeps its name), a
  second press does nothing (the click is cancelled, so a form is not submitted twice), and the button stays at full strength
  (a dimmed button reads as broken). **It is not `disabled`**: it carries `aria-disabled` and `aria-busy`, so keyboard focus
  stays on it, and `loadingLabel` (`common.working`, or a "saving" string) is read to screen readers. `asChild` buttons get the
  same guard and attributes. Use `loading` on the one button that started the action, never on siblings that merely share
  `pending` and never on a button that only opens a form. Buttons and nav links shrink slightly while pressed (off under reduced
  motion); an invisible 2px margin (`before:-inset-0.5`) keeps the full-size tap area so an edge tap is not lost. Every nav link
  (sidebar, bottom tabs and the phone "More" list) shows `PendingHighlight` (`useLinkStatus`) while its page is being prepared,
  so the tap is acknowledged before the page arrives (`tests/unit/button.test.ts` guards the button part).
- **Everything comes from somewhere** (2026-11-23; the principle from a design post on spatial continuity): panels and
  sheets animate from where they belong, set per dialog with `data-motion` (`sheet`: rises from the bottom on a phone,
  pops in centred above; `side`: the review panel; `top`: the command palette; `menu`: the account menu), in plain CSS
  (`@starting-style` + `allow-discrete`, in `globals.css`; a browser without them just shows and hides at once). Notices
  (`StatusToast`) enter and leave; counts and an order's status badge pop when they change (`ChangePulse`, not on first
  render; a count going from none to one pops too); a row that arrives while the page is open (a new order in the live
  queue or inbox) gets a colour highlight (`FreshRow`, `PanelRow freshId`): only rows that first mount in the 8 seconds after
  `LiveOrders` triggered a refresh (`expectArrivals()`), so rows present at load, navigation between pages and a
  changed filter or brand toggle never animate, and nothing is recorded on the server; inline
  questions and the confirm/reject panels rise in; a cart line fades while the server removes it. **One curve
  (`--ease-out`), 150 to 250 ms, nothing that moves layout, and everything that moves is off under reduced motion**
  (`tests/unit/motion.test.ts` guards this). The one exception is the new row's 1.8 s colour fade, which moves nothing and
  stays on, because without it an arriving row would go unnoticed. Closing a dialog animates only where the browser
  supports `overlay` (`@supports`; Safari closes instantly, only the opening animates), because without it a closing
  dialog leaves the top layer and jumps. The sheet grabber carries a dismissed sheet off the screen before closing it.
  The sidebar, phone header and bottom bar carry `view-transition-name`s (`app-sidebar`, `app-header`, `app-bottom-nav`) with
  no animation of their own, so a page-to-page view transition (not built yet) only moves the content between them.
- **Avoid:** gradients, emoji as icons, decorative motion, modals for
  multi-step flows (use pages or sheets).

## Project layout

```
src/
  app/
    (public)/                 landing, login, invite acceptance, /suppliers (request to be onboarded)
    onboarding/               org creation after first sign-in
    supplier/                 supplier area (guarded by layout + every action)
    buyer/                    buyer area
    admin/                    platform admin: overview + pilot metrics, suppliers, organizations, order lookup, audit log, categories
    o/[number]/               order link → redirects to the viewer's own order page, or 404
    api/cron/notifications/   outbox drain (CRON_SECRET)
    auth/confirm/             magic-link token-hash verification
    auth/sign-out/            POST only
    start/                    sends a signed-in user to their area
  proxy.ts                    session refresh + signed-out redirect (Next 16's "middleware")
  server/
    auth/                     access rules (pure), guards, sign-in helpers
    env.ts                    validated server env, read lazily
    supabase/server.ts        request-bound Supabase client (auth only)
    db/                       drizzle client, schema
    domain/                   business logic by area: catalog, admin, pricing, orders, customers, search, metrics
    security/rate-limit.ts    Postgres-backed rate limits
    domain/context.ts         OrgCtx / SupplierCtx / AdminCtx + assertSupplier/assertAdmin
    domain/errors.ts          NotFoundError, StateError, ConflictError
    actions/result.ts         runAction(): domain errors → action results / 404
    storage/                  image processing (sharp) + Supabase Storage adapter
    notifications/            outbox, channels (inApp, email), whatsapp-link builder
  components/ui/              shadcn-style primitives (components.json is set up for `npx shadcn add`)
  components/                 app components
  i18n/, messages/ka.json
drizzle/                      generated + custom SQL migrations
scripts/                      admin-grant, seed-dev (+ seed-guard), check-bundle-secrets, load-env
supabase/                     local Supabase config + email templates (no migrations here)
tests/unit, tests/integration, tests/e2e
```

Pages and actions stay thin. They call `src/server/domain/*`, which holds the
rules, so the same rule is never written twice.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` (route types) + `tsc --noEmit` |
| `npm test` | Unit tests, no database |
| `npm run test:integration` | Against `DATABASE_URL_TEST`: **drops and rebuilds** it, then runs the real migrations |
| `npm run test:e2e` | Playwright on a production build against the Supabase in `.env.local` |
| `npm run build` | Production build; must pass with **no** env vars set (CI does this) |
| `npm run db:generate` | Generate SQL from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL_DIRECT` |
| `npm run admin:grant -- <email>` | Make an address a platform admin; also allows it to sign in (audited) |
| `npm run user:allow -- <email> [--name N --legal-id ID]` | Allow an address to sign in (invite-only app); name + ID = "I verified this business" |
| `npm run db:seed` | `[DEMO]` data into a **local** database; refuses any other host |
| `npm run check:secrets` | After a build: fail if a server secret is in `.next/static` |

Scripts, drizzle-kit and tests read `.env.local` then `.env`
(`scripts/load-env.ts`), the same files Next.js reads.

## Next.js 16 specifics (this is not the Next.js in your training data)

Read `node_modules/next/dist/docs/` before using an API you haven't checked.
What this codebase relies on:

- **Cache Components is on** (`cacheComponents`, `partialPrefetching`). Because the language is a
  cookie read at request time, the root layout wraps everything in one `<Suspense fallback={null}>`:
  every route renders per request (no static shell); the page-level Suspense boundaries below still
  stream in. Landing and legal pages are therefore not prerendered.
  - Reading cookies, headers or `searchParams` outside a `<Suspense>`
    boundary is a build error.
  - Pages render a static header and put the session-dependent part in an
    async child component inside `<Suspense>` with a skeleton fallback.
  - Area layouts do the same around the shell.
- **`await connection()` comes before any Supabase client.**
  - `createSupabaseServerClient()` calls it before anything else, because
    the Supabase client reads the clock, which is forbidden during
    prerendering.
  - Don't create Supabase clients any other way.
- **`proxy.ts` is what older Next.js called `middleware.ts`.** It only
  refreshes the session and redirects signed-out visitors. It is not the
  authorization layer.
- **Route types are generated.** `PageProps<"/route">` and
  `LayoutProps<"/route">` are global types; `npm run typecheck` regenerates
  them.
- `AGENTS.md` is written by `next dev`. Leave it committed.
- **The previous page stays mounted but hidden** (React `<Activity>`). In
  Playwright, prefer role queries (`getByRole`), which skip hidden elements;
  `getByLabel` can match a field on the hidden page.
- **Mutating Server Actions call `refresh()`** (from `next/cache`) so the
  current route re-renders. Nothing uses `'use cache'` yet.
- **Server Action bodies are capped at 4.4 MB** (`next.config.ts`) for image
  uploads; Vercel rejects function request bodies above 4.5 MB.

## Server Action conventions

- **Guard first:** every action starts with `require*()`.
- **Validate:** parse input with the shared Zod schema from
  `src/lib/validation/`. Return `{ ok: false, error: "invalid", fieldErrors }`
  on failure.
- **Call the domain function inside `runAction()`.** It maps errors:
  - `NotFoundError` → `notFound()`;
  - `StateError` / `ConflictError` → `{ ok: false, error: code }`;
  - anything else is logged (message only) and becomes `"unknown"`.
- **Error codes are i18n keys.** Client components translate them.
- **Domain functions take `ctx` first** and re-check the role with
  `assertSupplier` / `assertAdmin`, so a wrong call site fails closed.
- **next-intl message keys must not contain dots.** Dots mean nesting. Map
  dotted identifiers (audit actions) to flat keys.

## Catalog specifics (milestone 2)

- **Images:**
  - Validated by content, not name or MIME: JPEG, PNG or WebP only, ≤ 4 MB,
    ≤ 40 MP.
  - Re-encoded with `sharp` to WebP at 400px and 1200px, which strips
    metadata.
  - Stored as `{supplierOrgId}/{productId}/{uuid}-w{400|1200}.webp` in the
    public `product-images` bucket.
  - `products.image_path` holds the prefix.
  - `<ProductImage>` uses a custom `next/image` loader that picks the stored
    size. Next's optimizer isn't used, so no `remotePatterns` are needed.
  - The bucket is created by migration `0003`, which skips itself on plain
    Postgres.
- **Import:**
  - The browser parses CSV (papaparse) or XLSX (read-excel-file) into
    `{ headers, rows }` of strings, at most 2000 rows.
  - The server re-validates every row on commit (`lib/catalog/import.ts`)
    and never trusts the preview.
  - Rows are matched to existing products by SKU within the supplier.
  - Mode `all` aborts if any row is invalid; `valid_only` skips bad rows.
  - Either way it runs in one transaction.
  - The last column mapping is saved in `supplier_settings.import_mapping`.
- **Supplier status:**
  - `pending_review` can edit the catalog; `suspended` is read-only (domain
    throws `StateError("suspended")`).
  - Admin review moves are conditional on the current status and audited
    as `supplier.approve|suspend|reactivate`; suspend and reactivate need a
    reason.
- **Categories:** a flat, admin-managed list with a Georgian `name`.
  Archiving hides a category from new products; existing products keep it.
  Suppliers cannot create categories. The import screen lists the valid ones
  when rows fail on `unknown_category`, and the admin can create the missing
  ones straight from a supplier's file (`/admin/categories`, "from a product
  file": `categoryNamesInSheet` in the browser, `createMissingCategories` on the
  server: case-insensitive, archived names count as existing, audited).
  `lib/catalog/read-sheet.ts` is the shared browser file reader.
  **Matching** (`lib/catalog/categories-standard.ts`): a file's category text is
  compared after `normalizeCategoryKey` (case, spaces, quotes, "და"/"&"/","
  ignored), and for the **standard HoReCa categories** (`STANDARD_CATEGORIES`, 29
  Georgian names with Georgian and English aliases) any alias reaches the
  category 202 has. `createMissingCategories` turns an alias into the standard
  Georgian name, and Admin > Categories has an "add the standard categories"
  button. Production was seeded with the standard set on 2026-11-04.
- **Import fallbacks** (`ImportOptions` in `lib/catalog/import.ts`, chosen on the
  mapping screen, re-checked on the server): where a file has no category column
  (or an empty category cell) the supplier can make it an error (default), use
  one chosen category, or **guess it from the product name**
  (`lib/catalog/category-guess.ts`, standard categories only, null = reported,
  preview labels the row "guessed"); an empty unit can take a chosen default; a
  missing code can be **generated from the name** (`lib/catalog/auto-sku.ts`,
  `A-` + 10 characters, stable, so re-importing the same list updates instead of
  duplicating; renaming a product makes a new one). A cell that has text is never
  replaced: a misspelt category stays `unknown_category`. Price cells are cleaned
  (`cleanAmountText`: currency signs and words, "1,250.50" / "1.250,50"). Header
  aliases cover more Georgian, English and Russian spellings. The preview shows
  each row's category, where it came from, and any generated code.
- **Photos in an .xlsx** (`lib/catalog/sheet-images.ts`, `read-sheet.ts` `readSpreadsheetWithPhotos`,
  `prepare-photo.ts`): the browser unzips the file (`fflate`), follows first sheet -> drawing -> media, and
  matches each floating picture to the row it starts in (only the first per row; PNG/JPEG/WebP; "place in
  cell" pictures are not read). The preview shows thumbnails. Pictures never travel with the sheet: after
  the commit, which returns `targets` (file row -> product id, only rows that have a code), the wizard
  shrinks each picture (max 1600px, JPEG) and sends it through the normal `uploadProductImageAction`
  one by one. They are the supplier's own uploads (private); a photo in the file replaces an existing one.
  Files over 60 MB are refused. Fixture: `tests/unit/fixtures/gusto-products-with-photos.xlsx`.
- **Barcode** (`products.barcode`, optional, 8-14 digits; import field with its own aliases; it also stands
  in for a missing product code, so a barcode column gives stable codes). It is plain supplier data: 202 does
  not look photos up anywhere. **Photos come from the supplier**: pictures placed in the .xlsx, or uploaded on
  the product page. Fetching photos from Open Food Facts or the open web was built and removed on 2026-11-05
  (free sources cover few Georgian wholesale goods; web search APIs are paid and the photos are copyrighted).
- **Units are also the packaging** (`lib/catalog/units.ts`): piece, kg, g, l, ml,
  box, pack, case, bottle, jar, bag, sack, keg, pallet, bunch, roll, bucket. The
  import accepts many spellings per unit (Georgian, English, a few Russian), see
  `unitAliasTable()`. The product's `შეფუთვა` column is free text. Adding a unit
  means: `PRODUCT_UNITS`, the DB enum (migration), `units.*` and `unitNames.*` in
  the messages, and its aliases.

## Environment variables

Names only. `.env.example` holds placeholders. Never commit real values.

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
  publishable key)
- `SUPABASE_SERVICE_ROLE_KEY`: server only; storage uploads and auth admin
  calls.
- `DATABASE_URL`: Supavisor transaction pooler (port 6543), used by the app
  with `prepare: false`.
- `DATABASE_URL_DIRECT`: direct or session connection, for migrations only.
- `RESEND_API_KEY`, `EMAIL_FROM`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (**secret**), `VAPID_SUBJECT`: Web Push, optional (see Dashboards > Web Push).
- `CRON_SECRET`
- `NEXT_PUBLIC_SENTRY_DSN` (public, build time), `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (build-only, **secret**): see Operations.
- `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ID`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL`: the operator block on `/terms` and `/privacy` (public, read at build). `LEGAL_CONTACT_EMAIL` alone is also the contact line on the sign-in "not accepted" message.

Missing optional integrations degrade loudly, not silently. With no
`RESEND_API_KEY`, emails are written to the server log prefixed `[DEV EMAIL]`
and the delivery row is marked `skipped`, not `sent`.

## Database rules

- **Never** run `drizzle-kit push` against a shared or production database.
  Always `generate`, read the SQL, commit it, then `migrate`.
  **Production is migrated through Supabase's migration list** (`apply_migration` with the same SQL), not
  `drizzle-kit migrate`, and the new migration's row is then added to Drizzle's log (`drizzle.__drizzle_migrations`)
  so the two stay in step (the log was reconciled through 0038 on 2026-11-24). Steps, hash and the statement are in
  [`docs/production-migrations.md`](docs/production-migrations.md): read it before touching production migrations.
- Extensions (`pg_trgm`), RLS enablement, sequences and other hand-written SQL
  go in custom migrations (`drizzle-kit generate --custom`), committed like
  any other.
- **Never reset, truncate or seed a production database.** Integration tests
  and seeds run only against local Supabase (`supabase start`) or a dedicated
  dev project. The scripts check the host and refuse otherwise.

## Customers and pricing specifics (milestone 3)

- **Price resolution lives only in `server/domain/pricing/resolve.ts`:**
  - `effectivePriceSql(buyerOrgId)` for queries that read `products`;
  - `resolvePrices()` for a set of product IDs.
  - `availableToBuyerSql(buyerOrgId)` is the matching condition: the product
    must be on the list of the buyer's *active* connection. It is applied in
    the buyer catalog, search, top-ordered, cart (flags `unavailable`,
    refuses new quantities) and submit (re-checked as a `changed` diff).
    `resolvePrices` omits unavailable products.
  - The rule: **nothing until set up.** A customer with no list, or a list
    without the product, sees and can order nothing. On the list, the item's
    price, else the base price.
  - The subquery references `"products"` by name, so don't alias `products`
    in queries that embed it.
- **Cross-supplier consistency is enforced by the database.**
  - `price_list_items` and `supplier_customers.price_list_id` use composite
    FKs that include `supplier_org_id`.
  - So a row can't link one supplier's list to another supplier's product
    or customer, even if app code is wrong.
- **`supplier_customers` rows exist from invitation.**
  - `buyer_org_id` is null until someone accepts.
  - Status is `invited` → `active` on accept; `blocked` at any time.
  - Blocking revokes open invitations. Unblocking restores `active`, or
    `invited` if the customer never joined.
- **Invitations:**
  - 32 random bytes, base64url. Only the SHA-256 hash is stored.
  - Valid 14 days and single use. A new link revokes older ones.
  - The raw link is shown once, in the action result, and never put in our
    own URLs.
  - Every unusable token returns the same `unavailable`: forged, expired,
    revoked, used, blocked customer, or non-active supplier.
  - Acceptance locks the invitation row, so concurrent accepts can't both
    win.
  - A new user's buyer org is created and connected in one transaction
    (`createOrganizationInTx`).
- **A buyer can invite a supplier** (`domain/buyer/supplier-invites.ts`, `/buyer/suppliers/invite`,
  table `buyer_supplier_invites`; only an `active` buyer, 20/h, at most 30 open). The buyer enters the
  supplier's name and a phone or email, gets a one-time link `/suppliers/invite/<token>` (30 days, only
  the hash is stored, shown once; WhatsApp button and a direct email, never through the outbox). The link
  opens the public join form with the buyer's name and the supplier's name filled in, and the same
  `unavailable` notice for every unusable token. **It grants nothing**: it creates an ordinary
  `supplier_requests` row (`invite_id` set, single use, claimed only by a request that was really stored)
  that the admin vets like any other, and the admin queue shows "invited by <buyer>". When the approved
  supplier onboards, `linkInvitesToSupplier` attaches the invitation to their organization by the address
  they signed in with. They then see the buyer under "buyers who invited you" on the Customers page and
  `connectInvitingBuyer` makes the buyer an active customer in one tap (default price list if the supplier
  has one; otherwise the buyer sees nothing until a list is assigned, as always). The buyer sees nothing of
  the supplier until the supplier does that: a supplier decides who sees its catalog and prices. The
  supplier's contact details the buyer typed are visible only to that buyer (privacy text mentions it).
- **Personal link** (`buyer_invite_links`, one row per buyer, `/buyer/suppliers/invite`): a reusable invitation link made on the buyer's first visit, shown with the ready text `supplierInvite.orderFooter` (one benefit sentence + link) and a Share button (`navigator.share`, falling back to copy) to paste or send under an order written in WhatsApp. Unlike named invitations it is not single use, so the raw token is stored to show it again (it grants nothing: a request the admin vets, rate limited per IP); "replace" swaps the token and the old link stops working. `claimSupplierInvite` turns each request that arrives through it into its own used `buyer_supplier_invites` row (supplier name from the request), so tracking, linking and "buyers who invited you" work as for named invitations. The named form stays below it for tracking one specific supplier. For a valid link `/suppliers/invite/<token>` leads with a short 202 pitch (`supplierRequest.invited*`) before the form.
- **Both sides** (decided 2026-11-05): a business that buys from some suppliers and
  resells to others has one login with a **buyer organization and a supplier
  organization**, not one mixed organization (org type stays immutable and every query
  stays scoped by `ctx.orgId`). `getAccessState` loads all memberships; the request acts
  as the one chosen in the `gusto-org` cookie (`server/auth/active-org.ts` `pickActive`: the
  remembered side while the person is a member, else the first active one, else a supplier
  since a waiting supplier can prepare its catalog while a waiting buyer only sees
  `/pending`, else the first). `/switch?org=<id>[&next=<path>]` (GET, own organizations only,
  ignores RSC/prefetch requests because a prefetch must never change the side) sets the
  cookie; the sidebar and phone header show `SideSwitch` (plain `<a>`, never `next/link`) for
  a person with both sides. A guard that finds the other side's area opened (`/buyer` while
  acting as a supplier) switches to it instead of 404, and `/o/<number>` looks at all of the
  person's sides. First onboarding offers **both** (`createBothForUser`: one set of details,
  two organizations, both active when the admin vetted the address, both waiting otherwise).
  A person with one side adds the other at `/account/add-side` (`createOrganizationForUser`
  with `addSide`): it starts **active at once when their other side is active and the legal ID
  is the same** (that business was already vetted), otherwise it waits for review like any new
  business. An address pinned to one kind (`intended_role` `buyer`/`supplier`) can't add the other; one pinned `both` can add either. Notifications
  stay per user (one bell for both sides; `/o/<number>` routes to the right side). There is no
  link between what a business buys and its own catalog.
- **Only `active` suppliers invite.** Pending suppliers can prepare price
  lists; suspended suppliers are read-only.
- **Buyers see a supplier only while** their connection is `active` *and*
  the supplier is `active`. Only active products are shown. Otherwise the
  answer is "not found".
- **Invitation email** goes out directly from the action that creates the
  invitation (`supplier/customers/actions.ts`), never through the outbox: the
  text holds the raw token, which must not be persisted. A provider error is
  caught and reported as "email not sent"; the link can still be copied.

## Ordering specifics (milestone 4)

- **Cart:** one per (buyer org, supplier org), persisted. Lines are quantities only; prices are always re-resolved when read (`domain/orders/cart.ts`).
- **Submit** (`domain/orders/submit.ts`) is one transaction: lock the cart, re-check the connection and supplier status, re-resolve prices, then compare with `expected` (what the buyer reviewed). Any difference creates nothing and returns a `changed` diff, which checkout shows (formatted on the server) for the buyer to confirm again.
- **Idempotency:** the checkout form generates a UUID key per page load; the key is unique per buyer org. A repeated key (or a lost race on the unique index) returns the existing order.
- **Order numbers** come from `order_number_seq` (starts at 1001), shown as `GST-1001`. The sequence is created in migration `0006` and owned by `orders.number` in `0007`.
- **Snapshots:** orders keep buyer/supplier names, currency, VAT mode and delivery address; items keep name, sku, unit, price and VAT rate.
- **Transitions:** the table lives in `lib/orders/transitions.ts`; `domain/orders/transitions.ts` applies each with a conditional `UPDATE ... WHERE status = expected` and a history row in one transaction. Reject and supplier cancel need a reason; buyers cancel only while `pending`.
- **Confirm** may change line quantities (0 = unavailable); totals are recomputed from the snapshot prices by `lib/orders/totals.ts` (per-line VAT).
- **After-commit hook:** `domain/orders/hooks.ts` `afterOrderSubmitted` asks for immediate delivery of the order's notifications (milestone 5); the rows themselves are written in the transaction.
- **`/o/<number>`** redirects to the viewer's own order page; 404 if they are on neither side, login redirect if signed out.
- **Print:** the supplier order page prints cleanly (shell chrome has `print:hidden`).

## Notifications specifics (milestone 5)

- **Events** (`server/notifications/events.ts`): `recordOrderEvent(tx, ...)`
  runs **inside** the transaction of the order change (`submitOrder` and
  `applyTransition`), so a rollback leaves nothing. Who is told is decided by
  the pure `lib/notifications/plan.ts`:
  - submitted → all supplier members;
  - confirmed / rejected / delivered → all buyer members;
  - cancelled → the other side from whoever cancelled (a buyer cancelling
    notifies the supplier);
  - the actor is never notified; in-app is always on; email follows the
    user's preference for the event's group (`new_orders` /
    `order_updates`; no preference row = on).
- **Dedupe:** unique `dedupe_key` on both tables, e.g.
  `order:{id}:status:{status}:email:{userId}`. Replays insert nothing.
- **Channels** (`server/notifications/channels/`): `Channel` has `enqueue`
  (in the transaction, rows only) and optional `send` (outbox, later). In-app
  and email implement it. A WhatsApp Business channel is **not** built:
  `docs/whatsapp-business-api.md`.
- **Outbox rows hold ids only** (`{event, orderId}`). The email is rendered at
  send time from the persisted order (`lib/notifications/templates.ts`:
  number, counterparty name, item count, total, `/o/<number>` link), and the
  recipient address is read from `auth.users` then. Nothing secret is stored.
- **Processing** (`server/notifications/process.ts`): claim = one `UPDATE ...
  WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50)` that pushes
  `next_attempt_at` 5 minutes out (a lease) and counts the attempt; the send
  happens outside any transaction. Failure → retry after 1, 5, 15, 60 minutes
  (`lib/notifications/backoff.ts`), then `failed`. `after()` calls
  `deliverAfterResponse(orderId)`; outside a request it quietly does nothing
  and the cron picks the rows up.
- **Cron:** `/api/cron/notifications` needs `Authorization: Bearer
  $CRON_SECRET` (no secret configured = always 401). Scheduled every minute by
  Supabase Cron via migration `0010` (URL and secret from Vault; README).
- **Email:** Resend over HTTP (`server/notifications/email.ts`, no SDK). No
  `RESEND_API_KEY` → `skipped` and `[DEV EMAIL]` log, never `sent`.
- **WhatsApp** buttons (`components/orders/whatsapp-share.tsx`) use
  `lib/whatsapp.ts`; copy says "send", never "sent"; nothing is stored.
  Right after a buyer places an order (`?placed=1`) the button is the main filled action under the
  confirmation, and the prefilled message carries the whole order (up to 25 lines, then "and N
  more", the total, the delivery address, the wanted day, the note and the `/o/<number>` link) so
  the supplier can read it in WhatsApp as they do today. This one-press button is the intended
  long-term channel; automatic Business API sending stays out of scope (`docs/whatsapp-business-api.md`).
- **Events that are not about an order** (`recordSubjectEvent`, same transaction rule, same channels, dedupe key
  `subject:<id>:<event>:...`): `terms_requested` (supplier members), `terms_approved` / `terms_declined` (buyer
  members) and `customer_connected` (supplier members, when an invited buyer joins). Such a notification has no
  order (`notifications.order_id` / `order_number` are null) and carries `link`, an internal path built by the
  server; opening it goes there (`/supplier/customers/<id>`, `/buyer/suppliers/<id>`). Their email is a short
  message with a button (`renderLinkEmail`, payload without `orderId`). The email preferences cover them:
  requests and new customers follow "new orders", answers follow "order status changes". Anything new that
  someone must act on or learn about gets an event here, in the same transaction as the change.
- **Bell:** `components/notifications/notification-bell.tsx`, rendered in
  Suspense by `AppShell` for buyers and suppliers. The list lives at
  `/buyer/notifications` and `/supplier/notifications` (shared view);
  clicking a row marks it read and redirects to `/o/<number>`.

## Later additions (2026-11-04)

- **Regular orders** (`domain/orders/regular.ts`, `/buyer/regular`, dashboard
  card): saved from a placed order. The cron route (`/api/cron/notifications`)
  also runs `sendRegularOrderReminders`: on the chosen weekday, from 08:00 in the
  buyer organization's timezone, once per day (claimed with a conditional
  UPDATE before sending, so a send failure loses that day's reminder rather
  than risking duplicates), one email per organization to members with
  order-update emails on. Loading into the cart re-resolves prices and skips
  products that are no longer available.
- **Delivery day**: asked at checkout, agreed at confirm (prefilled with the
  request), shown on both sides and in the confirm WhatsApp text.
- **Pick list** (`/supplier/orders/pick`, `domain/orders/pick-list.ts`): confirmed
  orders for one delivery day (or `none`), totals per product grouped by
  category, plus the stops; prints cleanly.
- **Admin Access page** has a bulk box (`lib/access/bulk.ts`: email, name, legal
  ID, role per line, max 100). The "not accepted yet" sign-in message shows a
  mailto link when `LEGAL_CONTACT_EMAIL` is set (`contactEmail()` in
  `lib/legal.ts`).
- **Needs-restocking filter** on the supplier product list (stock 0 or below).
- **Uptime**: a Sentry uptime monitor ("202 health", every 5 minutes) checks
  `/api/health` of the production URL. Update its URL when a domain is attached.

## Price conditions, loading sheet and side switch (2026-11-10)

- **Price conditions** (`price_rules`, `lib/pricing/conditions.ts` pure, `server/domain/pricing/conditions.ts`,
  editor `components/pricing/price-conditions.tsx` on `/supplier/pricing/[id]`). On a price list the supplier sets
  how the price changes with the **payment method** (cash / bank transfer), the **payment interval** (days after
  delivery, 0 = on delivery) and the **ordered quantity** (tiers: from N units, X%). Whole list or per product
  (a product's own rows replace the list's for that product; its own tiers replace the list's tiers). A change is
  in basis points (negative = cheaper); method + interval + tier are **added**, applied once to the list price
  (`applyBp`, half up). A method or interval with no row is **not offered**.
- **The buyer asks, the supplier approves.** On the supplier page in the buyer catalog (`PaymentTerms`) the buyer
  sees the offered conditions and asks for a method and interval (`payment_term_requests`, one open request per
  buyer and supplier). The supplier sees the effect (percentage and example prices) on the customer page
  (`CustomerTerms`, also a banner on the Customers list) and approves or declines. Only an approved request
  writes `supplier_customers.terms_method / terms_interval_days`; until then the standard price applies, so a
  buyer can always order. Quantity tiers apply automatically per line.
- Prices are decided in `loadBuyerPricing` + `priceLine`, used by the cart and by `submitOrder` (re-resolved at
  submit like every price). The order stores `payment_method`, `payment_interval_days` and, per line,
  `list_price_minor` + `adjust_bp`, so both sides see the list price struck through with the change. 202 still
  collects nothing and tracks no debt: the interval is an agreed term, not a receivable.
- **Loading sheet** (`/supplier/orders/pick`, `domain/orders/pick-list.ts`): per delivery day, totals per product
  with the split per customer, and a second view per address with each stop's lines; every line has a tick box
  kept in the browser only (`components/orders/pick-check.tsx`, localStorage per day). Prints cleanly.
- **Side switch** (`SideSwitch`): on phones a full-width two-part control with icons under the header, not
  squeezed in it; on desktop in the sidebar.

## Finding and connecting with businesses (2026-11-13)

- **Lookup by identification code** (`domain/connections/connections.ts`, `components/connections/*`, shown at the top of the
  supplier's Customers page and the buyer's Suppliers page). An active business types the **full** code (9 or 11 digits,
  never a name, never a browse list) and gets the name and city of the one business of the *other* kind that has it.
  Nothing else is revealed: no contact, catalog or prices. A business that is not approved (`active`), has switched
  **findable** off (`organizations.findable`, default on, a switch in the same panel), or has blocked the asker answers
  exactly like one that does not exist (`not_found`), so a lookup cannot tell them apart. 30 lookups per hour per
  organization; misses count. 11-digit codes are personal ID numbers of sole traders: the answer is still only the
  business name and city.
- **Requests work like friend requests** (`connection_requests`, either side can ask). Only an approval creates the
  `supplier_customers` row (active, buyer name and contact copied, price list = the one chosen when a supplier asks or
  approves, else the supplier's default list, else none: the buyer then sees nothing until one is assigned, as always).
  One open request per pair; a request lasts 30 days; asking someone who already asked you approves theirs; a decline
  blocks asking again for 14 days; the asker can withdraw. 20 requests per hour per organization. Decisions and
  withdrawals are scoped to the acting organization (someone else's request is "not found").
- Notifications: `connection_requested` (recipient, link `/supplier/customers#requests` or `/buyer/suppliers#requests`),
  `connection_approved` / `connection_declined` (the asker). Invitation links stay for businesses not yet on 202.
- **Invitations carry an optional code** (`supplier_customers.legal_id`, `buyer_supplier_invites.legal_id`; field on both
  invite forms). On submit with a code the form first runs the lookup: a business **already on 202** gets a card
  (`components/connections/connect-instead.tsx`) offering "send request" or "invite by link anyway"; a connected or waiting
  pair only shows its state. A code that matches nobody just creates the invitation with the code stored.
- **Conversion** (`domain/connections/convert.ts`, `convertOpenInvitations(orgId)`): when a business that is `active`,
  `findable` and has that code exists, every unconverted open invitation addressed to its code becomes a connection
  request in its inbox (supplier invitation: request supplier to buyer carrying `customer_id` and the price list; buyer
  invitation: request buyer to supplier), once (`converted_at`). Skipped: revoked/expired/used invitations, pairs already
  connected, blocked, waiting or recently declined. It runs after organization creation and add-side, after a link
  sign-up, after admin approval, and lazily on each load of the connections panel (so switching findable on lets pending
  invitations through). Failures are logged, never thrown. Approving such a request connects the **invited row**
  (`connection_requests.customer_id`, else a row with the buyer's code) instead of creating a second customer, and revokes
  its links; using the link instead marks a waiting request approved.
- Not built yet: name search.

## Several companies under one login (2026-11-13)

A group that runs several legal entities (a wine producer with brands that each issue their own waybills and
invoices) keeps **one organization per legal entity**, each vetted by the admin on its own legal ID, and one login that
belongs to all of them. Companies are never merged: prices, customers, orders and invoices stay per company.

- **Adding a company** (`/account/add-side?another=supplier|buyer`, sidebar link "add another company",
  `submitAddAnother`, `createOrganizationForUser(..., { addSide: true, additional: true })`): always starts
  `pending_review` (the registration on the sign-in address vouches for the first business only, and the legal ID must
  differ: `legal_id_taken` stays one organization per kind and ID). At most 10 companies of a kind per person
  (`MAX_COMPANIES_PER_KIND`). Without `additional`, a second company of a kind is still `already_has_kind`.
- **Switching**: `SideSwitch` shows a list by company name when a person has several companies (the two-part role
  switch when it is one buyer and one supplier). `/switch` and `/o/<number>` already accept any of the person's companies.
- **All brands** (`domain/suppliers/brands.ts`): `listMyBrands` = the approved supplier companies the person is a member
  of; `scopeOrgIds(ctx, all)` is what the "all" mode reads, **always derived from memberships in the database, never
  from the request**. The supplier order inbox and the loading sheet take `?brand=all` (`BrandScope` toggle, shown only
  with 2+ brands): rows name their brand and open through `/o/<number>` (which switches company first); the sheet sorts
  by customer so one drop's brands sit together, each stop labelled with its brand (one waybill per brand). Catalog,
  prices, customers and order actions stay inside one company at a time.
- **One customer, several brands**: in the connections panel a supplier with other approved companies can tick them
  and `sendConnectionRequestsForBrandsAction` sends one request from each (as that company, its default price list);
  the customer approves each separately. Invitation links are not multi-brand.
- No combined buyer cart: a buyer orders from each company separately.

## Team access (2026-11-13)

Several people work in one company, **each with their own email and password** (never a shared login: no audit trail,
one inbox for alerts, password changes when someone leaves). `domain/team/team.ts`, `/supplier/team` and `/buyer/team`
(`components/team/*`, sidebar link and phone-header icon), shared actions in `app/team/actions.ts`.

- **An owner adds a colleague by email, no 202 approval** (decided 2026-11-13: the company itself was already vetted).
  `inviteColleague` writes a `team_invites` row and lets the address sign in (`allowed_emails` row with note
  `team:<organization id>`, `intended_role` = the company's kind; an address the admin already registered keeps its own
  row; one the admin **blocked** stays blocked: `blocked`). The colleague gets a one-time sign-in link directly
  (`server/auth/team-invite-email.ts`, never stored or logged, Georgian) and **joins at their first sign-in**
  (`claimTeamInvites`, called by `completeSignIn` and by `/start`, so an already signed-in person joins on their next
  visit). 20 invitations per hour per company; at most 20 people (members + open invitations); only `active` companies.
- **Roles:** `owner` (manages the team) and `member`. In this version the **only** thing restricted to owners is the team
  itself; every member can work with orders, the catalog, prices and customers. Restricting prices/customers per role
  would need role plumbing through every supplier domain function: not built.
- A company always keeps at least one owner (`last_owner`); anyone may leave; an owner removes anyone. Removing a person
  (or cancelling an invitation) revokes the allow-list row **only** when it was created by a team invitation and nothing
  else needs it (no other company, no open invitation); an admin-registered address is never revoked here. Guards read
  memberships from the database on every request, so removal is immediate. Every invite, join, revoke, removal and leave
  is audited (`team.*`).
- A person who owns several companies can add a colleague to several at once (checkboxes limited to companies of the
  same kind the caller **owns** and that are approved; anything else in the input is ignored).
- Members see the team list (names, emails, roles); only owners see open invitations and the add form. The privacy text
  mentions it.

## E-waybills, phase 1 (2026-11-17)

RS.ge e-waybills were out of scope until asked; the user asked on 2026-11-17 and agreed to **phase 1 only**:
`/supplier/orders/<id>/waybill` (`domain/orders/waybill.ts` `getWaybillSheet`, `components/orders/waybill-sheet.tsx`,
button on a confirmed/delivered order and a link per stop on the loading sheet). It shows, for one confirmed order,
what a waybill needs: seller and buyer with their identification codes, delivery address and the agreed day, and the
goods that were **confirmed** (lines at 0 are left out; VAT per line from `computeTotals`), each with a copy button, a
"copy goods table" (tab separated, dot decimals, for Excel) and print.

- **202 sends nothing to RS.ge and stores nothing about the waybill.** The driver, vehicle and loading address the
  supplier types are kept in `localStorage` of that browser only (the supplier's company has no warehouse address in
  the schema, so it is typed once; no migration was needed).
- Seller side only: another company's order, or an order still pending/rejected/cancelled, is `NotFoundError`.
- **The buyer's identification code is shown to the supplier it ordered from** (needed to name the buyer on a waybill);
  the privacy text says so. It is still never shown to anyone the buyer has no order with.
- **Phase 2 (API) is not built.** RS.ge's SOAP service (`services.rs.ge/WayBillService/WayBillService.asmx`: `save_waybill`,
  `send_waybill`, `close_waybill`, `get_waybill_units`, ...) needs a per-company *service user* that RS.ge ties to **one fixed
  IP address**, so calls would have to come from a fixed address (Vercel's are not), RS.ge unit codes must be mapped, and a
  waybill is a legal tax document that cannot be tested against production. Decide the fixed IP and a test user first.
  Credentials found in third-party repositories must never be used.

## E-waybills, phase 2: sending to RS.ge (2026-11-17, built, **not yet run against RS.ge**)

Details, safety design and the first-test checklist: [`docs/rsge-integration.md`](docs/rsge-integration.md). Summary:

- **Off unless `RSGE_ENABLED=1` and `RSGE_ENCRYPTION_KEY` are set** (`rsgeEnabled()`); without them the waybill page is
  exactly phase 1. Code: `src/server/rsge/` (`client.ts` SOAP client with an injectable transport, `crypto.ts`),
  `src/lib/rsge-waybill.ts` (XML builder, unit and VAT mapping, fails closed), `src/lib/rsge-xml.ts`,
  `domain/waybills/rsge.ts`, tables `rs_connections` (encrypted service user) and `order_waybills` (migration 0035).
- Owner connects the company's service user in Settings; RS.ge's tax id for it must equal the company's legal id.
  Sending is two steps (save draft, then activate); one waybill per order; a row lock stops double sends.
- **RS.ge ties a service user to one fixed IP**: `ops/rsge-relay/server.mjs` is the fixed-IP forwarder
  (`RSGE_RELAY_URL`/`RSGE_RELAY_SECRET`). **The XML field names and RS.ge's answer shapes are unverified** (the WSDL types the
  waybill as "any XML"); one supervised test with a real service user is required before real use.
- 0% VAT lines go to RS.ge as VAT-exempt; only 18% and 0% are supported; credentials are never logged or audited.

## Dashboards (2026-11-17)

The three home pages were reworked (decided 2026-11-17: modern B2B pattern, "work queue first, numbers second"). Each is a
presentational component in `components/dashboard/` (`SupplierToday`, `BuyerHome`, `AdminOverview`) that takes its data as
props; the page under `app/` only guards, loads and passes it, so a fixture can render it without a database.
Building blocks: `Panel`/`PanelRow` (titled block with rows), `SparkBars`/`BarRow`, `OrderProgress`.

- **Supplier home** (`/supplier`, nav label stays "Home"; the order-value chart prints its first and last date and a legend, a day with no orders is a hairline): "waiting for your answer" queue (oldest first, amber after 4 h),
  next delivery days with a loading-sheet link each (days already past are marked overdue), order value of the last 30 days
  with a daily bar chart, week-on-week change, repeat customers, top products as proportional bars. Data:
  `domain/orders/today.ts` (`listPendingQueue`, `listUpcomingDeliveries`, `getOrderValueSeries`, `getSupplierClock`) plus
  `getSupplierMetrics`. Definitions stay printed next to each number and the "not revenue" caption stays.
- **Loading and empty states** (2026-11-19): while a dashboard loads, `DashboardSkeleton` (`components/dashboard/skeletons.tsx`)
  draws the same two columns of panels (the `Skeleton` tone is `bg-border/70`, visible on both themes). A supplier with **no orders
  at all** sees the `GetStarted` checklist (`components/dashboard/get-started.tsx`, data from `getSetupProgress` in
  `domain/orders/today.ts`: products, price lists, customers that are invited or active) instead of an empty box; each step ticks
  itself off, and while the company is `pending_review` the invite step says it opens after approval. The chart's best-day legend
  only shows once there is something to show; the loading sheet is opened from each delivery day (there is no header button). A buyer with no suppliers gets "Find a supplier" and
  "Invite a supplier" buttons.
- **Dashboard grids use `grid-cols-[minmax(0,1fr)]` below `lg`** (2026-11-20): a plain `grid` has one `auto` column that grows to the widest non-wrapping child (an action button), which made the admin overview 22px wider than a 320px phone; the e2e `bottom-nav` spec caught it.
- **Review in a side panel** (`components/orders/review-sheet.tsx`): "Review" on a queue row opens a native modal `<dialog>`
  (focus trap, Escape and backdrop close it) that loads the order with `loadOrderReviewAction` (supplier-only, other
  company's order = not found, formatted on the server) and reuses `SupplierOrderActions` (confirm with quantities and
  delivery day, reject with reason). `ReviewBody` is the content without the dialog.
- **Phone header** (decided 2026-11-19, `components/app-shell/account-menu.tsx`; changed 2026-11-21): the company name (not the logo)
  with search, bell and one account button (Popover API) that holds Administration (platform admins), Settings (suppliers), team,
  change password, the theme choice and sign out; the sidebar still shows them directly. A buyer has no header magnifier: the
  Search tab is their one place to search.
- **Buyer home**: search, regular orders (accent block when due today), "in progress" orders with a Sent / Confirmed /
  Delivered strip and the agreed delivery day (with the open total under the list), recent orders with reorder (the ones already in progress are not repeated; on a phone the button sits under the text), often-ordered products, suppliers with the
  last order date (`lastOrderDates`) and "find a supplier".
- **Admin overview**: "needs attention" (new supplier requests, businesses waiting for verification, stalled notifications
  via `checkHealth`, or an all-clear line), then pilot health (a bar only where there is a real ratio, the reorder rate)
  and the 30-day order split.
- **Live queue** (decided 2026-11-18): the open supplier dashboard and order inbox mount `LiveOrders`
  (`components/orders/live-orders.tsx`), which polls `GET /api/supplier/pulse` (`getPendingPulse`: pending count + a
  fingerprint, scoped to the acting company, guarded like any supplier page) every 20 s (60 s in a background tab, at once when
  the tab returns) and calls `router.refresh()` when the queue changed. **Polling, not Supabase Realtime, on purpose**: the
  browser never talks to Supabase and RLS has no policies. It never refreshes while a `<dialog>` is open, shows a short
  "new order received" notice (kept until closed), puts the waiting count in a background tab's title, and stops after 3 failures (signed out,
  offline). Other supplier pages are not live.
- **Bulk actions on the product list** (decided 2026-11-18, `components/catalog/product-bulk.tsx`, `bulkProductsAction`,
  `bulkSetActive` / `bulkSetCategory` / `bulkDeleteProducts` in `domain/catalog/products.ts`): row checkboxes (server-rendered rows,
  client checkboxes over a `BulkSelection` context) and a select-all for the page; once something is chosen a bar offers Enable,
  Disable, Delete (a dialog summing the usage of the chosen products, same wording as the single delete) and "move to category"
  (archived categories refused). Selection is limited to the current page and at most 100 ids per action; ids that are not this
  company's are silently skipped (never counted); a suspended company is refused; delete audits each product. Hidden for suspended
  companies.
- **Limits and audit on the live queue and bulk actions** (2026-11-20): `/api/supplier/pulse` answers 429 past 120 requests a minute per company (`RATE_LIMITS.supplierPulse`; the poller backs off on any non-OK answer); bulk show/hide/category/delete share 20 calls a minute per company (`RATE_LIMITS.bulkProducts`); bulk show, hide and category moves are audited (`product.bulk_shown|bulk_hidden|bulk_category`, with a count), as delete already was.
- **Saved list filters** (decided 2026-11-19, table `saved_filters` migration 0036, `lib/saved-filters.ts` pure,
  `domain/filters/saved-filters.ts`, `components/catalog/saved-filters.tsx`): on the supplier product list a person saves the
  filters now applied (search, category, status, stock) under a name and applies it again in one tap. Stored **per user and per
  company** (so the same views are on the phone and the desktop), as a canonical query string built from a whitelist both on save
  and on read, so a stored view can only ever carry those four filters. A view is an ordinary link; the active one is highlighted;
  at most 20 per person and company (`too_many`), names unique (`name_taken`), nothing to save without a filter
  (`nothing_to_save`). The `list` column leaves room for other lists (today only `products`). Hidden for suspended companies.
- **Command palette** (decided 2026-11-19, `components/app-shell/command-palette.tsx`, `app/palette/actions.ts`,
  `domain/search/palette.ts`, `lib/palette.ts`): Ctrl/Cmd+K (or the "Search" field in the sidebar, the magnifier in the phone
  header for suppliers and admins) opens one `<dialog>` mounted in `AppShell`. It lists the menu pages ("Go to", from the same `itemsFor` as the nav) and
  a few quick actions, filtered as you type; from two characters it also asks `paletteSearchAction` (guarded by `requireOrg`,
  scoped by the context, rate limited 240/min per person, debounced 200 ms) for the acting company's own matches: a supplier's
  products and customers, a buyer's connected suppliers, and an order by number ("GST-1004", "1004", opened through
  `orderLinkTarget` so only your side's orders resolve). Only names, ids and a short hint leave; no prices or contacts. The
  admin area has pages and actions only (no entity search). Arrows, Enter and Escape work; results never need the mouse.
  Adding a menu page needs no palette change; adding a quick action means an entry in the component and `palette.actions.*`.
- **Web Push for new orders** (decided 2026-11-19, migration 0037, `lib/push.ts`, `server/notifications/push.ts`,
  `server/notifications/channels/push.ts`, `server/domain/push/subscriptions.ts`, `app/push/actions.ts`,
  `components/push/push-settings.tsx`, `public/sw.js`, `app/manifest.ts`): a person turns notifications on for a browser (a "Get new
  orders on your phone" card on the supplier home, a full card with "send a test" in the notification settings on both sides). It is
  a **third outbox channel** next to email: every event that reaches a person also queues a `push` delivery if they have at least one
  subscription (`planRecipients` `pushUsers`), sent later by the same cron/outbox with the same retries; the text is Georgian, rendered
  at send time (title, the other side's name, total) and travels encrypted to the browser's push service. **Off unless
  `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set** (`npm run push:keys` makes a pair; keep it, a new pair invalidates every
  subscription; `VAPID_SUBJECT` optional, defaults to the app URL); without them the UI is hidden and deliveries are `skipped`.
  **The browser chooses the endpoint the server posts to, so only the push services' hosts are accepted** (`isAllowedPushEndpoint`,
  https, no port or credentials, tested). One row per browser (`push_subscriptions`, endpoint unique: signing in as someone else on the
  same browser moves it), at most 10 per person, 404/410 from the push service deletes the row. The service worker shows the message
  and opens an internal path only: with a window already open it focuses it, messages the page (`PushNavigation` in the shell
  follows an internal `202:navigate` URL, because an iPhone web app can ignore `WindowClient.navigate`), tries to navigate it, and
  falls back to `openWindow`. **iPhone only receives web push from an installed web app**, so the card explains "Add to Home
  Screen" there (`app/manifest.ts`, icons from `npm run brand:icons`). The privacy text lists the push services as processors.
- Planned next, not built: nothing queued.

## Photo background remover

`components/catalog/background-remover.tsx`, `lib/image/background-removal/*`.
On the product form and the image manager, a chosen photo can be cleaned before
it is uploaded: the subject is cut out and centred on a flat white 1200px square
(a JPEG named `<name>-clean.jpg`). The supplier sees before and after and picks
one; only the chosen file is uploaded, through the normal image action.

- **It runs on the supplier's device.** A module Web Worker runs BiRefNet-lite
  (MIT, ONNX) with `onnxruntime-web` on **WebGPU**; the photo is never sent
  anywhere. **There is no CPU fallback on purpose**: at 1024x1024 the model needs
  more working memory than a browser's WebAssembly can address (`std::bad_alloc`,
  measured). No WebGPU = a short "not available" note instead of the button.
- **The model** (114 MB fp16 when the device has `shader-f16`, else 224 MB fp32)
  is fetched from Hugging Face by the browser once, pinned to a commit and
  **verified against a SHA-256** (`config.ts`) before use, then cached in Cache
  Storage. That is why the CSP `connect-src` names `huggingface.co`/`*.hf.co`
  (the one exception, asserted in `tests/unit/security-headers.test.ts`), why
  `script-src` has `'wasm-unsafe-eval'`, and why the privacy text mentions it.
  To change the model, update the revision, size and hash together.
- **onnxruntime's `.wasm`/`.mjs` (the asyncify and jspi builds) are served from `/ort/`**, copied from `node_modules` by
  `scripts/copy-ort.mjs` (`predev`/`prebuild`; git-ignored, ESLint-ignored). Do
  not install `@huggingface/transformers`: it drags in `onnxruntime-node`
  (about 550 MB) for nothing.
- A cut-out that kept almost nothing or almost everything (`maskCoverage`) is
  flagged to the supplier. The pure maths is unit-tested (`math.ts`); the browser
  run is `tests/e2e/background-removal.spec.ts`, which only runs with
  `E2E_BG_MODEL_DIR` and `E2E_BG_PHOTO` set and **needs a real GPU**: software
  WebGPU (SwiftShader) crashes on this model, so it was only driven up to the
  button in the cloud sandbox. Run it, or try the feature by hand, on a machine
  with a GPU.

## Launch specifics (milestone 6)

- **Dashboards** compute from real rows only, with each number's definition
  printed under it (`components/ui/stat-tile.tsx`). Supplier
  (`domain/metrics/supplier.ts`): pending now; orders in the last 7 days vs the
  7 before; confirmed + delivered **order value**, 30 days; top 5 products by
  confirmed quantity; buyers with ≥2 orders in 30 days. Admin pilot metrics
  (`domain/metrics/pilot.ts`): active supplier = received ≥1 order in 30 days;
  active buyer = ordered in 14 days; weekly reorder rate = buyers in both of the
  last two weeks ÷ buyers in the earlier week; a "week" is a rolling 7 days.
  All take an injectable `now`, and the tests use a far-future `now` so only
  their own fixture falls in the windows. Never call these numbers revenue.
- **Buyer dashboard**: open orders, last 5 with order again, the 10 most-ordered
  products (orders containing them; current prices, only what is still
  orderable) with the cart stepper, connected suppliers.
- **Admin support tools** see contact and status information, never price lists
  or catalogs. Buyers are suspended/reactivated in `domain/admin/organizations.ts`
  (suppliers keep `reviewSupplier`); the order lookup (`domain/admin/orders.ts`)
  writes an `order.view` audit row in the same transaction as the read.
  `ReviewPanel` takes the server action as a prop so both kinds share it.
- **Rate limits** (`server/security/rate-limit.ts`, rules in `RATE_LIMITS`):
  order submit 10/min/org (a repeated idempotency key doesn't count), invite
  create or regenerate 30/h/supplier, invite accept 10/min/IP (hashed, in the
  action: it knows the headers), image upload 300/h/supplier (an import attaches a photo per product), payment
  terms requests 10/h/buyer (each emails the supplier). Over the limit
  throws `StateError("rate_limited")`; every UI maps that code. The cron route
  prunes old windows.
- **Suspended buyers can't submit** (`buyer_suspended`, read from the database,
  not the request context).
- **Headers** are static in `next.config.ts`. The CSP keeps `'unsafe-inline'`
  for scripts and styles (Next's inline scripts; nonces would force dynamic
  rendering of every page). Tighten it only together with a rendering change.
- **Streamed not-found**: a guard that fails inside `<Suspense>` shows the
  not-found page but the HTTP status is already 200. Tests assert the visible
  heading, not the status. Don't rely on the status code for anything.
- **Error boundaries**: `app/error.tsx` and one each under `buyer/`,
  `supplier/`, `admin/` render `components/route-error.tsx`, so the shell
  survives a failing page.
- **Mobile**: tap targets ≥44px at phone width (`Button size="sm"` and the
  filter pills grow below `md`); don't put `whitespace-nowrap` buttons with long
  Georgian labels in narrow containers (the WhatsApp button wraps). The launch
  e2e checks horizontal overflow and control heights at 360px.
- **Order lines on a phone** (2026-11-19): the buyer's cart lines and the order detail lines (`OrderView`, both sides) are stacked lists
  below `sm` (name and price first, then quantity control and line total on one row); a table or one flex row left the product name a
  few letters wide at 360px. From `sm` up they are the row and the table they were.
- **Contrast** is a unit test (`tests/unit/contrast.test.ts`) over the tokens in
  `globals.css`, light and dark. Changing a colour token means the test tells
  you whether it still passes AA. Text on a brand fill uses
  `text-brand-foreground`, not white.
- **Seed**: `scripts/seed-dev.ts` stubs `server-only` itself (the
  `react-server` condition would break `next-intl`) and goes through the real
  domain functions, so seeded data obeys every rule. The host check lives in
  `scripts/seed-guard.ts` and is unit-tested.
- **Playwright quirk**: a test title containing non-ASCII arrows (`→`) made
  `setInputFiles` silently not fire React's change handler (the output folder
  name carries the title). Keep e2e test titles ASCII.

## Operations (health and backups)

Details and the restore drill are in [`docs/backups.md`](docs/backups.md).

- **`GET /api/health`** is public and excluded from `proxy.ts`, so it never
  depends on the auth provider. 200 when the database answers and no queued
  notification is over 15 minutes overdue; 503 otherwise (`server/health.ts`).
  It returns status words only: no counts, hosts or error text.
- **Nightly backup** (`.github/workflows/db-backup.yml`): encrypted dump of
  `public` + `drizzle` and an id/email-only export of `auth.users`, restored
  into a scratch Postgres before it is kept. The dump needs the Supabase
  **session** pooler (port 5432), not the transaction pooler.
- **Sentry** (`src/instrumentation.ts`, `instrumentation-client.ts`,
  `global-error.tsx`, `lib/sentry-*.ts`). Errors only: no tracing, no session
  replay (it would record other businesses' prices), no default PII. With no
  `NEXT_PUBLIC_SENTRY_DSN` nothing initializes and every Sentry call is a
  no-op, so local runs and CI send nothing.
  - **Everything passes through `lib/sentry-scrub.ts`** (`beforeSend` and
    `beforeBreadcrumb`): request cookies, headers, bodies and query strings,
    user identity and `extra` are removed; emails (also URL-encoded) and
    token-like strings in messages become `[email]` / `[token]`;
    `/invite/<token>` becomes `/invite/[token]`; Next's own
    `contexts.nextjs.request_path` (which carries the query string) is scrubbed
    too. Record ids (UUIDs) are kept. This is the "never log tokens, magic links,
    invite URLs, cookies or request bodies" rule applied to a third party. A new
    place that can hold a URL or user input (a new context, a tag) needs a rule
    and a test in `tests/unit/sentry.test.ts`.
  - Server errors arrive through `onRequestError`; `runAction()` reports the
    "unknown" case itself because that error never reaches it; the client error
    boundary reports browser render errors only (server ones carry a `digest`
    and were already sent).
  - The CSP `connect-src` gets the DSN's ingest origin at build time
    (`next.config.ts`), or browser reports are blocked.
  - Source maps upload only when `SENTRY_AUTH_TOKEN` is set, so `npm run build`
    still works with no environment.
  - `package.json` `overrides` pins `glob` to 14.0.3 under
    `@sentry/bundler-plugins` (build tooling) to clear moderate advisories; it
    only uses the plain `glob(patterns, options)` call. Drop the override when
    Sentry ships a patched plugin, and re-run `npm audit --omit=dev`.
  - Version 10.78.0 is pinned: 11.x pulled in the advisory-affected packages
    with no override-free fix at the time.
- **Nothing may hang a request** (audit 2026-11-10: admin pages hit Vercel's 300-second timeout 19 times
  in a week). The database pool (`server/db/client.ts`) closes idle connections after 5 s, replaces each
  connection after 5 minutes and gives up connecting after 10 s, because a socket left in a frozen
  serverless instance can be dead when it wakes. Calls to Supabase Auth (`server/supabase/timed-fetch.ts`,
  also in `proxy.ts`) and to Resend have a fetch deadline. A new outbound call needs one too.
- The browser-side `NextIntlClientProvider` (`ClientIntl`) gets the server's `timeZone`; without it next-intl
  logs `ENVIRONMENT_FALLBACK` on every render (63 times in production before the fix).
- `scripts/ops/*.sh` are Linux shell scripts for CI and restore drills. They
  are deliberately not npm scripts, which must stay cross-platform.
- Not in the backup: Storage images, the cron job and Vault secrets, passwords.

## Legal pages (terms and privacy)

`/terms` and `/privacy` are static public pages rendered by
`components/legal/legal-document.tsx`. The wording is in `messages/ka.json`
under `legal` (sections are arrays of `{ title, paragraphs, items, closing }`),
never in components. Linked from the landing footer, the sign-in page and the
supplier request form.

- **Drafted from what the product does, not reviewed by a lawyer.** Have one
  read both before real partners sign in.
- **The operator block is not in the repo.** `lib/legal.ts` reads
  `LEGAL_ENTITY_*` at build time and leaves the block out when
  `LEGAL_ENTITY_NAME` is unset. Never hardcode a company name or address.
- **Claims must stay true.** The policy says: only essential cookies (session, the buyer/supplier side chosen with `gusto-org`, the language `gusto-locale`), no
  analytics or ads, IP addresses kept hashed and pruned within a day, backups
  kept about 14 days, admins never see catalogs or price lists, and lists the
  processors (Supabase, Vercel, Resend, Sentry) and the one-off model download from Hugging Face. When you add analytics, error
  monitoring (Sentry), a new processor, a new kind of personal data or change
  retention, update `legal` **and** `LEGAL_UPDATED` in `lib/legal.ts`.
  `tests/unit/legal.test.ts` ties the 14-day claim to the backup workflow.
- There is no recorded consent: the sign-in and request-form notes only link to
  the documents. Recording acceptance would need a schema change; ask first.

## Public demo

A separate Vercel project (`gusto-demo`) and Supabase project (`gusto-demo`)
hold fictional data for showing 202 to partners. Nothing in the real
deployment depends on it.

- **`DEMO_MODE=1`** (server env) turns on the banner, the demo accounts on
  `/login`, `noindex` and a disallow-all `robots.txt` (`src/lib/demo.ts`).
  `DEMO_PASSWORD` is the shared password shown on the login page.
- **Data** comes from `scripts/seed-dev.ts` run on a scratch local database,
  stored as JSON in `demo.demo_snapshot` on the demo project.
  `demo.reset()` (a `security definer` function guarded by `demo.marker`) wipes
  tenant data, recreates the four demo auth users and reloads the snapshot.
  pg_cron runs it nightly (`gusto-demo-reset`, 01:00 UTC). Platform admins are
  kept.
- **Logins**: `supplier@demo.gusto.example` and `restaurant@demo.gusto.example`;
  the other two demo users have random passwords.
- **Never** create `demo.marker` on a real project: that is what lets
  `demo.reset()` delete everything.

## Landing page

`src/app/(public)/page.tsx` plus `src/components/landing/`. A light, product-first
page (Stripe-style structure): floating blurred pill nav, a hero with the
supplier's order list and the buyer's phone, an interactive four-tab product
tour, supplier and buyer sections that each pair short copy with a drawn
interface, a dark trust band and a closing call to action.

- **Everything on screen is a drawn mock-up with fictional data**, labelled as
  such in the hero (`demo`). No screenshots, no invented metrics. Amounts go
  through `formatMoney`; the demo numbers live in `components/landing/panels.tsx`.
- **Styles are scoped under `.lp`** in `landing.css` (plain CSS, class names are
  generic like `.btn` and `.pill`, so never import it outside the landing page).
  Burgundy is for meaning only: links, hover and focus, and nothing decorative.
- **Fonts:** Google Sans (Latin, digits and Georgian, `landing-font.ts`, variable `--font-landing`)
  with Noto Sans Georgian as the fallback. Only the landing page loads it; the app keeps Inter + Noto Sans Georgian.
- **The brand is "202"** (renamed from Gusto on 2026-11-10; domain 202.ge). The wordmark is the number "202" in
  Nunito ExtraBold (800), tight letter-spacing, burgundy `#7A1F2E`, as outlines in
  `public/brand/202-wordmark.svg`, used everywhere through `components/logo.tsx` (size it with a height
  class; white in the dark theme). Designs: cream `#F8F2EC` on burgundy for the dark/inverse version, tagline
  "orders, accepted." (not used in the product yet). The favicon and app icon (`src/app/icon.svg`,
  `apple-icon.png`, `favicon.ico`) are generated by `npm run brand:icons` (`scripts/gen-icons.mjs`): cream "202"
  on burgundy, rounded square (22.5%), flat. Don't hand-edit them; re-run the script if the brand changes. The
  auth email header is not an image: white "202" text on a burgundy block (`supabase/templates/magic-link.html`,
  pasted into Supabase by hand, currently `#7a1f2b`, the app's `--brand` token), so nothing has to load.
  `public/brand/gusto-wordmark.png` stays because the demo project's older template still points at it.
  **Only the visible name changed.** Identifiers keep the old name on purpose: the repo, npm package, the
  cookies `gusto-locale`/`gusto-theme`/`gusto-org`, Vercel/Supabase project names, `@test.gusto.ge` test
  emails and the `GST-` order prefix (renaming cookies would reset everyone's language and side).
- **Scroll motion** is deliberately plain (`components/landing/reveal.tsx`,
  `scroll-depth.tsx`, no animation library): blocks below the fold fade and
  settle once when clearly on screen, grouped items follow one after another
  (`stagger`), mock-ups settle in from the side, and the hero's layers drift at
  different speeds. The server renders everything visible; the hidden state is
  armed on the client only below the fold, so no JavaScript or print
  means nothing is ever hidden. Reduce Motion keeps the fade but drops the
  movement and the hero drift (many Windows machines report it just because OS
  animations are off). Add motion with `Reveal`, never with
  per-element animations.
- **Server renders, client interacts:** `ProductTour` (tabs, autoplay that stops
  on the first click, off for reduced motion) and the nav are client components;
  the panels are rendered on the server and passed in, so nothing formats on the
  client.
- **Hyphens only:** user-visible text uses the standard `-`, never an em or en
  dash. The landing e2e test checks the page text for them.

## Testing approach

- **Integration tests use plain Postgres** with a stand-in `auth.users` and
  the `anon`/`authenticated` roles, created by
  `tests/integration/global-setup.ts`. They call domain functions directly,
  passing a user ID.
  - Guards and Server Actions need a Next.js request, so they are covered by
    e2e instead.
  - The stand-in has only the `auth.users` columns our code reads. If code
    starts reading another column, add it there.
- **`tests/integration/rls.test.ts` must keep passing:**
  - every `public` table has RLS enabled;
  - `anon`/`authenticated` see no rows and cannot write.
- **E2E signs users in via the Supabase admin API** (after putting the address on `allowed_emails`, since sign-in is invite-only) (`generateLink` → visit
  `/auth/confirm?token_hash=…`). There's no inbox and no test-only route in
  the app. Never add a test-only auth bypass to the app.
- **Integration helpers** (`tests/integration/helpers.ts`): `createSupplier`,
  `createBuyer`, `createAdmin`, `createTestCategory`, `createTestProduct`,
  `connectBuyer` (invite + accept),
  and `memoryStorage()`, an in-memory `ImageStorage`. Image processing
  itself is always real `sharp`.
- **E2E flows** (`tests/e2e/flows.ts`): admin with a category, supplier/buyer
  onboarding, approval, product creation — all through the real UI.
- **E2E file inputs:** wait for `networkidle` before `setInputFiles`, so
  React has hydrated and attached its change handler.
- **Test data** uses `[TEST]` / `[E2E]` name prefixes and `@test.gusto.ge`
  emails.

## Working on this repo

- **The developer's machine is Windows/PowerShell.**
  - Keep npm scripts cross-platform: no `rm -rf`, no `VAR=x cmd`, no bash-only
    syntax. Use small Node scripts or `cross-env` if needed.
  - When a one-off `node -e` would need nested quotes, write a scratch `.js`
    file instead.
- **Before you finish any task:** run lint, typecheck, unit tests and build.
  Report what actually ran and what failed. Never report an unexecuted test as
  passing.
- **Update this file** when a decision changes or a convention is added.
  Remove anything that stops being true.
