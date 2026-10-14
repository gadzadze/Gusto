# Gusto

B2B ordering for HoReCa in Georgia. Suppliers (distributors, importers,
producers) put their catalog and their **existing** customers on Gusto; those
customers (restaurants, cafés, hotels) reorder in a few taps instead of over
WhatsApp and phone calls.

The core is free for both sides. There are no payments, no commissions and no
delivery logistics: an order is a purchase request, and the buyer and supplier
settle it the way they already do.

The build plan lives in [`docs/milestones/`](docs/milestones/README.md). Each
milestone is a self-contained prompt. Do them in order, one per session.

## The MVP, and why it is this small

Pilot: **Tbilisi, one product category, 3–5 distributors and their existing
customers.** Georgian UI only. Web app, mobile-first. The pilot succeeds if,
after 6 weeks, at least one supplier receives ≥30% of their orders through
Gusto and buyers reorder weekly without being reminded. Every scope decision
serves that test.

Go-to-market is **supplier-led**: a supplier invites the buyers it already
serves. Buyers do not browse an open marketplace and cannot see a supplier
they are not connected to. This is deliberate. Distributors will not publish
prices openly, and an empty marketplace convinces nobody.

### In scope

- **Supplier:** sign-up and admin approval. Catalog with Excel/CSV import and
  per-customer price lists. Customer invites. Order inbox with
  confirm (quantities adjustable) / reject / delivered.
- **Buyer:** join from an invite, a catalog showing their own prices, one cart
  per supplier, checkout, order tracking, one-tap reorder.
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
  "changes requested" flow, saved lists, analytics charts, multi-language UI,
  native apps.

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
- **Order value is not revenue.** Gusto never knows whether an order was paid.
  Analytics say "order value", never "revenue" or "sales".

## Stack

| Concern | Choice |
|---|---|
| App | One Next.js 16 app (App Router, TypeScript strict), npm |
| UI | Tailwind CSS v4, shadcn/ui, lucide-react |
| Auth | Supabase Auth via `@supabase/ssr`: Google + email magic link |
| Database | Supabase Postgres (region `eu-central-1`, Frankfurt) |
| Data access | Drizzle ORM + `postgres` driver, **server-only** |
| Migrations | Drizzle Kit, SQL files committed under `drizzle/` |
| File storage | Supabase Storage, `product-images` bucket |
| Email | Resend (transactional email + SMTP for Supabase auth emails) |
| Background work | Notification outbox table, drained by a cron-triggered route |
| Validation | Zod at every server boundary |
| i18n | `next-intl`, messages in `messages/ka.json` |
| Tests | Vitest (unit + integration), Playwright (e2e) |
| Hosting | Vercel (region `fra1`), deployed from `main` by Vercel's Git integration |

There is **no separate backend service**. Gusto has no long-lived sockets or
heavy jobs, so Server Components, Server Actions and a few Route Handlers
cover everything.

Do not add a second library for a job already covered above (no Prisma, no
second form library, no second icon set, no state-management library unless a
real need appears).

## Security model — read before touching data access

**Authorization lives in the app, in one place.**

1. The browser never queries the database. The Supabase client in the
   browser is used **only** for auth and nothing else.
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

## Domain model

Tables (snake_case in SQL, camelCase in TypeScript):

- `profiles`: 1:1 with `auth.users`; name, phone (E.164), `is_platform_admin`.
- `organizations`:
  - `type` is `buyer` | `supplier`, immutable.
  - `status`:
    - suppliers: `pending_review` → `active` → `suspended`;
    - buyers: `active` / `suspended`.
  - Also: name, city, phone, `timezone` (default `Asia/Tbilisi`), `currency`
    (default `GEL`).
- `organization_memberships`: user ↔ org, `role` `owner` | `member`. A user
  belongs to one org in the MVP; the schema allows more.
- `supplier_settings`: `min_order_minor`, `prices_include_vat`,
  `delivery_terms` (text), `order_cutoff_note` (text).
- `addresses`: buyer delivery locations.
- `categories`: admin-managed, a flat list for now.
- `products`:
  - owner: `supplier_org_id`; `category_id`;
  - name, description, brand, sku, `unit`, `pack_description`, `image_path`;
  - `base_price_minor`, `vat_rate_bp`, `min_qty_milli`, `qty_step_milli`;
  - `is_active`, `search_text`.
- `price_lists`, `price_list_items`: per-supplier price lists. An item
  overrides a product's base price.
- `supplier_customers`:
  - supplier org ↔ buyer org;
  - `status` `invited` | `active` | `blocked`;
  - `price_list_id` (null means base prices).
