# Gusto

B2B ordering for HoReCa businesses in Georgia: suppliers put their catalog and
existing customers on Gusto, and those customers reorder in a few taps.

- Product scope, conventions and the security model: [`CLAUDE.md`](CLAUDE.md)
- Build plan: [`docs/milestones/`](docs/milestones/README.md)

**Status:** milestone 1 (foundation). Sign-in, onboarding as a buyer or
supplier, role-guarded dashboards (empty), admin bootstrap, CI.

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

`supabase start` prints the local API URL and keys. Put them in `.env.local`:

| `.env.local` | From `supabase start` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API URL (`http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
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
| `npm run admin:grant -- <email>` | Make an existing user a platform admin |

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
3. **SMTP** (Authentication → Emails → SMTP settings):
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

## Platform admins

There is no admin sign-up.
1. The person signs in once, normally.
2. Someone with database access runs:

   ```bash
   npm run admin:grant -- person@example.com
   ```

   This uses `DATABASE_URL_DIRECT` from `.env.local` (or `.env`), and prints
   the database host so you can confirm you targeted the right one.
3. The grant is recorded in `audit_logs`.

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

A full step-by-step production checklist arrives in milestone 6
(`docs/deploy.md`).
