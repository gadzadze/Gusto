# Gusto

B2B ordering for HoReCa businesses in Georgia: suppliers put their catalog and
existing customers on Gusto, and those customers reorder in a few taps.

- Product scope, conventions and the security model: [`CLAUDE.md`](CLAUDE.md)
- Build plan: [`docs/milestones/`](docs/milestones/README.md)

**Status:** milestones 1–6 (code complete for the pilot; production deployment not yet performed, see "Implemented, configured, verified").
- Sign-in and onboarding as a buyer or supplier, with role-guarded areas.
- Suppliers build a catalog: products, photos, CSV/XLSX import, order
  terms.
- Admins approve or suspend suppliers and manage categories. All admin
  actions are audited.
- Approved suppliers invite their existing customers with a single-use link
  (copy, or send via WhatsApp) and assign per-customer price lists.
- Buyers join from the link, browse their suppliers' catalogs at their own
  prices, and search across suppliers in Georgian or Latin letters.
- Buyers order from a per-supplier cart; suppliers confirm (adjusting
  quantities), reject or deliver from an order inbox.
- In-app notifications (bell with unread count) and email for order events,
  with per-user email preferences. WhatsApp is a "send" button that opens a
  prefilled message; Gusto never records it as delivered.
- Without `RESEND_API_KEY`, emails (including invitations) are not sent: they
  are logged as `[DEV EMAIL]` and the UI says so.

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v4 ·
Supabase (Auth, Postgres) · Drizzle ORM · next-intl (Georgian) · Vitest ·
Playwright. Hosted on Vercel + Supabase, both in Frankfurt.

## Prerequisites

- Node.js 22+ and npm
- For the full local stack: Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development)
  (`npx supabase …` works without a global install)

## Local setup

```bash
npm install
cp .env.example .env.local     # one file for the app, scripts and tests
npx supabase start             # local Postgres + Auth + Studio + email catcher
```

`supabase start` prints the local API URL and keys. Put them in `.env.local`.
Newer CLI versions print `sb_publishable_` / `sb_secret_` keys; **don't use those**:
the Auth admin API (used to create allowed users) refuses `sb_secret_` with
"invalid JWT". Run `npx supabase status -o env` and use the `eyJ...` keys:

