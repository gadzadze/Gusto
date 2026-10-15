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
11. **Sign-in is invite-only.** Nobody registers themselves. An address may get a
    sign-in link only if it is on `allowed_emails` (not revoked), or follows a
    valid invitation link, or holds a valid invitation addressed to it
    (`server/auth/allow-list.ts`). Supabase sign-ups are switched off, so the
    app creates auth users itself (`server/supabase/admin.ts`) for allowed
    addresses only. `completeSignIn` re-checks and signs out anyone not
    allowed, which is the only gate for Google. A revoked row beats an
    invitation. Admins manage the list at `/admin/access`; scripts use
    `npm run user:allow`. Being allowed gives no role, but the admin may pin
    `allowed_emails.intended_role`: onboarding then offers only that kind and
    `submitOnboarding` / the invite action refuse the other (`wrong_role`).
12. **Partners use their own company address and their own password.** Nobody
    creates accounts or passwords for them. The first sign-in is the emailed link
    (proof they control the mailbox); until `profiles.password_set_at` is set,
    every guard sends them to `/account/password` (`decideAccess` →
    `set_password`). After that: email + password (`submitLogin`), "forgot" =
    the same link landing on `/account/password`, change in the shell. Magic
    link and Google stay as fallbacks. Passwords go straight to Supabase Auth
    (`auth.updateUser`), min 10 characters (`lib/validation/password.ts`,
    `supabase/config.toml`), and are never stored, logged or audited.
13. **The admin vets who is real.** The legal ID (9 digits company / 11 sole
    trader, `lib/legal-id.ts`; format only, the registry lookup is manual) is
    required for both kinds and unique per kind. Two paths:
    - *Pre-registered*: the admin adds the address with business name + legal ID
      (Access page / `user:allow --name --legal-id`). That ID is authoritative
      (`registrationFor`, shown read-only at onboarding) and the organization
      starts `active`.
    - *Unvetted* (no ID on the row, e.g. a buyer arriving through a supplier's
      WhatsApp link): the organization starts `pending_review`. A buyer sees
      only `/pending` (`decideAccess` → `pending`) and `submitOrder` refuses
      (`buyer_not_verified`); a supplier may prepare its catalog but can't invite.
      Admins get an email (`notifyAdminsOrgPending`) and a nav badge, review at
      `/admin/suppliers` or `/admin/organizations?status=pending_review`, where the
      `VerificationCard` shows ID, sign-in address (free-mail warning), who invited.
      Suppliers see "awaiting Gusto verification" on such customers.
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
  belongs to one org in the MVP; the schema allows more.
- `supplier_settings`: `min_order_minor`, `prices_include_vat`,
  `delivery_area`, `delivery_terms`, `order_cutoff_note` (text fields).
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
- `allowed_emails`: the sign-in allow-list (lowercase email, note, optional `intended_role`, optional vetted `business_name` + `legal_id`, `revoked_at`); never deleted from.
- `supplier_requests`: public "onboard me" submissions (business name, legal ID, contact, phone, email, city, note; `status` new/contacted/approved/rejected, admin note, reviewer). At most one open request per legal ID and per email.
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
- **Deletes:** products and orgs are deactivated, not deleted. Order items keep
  their snapshot even if a product row is ever removed.

## Language, search and typography

- **All user-facing text** goes through `next-intl`. Only `ka` ships, but no
  Georgian string literals appear in components, so `en` can be added later.
- **Georgian copy:** short and natural, like a well-made local app, not
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
    (public)/                 landing, login, invite acceptance, /suppliers (request to be onboarded)
    onboarding/               org creation after first sign-in
    supplier/                 supplier area (guarded by layout + every action)
    buyer/                    buyer area
    admin/                    platform admin: overview + pilot metrics, suppliers, organizations, order lookup, audit log, categories
    o/[number]/               order link → redirects to the viewer's own order page, or 404
    api/cron/notifications/   outbox drain (CRON_SECRET)
    auth/callback/            Google OAuth code exchange
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

- **Cache Components is on** (`cacheComponents`, `partialPrefetching`).
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

## Customers and pricing specifics (milestone 3)

- **Price resolution lives only in `server/domain/pricing/resolve.ts`:**
  - `effectivePriceSql(buyerOrgId)` for queries that read `products`;
  - `resolvePrices()` for a set of product IDs.
  - The rule: the override in the price list of the buyer's *active*
    connection, else the base price.
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
- **Bell:** `components/notifications/notification-bell.tsx`, rendered in
  Suspense by `AppShell` for buyers and suppliers. The list lives at
  `/buyer/notifications` and `/supplier/notifications` (shared view);
  clicking a row marks it read and redirects to `/o/<number>`.

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
  action: it knows the headers), image upload 30/h/supplier. Over the limit
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