- `invitations`: `token_hash`, `expires_at`, `revoked_at`, `accepted_at`, and
  the target supplier_customers row.
- `carts`, `cart_items`: persisted, one cart per (buyer org, supplier org).
- `orders`:
  - `number` (sequence, shown as `GST-1001`), buyer org, supplier org,
    `status`;
  - currency, totals (subtotal, VAT, total);
  - address snapshot, note;
  - `idempotency_key`, unique per buyer org.
- `order_items`: product ID (nullable on delete) plus an **immutable
  snapshot**: name, sku, unit, pack description, unit price, VAT rate,
  `ordered_qty_milli`, `confirmed_qty_milli`, line totals.
- `order_status_history`: order, from, to, actor user, actor org, note,
  timestamp.
- `notifications`: in-app, per recipient user, `read_at`.
- `notification_deliveries`: the outbox. Channel, recipient, payload,
  `status`, `attempts`, `next_attempt_at`, `last_error`, unique `dedupe_key`.
- `audit_logs`: admin and security-relevant actions.

### Order lifecycle

```
pending ──supplier confirms (may adjust qty)──▶ confirmed ──supplier──▶ delivered
   │                                               │
   ├──supplier rejects (reason required)──▶ rejected
   ├──buyer cancels──▶ cancelled                   └──supplier cancels (reason required)──▶ cancelled
```

- Terminal states: `delivered`, `rejected`, `cancelled`.
- Transitions are defined once in `src/server/domain/orders/transitions.ts`
  and enforced on the server inside the same transaction that writes the
  `order_status_history` row.
- Every transition is checked against the current status with a conditional
  update (`WHERE status = $expected`), so two people clicking at once cannot
  both win.

## Conventions

- **Money:** integer minor units (tetri) in `bigint` columns, always with a
  currency code. Never floats. All arithmetic lives in `src/server/domain/money.ts`.
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
  use digits only.
- **IDs:** UUIDs. Human references are `GST-<number>`, and the number is
  never used for authorization.
- **Deletes:** products and orgs are deactivated, not deleted. Order items keep
  their snapshot even if a product row is ever removed.

## Language, search and typography

- **All user-facing text** goes through `next-intl`. Only `ka` ships, but no
  Georgian string literals appear in components, so `en` can be added later.
- **Georgian copy:** short and natural, like a well-made local app, not
  bureaucratic or machine-translated. Use the informal-polite register that
  Georgian product UIs use (e.g. "შეკვეთის გაგზავნა", not
  "გთხოვთ განახორციელოთ შეკვეთის გაგზავნა").
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
- **States:** every list has empty, loading (skeleton) and error states.
- **Avoid:** gradients, emoji as icons, decorative motion, modals for
  multi-step flows (use pages or sheets).

## Project layout

```
src/
  app/
    (public)/                 landing, login, invite acceptance
    onboarding/               org creation after first sign-in
    supplier/                 supplier area (guarded by layout + every action)
    buyer/                    buyer area
    admin/                    platform admin
    o/[number]/               order link → redirects to the viewer's own order page, or 404
    api/cron/notifications/   outbox drain (CRON_SECRET)
    auth/callback/            Supabase auth code exchange
  server/
    auth/                     session, guards
    db/                       drizzle client, schema
    domain/                   business logic by area: catalog, pricing, orders, customers, search, money
    notifications/            outbox, channels (inApp, email), whatsapp-link builder
  components/ui/              shadcn primitives
  components/                 app components
  i18n/, messages/ka.json
drizzle/                      generated + custom SQL migrations
scripts/                      seed-dev, admin-grant
tests/unit, tests/integration, tests/e2e
```

Pages and actions stay thin. They call `src/server/domain/*`, which holds the
rules, so the same rule is never written twice.

## Commands

(Filled in by milestone 1. Keep this section accurate.)

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
- `CRON_SECRET`

Missing optional integrations degrade loudly, not silently. With no
`RESEND_API_KEY`, emails are written to the server log prefixed `[DEV EMAIL]`
and the delivery row is marked `skipped`, not `sent`.

## Database rules

- **Never** run `drizzle-kit push` against a shared or production database.
  Always `generate`, read the SQL, commit it, then `migrate`.
- Extensions (`pg_trgm`), RLS enablement, sequences and other hand-written SQL
  go in custom migrations (`drizzle-kit generate --custom`), committed like
  any other.
- **Never reset, truncate or seed a production database.** Integration tests
  and seeds run only against local Supabase (`supabase start`) or a dedicated
  dev project. The scripts check the host and refuse otherwise.

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