| `.env.local` | From `supabase start` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API URL (`http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` from `npx supabase status -o env` (`eyJ...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` from `npx supabase status -o env` (the long `eyJ...` JWT) |
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | DB URL (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) |

Then:

```bash
npm run db:migrate             # apply Drizzle migrations to the local database
npm run dev                    # http://localhost:3000
```

Magic-link emails are caught by the local mail viewer (Mailpit/Inbucket), at the URL
`supabase start` prints. Google sign-in is off locally unless you configure it
in `supabase/config.toml`.

`supabase/config.toml` was written by hand with only the settings Gusto needs
(ports, redirect URLs, email templates). If your CLI version rejects a key,
run `npx supabase init` in a scratch folder and copy those settings over.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm test` | Unit tests (no database) |
| `npm run test:integration` | Integration tests against `DATABASE_URL_TEST` (wiped on every run) |
| `npm run test:e2e` | Playwright against a production build + real Supabase |
| `npm run db:generate` | Generate a migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL_DIRECT`) |
| `npm run admin:grant -- <email>` | Make an address a platform admin (also allows it to sign in) |
| `npm run user:allow -- <email>` | Let an address sign in (invite-only app); optional `--note "text"` |
| `npm run db:seed` | Fill a **local** database with `[DEMO]` data (refuses anything else) |
| `npm run check:secrets` | After `npm run build`: fail if a server secret is in the client bundle |

## Database and migrations

- The schema lives in `src/server/db/schema.ts`. Migrations are SQL files in
  `drizzle/`, committed.
- To change the schema: edit `schema.ts` → `npm run db:generate` → **read the
  generated SQL** → commit → `npm run db:migrate`.
- Hand-written SQL (RLS, extensions, triggers) goes in a custom migration:
  `npx drizzle-kit generate --custom --name <what>`.
- **Every new table must enable RLS in its migration.** An integration test
  fails otherwise.
- Never use `drizzle-kit push` against a shared or production database.
- `db:migrate` targets whatever `DATABASE_URL_DIRECT` points at. Check it
  before running.

## Tests

**Unit** (`npm test`): pure logic, no database.

**Integration** (`npm run test:integration`): domain logic against a real
Postgres.
- The database must be disposable. The setup **drops and recreates** it, then
  applies the real migrations, so every run also proves the migrations work
  on an empty database.
- It refuses to run unless the host is local and the database name contains
  `test`.
- Plain Postgres lacks Supabase's `auth` schema, so setup creates a minimal
  stand-in: `auth.users` and the `anon`/`authenticated` roles.
- Any local Postgres works:

  ```bash
  createdb gusto_test
  DATABASE_URL_TEST=postgresql://postgres:postgres@127.0.0.1:5432/gusto_test npm run test:integration
  ```

**E2E** (`npm run test:e2e`): drives the production build in Chromium against
the Supabase in `.env.local` (local: `supabase start` + `db:migrate`).
- Test users are created through the Supabase admin API, which also generates
  their magic link. No inbox is needed, and the browser goes through the app's
  real `/auth/confirm` route.
- Needs `SUPABASE_SERVICE_ROLE_KEY`.
- Never point it at production.
- If Playwright's bundled browser isn't installed, set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a Chromium binary.

**Clean-database check.** The app must work with zero rows. The e2e suite is
meant to run against a database that has only had `db:migrate` applied (no
seed): every spec creates its own admin, suppliers and buyers through the UI,
so a green run proves the empty-database path (including empty dashboards).
The persistence spec starts and stops its own web server on port 3101 to prove
orders survive a restart.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and build,
plus the integration tests against a Postgres service container. E2E is not in
CI yet: it needs a running Supabase.

## Supabase Auth setup

Do this for each Supabase project (local is pre-configured in
`supabase/config.toml`).

1. **URL configuration** (Authentication → URL Configuration):
   - **Site URL:** the app URL, e.g. `https://gusto.ge`.
   - **Redirect URLs:** `https://gusto.ge/**`, plus `http://localhost:3000/**`
     for local development against this project.
2. **Email templates** (Authentication → Emails):
   - Set **Magic link** and **Confirm signup** to link to:

     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
     ```

     `supabase/templates/magic-link.html` has the Georgian template.
   - The default templates use a different link format, and sign-in will
     fail with them.
3. **SMTP** (Authentication → Emails → SMTP settings). This is how magic
   links are sent; it is a dashboard setting, not code:
   - Supabase's built-in sender is heavily rate-limited and meant for testing
     only.
   - For production, use Resend's SMTP:
     - host `smtp.resend.com`, port `465`;
     - user `resend`, password = a Resend API key;
     - sender on a domain verified in Resend.
4. **Google** (Authentication → Sign In / Providers → Google):
   - Create an OAuth client in Google Cloud Console (type "Web application")
     with the redirect URI that the Supabase Google provider page shows
     (`https://<project-ref>.supabase.co/auth/v1/callback`).
   - Paste the client ID and secret into Supabase and enable the provider.
   - The app sends users back to `/auth/callback`, which the redirect URL
     pattern above allows.
5. **Data API:** RLS is enabled with no policies on every Gusto table, so
   the Data API exposes nothing. The app never uses it.
6. **Storage:**
   - `npm run db:migrate` creates the public `product-images` bucket (1 MB
     per object, WebP only).
   - There are no storage policies: only the server, using
     `SUPABASE_SERVICE_ROLE_KEY`, can write.
   - Product images are processed on the server and served straight from
     the bucket's public URL.

## Notifications and email

Order events (submitted, confirmed, rejected, cancelled, delivered) write
in-app notifications and email outbox rows **in the same transaction** as the
order change. Delivery happens afterwards, so a mail problem never affects an
order.

- **Email provider:** Resend's HTTP API.
  - `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in
    Resend) enable real sending. This is separate from the SMTP setting
    above, which only covers Supabase Auth's own emails.
  - Without a key, email is **not sent**: it is logged as `[DEV EMAIL]`
    (subject only in production) and the delivery row is marked `skipped`.
- **Delivery:**
  - Right after the response, Next.js `after()` attempts that order's
    pending deliveries.
  - `/api/cron/notifications` (`POST` or `GET`, header
    `Authorization: Bearer $CRON_SECRET`) drains everything due: it claims
    rows with `FOR UPDATE SKIP LOCKED` in batches of 50, retries after 1, 5,
    15 and 60 minutes, then marks the row `failed`. Failures store a short
    `last_error`, never a message body or token.
- **Scheduling (Supabase Cron):** Vercel Hobby cron is too infrequent, so
  migration `0010_notifications_cron.sql` schedules a job named
  `gusto-notifications` every minute with `pg_cron` + `pg_net`. It skips
  itself on plain Postgres. The URL and secret are **not** in the repo; the
  job reads two Vault secrets at run time. Create them once per project
  (SQL editor), **before or after** migrating:

  ```sql
  select vault.create_secret('https://<your-app-domain>/api/cron/notifications', 'gusto_cron_url');
  select vault.create_secret('<same value as CRON_SECRET>', 'gusto_cron_secret');
  ```

  - Change a value later with `vault.update_secret(...)`.
  - Check runs with `select * from cron.job_run_details order by start_time desc limit 10;`
    and responses with `select * from net._http_response order by created desc limit 10;`.
  - If the secrets are missing, the job runs but the request fails (visible
    in `net._http_response`); in-app notifications and `after()` delivery
    still work.
- **Invitation emails** are sent directly when the invitation is created, not
  through the outbox: the text contains the raw invite link, which Gusto never
  stores.
- **WhatsApp** is user-sent only. A future Business API channel is sketched in
  [`docs/whatsapp-business-api.md`](docs/whatsapp-business-api.md).

## Access: sign-in is invite-only

Nobody can register themselves, which keeps spam out. An email address can
request a sign-in link only if:

1. it is on the **allow-list** (admin page `/admin/access`, or
   `npm run user:allow -- someone@example.com --note "Winiveria, owner"`); or
2. the person is following a valid **supplier invitation link** (the single-use
   link is the permission, so a WhatsApp-only invitation works); or
3. a supplier addressed a valid invitation to that email.

Revoking an address (admin page) blocks it, even if an invitation would
otherwise let it in. Everything else gets "this address isn't registered" and
no email, and no account is created.

- **Roles are separate.** Being allowed to sign in gives no role. The person
  onboards as buyer or supplier, and a supplier still waits for your approval at
  `/admin/suppliers`.
- **Where it is enforced:** the sign-in form checks the list before anything
  happens; the sign-in return routes (`/auth/confirm`, `/auth/callback`) check
  again and sign the person out if they are not allowed (this covers Google); and
  Supabase itself has **sign-ups switched off**, so it only has the users the app
  or its scripts created. Local Supabase gets this from `supabase/config.toml`.
  On a hosted project, switch it off yourself: Authentication → Sign In / Providers →
  turn off **Allow new users to sign up**.
- **Existing accounts** at the time this was introduced were added to the list by
  migration `0014`, so nobody was locked out.
- **First admin:** `npm run admin:grant -- you@example.com` now also puts the
  address on the list and creates its auth user, so you do not have to sign in
  first. It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
  `.env.local` (the project it should act on).
- Link requests are rate limited to 10 per minute per IP.

There are no passwords. A business's "credential" is its email address: it
requests a link on the sign-in page and opens it.

## First-run setup in the app

Suppliers can't add products until at least one category exists:
1. Grant yourself admin (below). Everyone else needs an invitation or an entry on `/admin/access`.
2. Add categories at `/admin/categories`.
3. Approve new suppliers at `/admin/suppliers`.

## Seed data (development only)

`npm run db:seed` creates clearly fictional data, every name prefixed `[DEMO]`:
a Tbilisi restaurant, a café, a beverage distributor and a food distributor,
30 products, one custom price list, and seven orders in different statuses
(with their notifications).

- It refuses unless `DATABASE_URL` points at a local host (`localhost`,
  `127.0.0.1`, `::1`) or at a host listed in `SEED_ALLOWED_HOSTS` (for a
  dedicated **dev** Supabase project). It also refuses in production and when
  `[DEMO]` organizations already exist.
- The demo users have invented addresses and cannot sign in. To explore, sign
  in with your own address, then `npm run admin:grant -- you@example.com`.
- Never seed production. The app itself works with an empty database, which
  is how the e2e suite runs.

## Platform admins

There is no admin sign-up.
1. Someone with database access runs (this also lets the address sign in, so the
   person does not need to sign in first):

   ```bash
   npm run admin:grant -- person@example.com
   ```

   This uses `DATABASE_URL_DIRECT` from `.env.local` (or `.env`), and prints
   the database host so you can confirm you targeted the right one.
2. The grant is recorded in `audit_logs`.

## Security measures

- Authorization is in the app: every page, Server Action and Route Handler
  starts with a guard, tenant scope comes from the session, and another
  organization's objects answer "not found". RLS is on with no policies, so the
  Supabase Data API exposes nothing.
- **Rate limits** (Postgres-backed, `rate_limits` table): order submit 10/min
  per organization; invitation creation 30/hour per supplier; invitation
  acceptance 10/min per client IP (stored hashed); image upload 30/hour per
  supplier. A refused attempt shows "too many attempts, try again shortly".
- **Headers** (`next.config.ts`): a Content-Security-Policy that allows this
  app, the Supabase project (for product photos) and self-hosted fonts;
  `X-Frame-Options: DENY`; `Referrer-Policy`; `X-Content-Type-Options`;
  `Permissions-Policy`; HSTS. Scripts and styles need `'unsafe-inline'` because
  Next.js emits inline ones and nonces would make every page dynamic.
- **Secrets**: `npm run check:secrets` scans `.next/static` for the service-role
  key's name and value, other server secret values, and service-role JWTs.
- **Suspended organizations** can't act: a suspended buyer can't order (checked
  against the database, so it takes effect immediately); a suspended supplier
  is read-only.
- **Dependencies**: `npm audit --omit=dev` reports 0 vulnerabilities. `npm audit`
  also lists development-only findings (the ESLint config chain and
  `drizzle-kit`'s bundled esbuild). They never ship to production, and npm's
  suggested "fix" is to downgrade `eslint-config-next` to 14.x and
  `drizzle-kit` to 0.18, which would break this project, so they are left
  until upstream releases fix them.

## Implemented, configured, verified

What this repository does, what you must set up, and what has actually been
exercised. Read the last column before relying on a row.

| Area | Implemented | Needs configuring | Verified so far |
|---|---|---|---|
| Orders, carts, pricing, catalog, import | Yes | Nothing | Integration tests on real Postgres 16; e2e |
| Magic-link and Google sign-in | Yes | Supabase Auth (URLs, templates, SMTP, Google) | e2e against a **stand-in** for Supabase Auth, **not real Supabase or Google** |
| Product photos | Yes (sharp, Supabase Storage) | Bucket is created by migration | e2e against the same stand-in; not real Storage |
| In-app notifications, preferences | Yes | Nothing | Integration + e2e |
| **Email** (orders, invitations) | Yes, via Resend | `RESEND_API_KEY`, `EMAIL_FROM`, a verified sending domain | Request shape tested with a stubbed `fetch`; **no real email has been sent**. Without a key, email is logged and marked `skipped` |
| Notification cron | Yes (route + migration `0010`) | Supabase Vault secrets `gusto_cron_url`, `gusto_cron_secret` | Route tested (401 / drain). The `pg_cron`/`pg_net` job has **never run**: it only ran as a no-op on plain Postgres |
| **WhatsApp** | "Send on WhatsApp" links only | Nothing | The user sends the message; Gusto records nothing as delivered. **Automated WhatsApp sending does not exist** |
| Dashboards, pilot metrics, admin tools | Yes | `admin:grant` for the first admin | Integration (hand-computed fixtures) + e2e |
| Rate limits, headers, bundle scan | Yes | Nothing | Integration tests; headers and scan run on a production build |
| Mobile (360px), contrast, focus ring | Yes | Nothing | e2e overflow and tap-size checks; WCAG AA contrast unit test on the design tokens |
| Payments | **None, by design** | n/a | n/a |
| Production deployment | Checklist written ([`docs/deploy.md`](docs/deploy.md)) | Everything in it | **Not performed.** No Supabase, Vercel or Resend account was available |

## Before inviting real businesses

Software is not the only thing between a pilot and real users. Do these first;
none is done in this repository.

- [ ] **Privacy policy and terms of use, in Georgian**, linked from the sign-in
      page and the footer. Gusto stores names, phone numbers, email addresses,
      delivery addresses and each business's price lists and orders.
- [ ] **A lawful basis for processing personal data** under the Law of Georgia on
      Personal Data Protection, written down (contract performance for
      suppliers and buyers using the service; consent where you add optional
      uses). Have a Georgian lawyer confirm, including whether any registration
      or notification duty applies and what to say about processors (Supabase,
      Vercel and Resend process data in the EU).
- [ ] **A support contact** (email and phone) shown inside the app and in
      invitation emails, and a named person who answers it during the pilot.
- [ ] **Backups**: in the Supabase dashboard (Database → Backups) confirm daily
      backups are on, enable point-in-time recovery if the plan allows, write
      down the retention, and do one test restore into a scratch project.
- [ ] **Supplier terms**: suppliers' price lists are confidential to each
      customer; say so, and say that an order is a purchase request settled
      outside Gusto.
- [ ] **Clean production data**: no `[TEST]`, `[E2E]` or `[DEMO]` rows (the seed
      never runs there), and only the people who should be admins are admins
      (`select email from auth.users u join profiles p on p.id = u.id where p.is_platform_admin;`).
- [ ] **Email deliverability**: send from a verified Resend domain (SPF, DKIM,
      DMARC) and check that invitation and order emails reach a Gmail and an
      Outlook inbox, not spam.
- [ ] **Error visibility**: Vercel failed-deployment alerts on, and someone
      looks at the function logs after the first real orders.

## Deployment (summary)

- **Supabase:**
  - project in `eu-central-1` (Frankfurt);
  - apply migrations with `DATABASE_URL_DIRECT` pointing at the project's
    direct or session connection, then `npm run db:migrate`;
  - configure auth as above.
- **Vercel:**
  - import the repo, region `fra1`;
  - set the variables from `.env.example`, with `DATABASE_URL` = the
    transaction pooler URL (port 6543);
  - deploys happen on push to `main` via Vercel's Git integration.
- `NEXT_PUBLIC_*` values are inlined at build time. Redeploy after changing
  them.

The exact checklist is in [`docs/deploy.md`](docs/deploy.md).
