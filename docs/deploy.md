# Deploying Gusto to production

An exact checklist. Do it top to bottom and tick as you go. Every step names
what to click or run and how to confirm it worked.

> **Status:** this checklist has been written from the code and the
> documentation of each service, but **it has not been executed against real
> Supabase, Vercel or Resend accounts** (the environment it was written in has
> no access to them). Expect to correct small details (button names move) the
> first time, and update this file when you do.

Nothing here needs a code change. `vercel.json` already pins the region.

## 0. Before you start

- [ ] A Supabase account (organization on a plan that includes **daily
      backups**; point-in-time recovery needs the Pro plan or higher).
- [ ] A Vercel account with access to this GitHub repository.
- [ ] A Resend account.
- [ ] The production domain (called `gusto.example` below) and access to its DNS.
- [ ] A Google Cloud project for the OAuth client (only if you want Google sign-in).
- [ ] A machine with Node.js 22+ and a clone of the repo, for running
      migrations and the admin grant. Do **not** run these from CI.

Generate the cron secret once and keep it for steps 4 and 6:

```bash
openssl rand -hex 32
```

## 1. Supabase project

- [ ] Dashboard → **New project**. Region **West EU (Frankfurt) / `eu-central-1`**.
      Strong database password (save it in your password manager).
- [ ] Project Settings → **General**: note the **Reference ID** (`<ref>`).
- [ ] Project Settings → **API**: copy the **Project URL**, the **anon** key and the
      **service_role** key from the **Legacy API keys** tab (JWT-style, starting
      with `eyJ`). The newer `sb_secret_...` key is not a JWT and the Auth admin
      API, which Gusto uses to create allowed users, rejected it when tested
      against local Supabase. Not yet checked against a hosted project, so if
      Supabase retires the legacy keys, re-test before switching.
- [ ] Project Settings → **Database → Connection string**. Copy two strings
      and substitute the password:
  - **Direct connection** (or Session pooler) → this is `DATABASE_URL_DIRECT`
    (used for migrations only).
  - **Transaction pooler**, port **6543** → this is `DATABASE_URL` (used by the app).
- [ ] Database → **Backups**: confirm daily backups are listed; enable **PITR**
      if the plan allows it. Write down the retention period.

## 2. Supabase Auth

Follow README → "Supabase Auth setup" with the production domain:

- [ ] Authentication → URL Configuration: **Site URL** `https://gusto.example`;
      **Redirect URLs** `https://gusto.example/**` (add the Vercel preview URL
      pattern only if you test previews against this project, otherwise leave it out).
- [ ] Authentication → Emails → **Magic link** and **Confirm signup** templates
      use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
      (`supabase/templates/magic-link.html` has the Georgian version).
- [ ] Authentication → Emails → **SMTP settings** (needs the Resend domain from
      step 5 to be verified first): host `smtp.resend.com`, port `465`, user
      `resend`, password = a Resend API key, sender on the verified domain.
- [ ] Authentication → Providers → **Google** (optional): enable, paste the
      client ID and secret; the Google OAuth client's redirect URI is
      `https://<ref>.supabase.co/auth/v1/callback`.
- [ ] Authentication → Sign In / Providers: turn **off** "Allow new users to sign up".
      Gusto is invite-only: the app creates the users it allows (README, "Access").
      With this off, nobody can create an account behind the app's back.
- [ ] Authentication → Rate Limits: leave the defaults unless you have a reason.

## 3. Resend

- [ ] Domains → **Add domain** (use a subdomain such as `mail.gusto.example`),
      add the DNS records it lists (SPF, DKIM, optionally DMARC), wait for
      **Verified**.
- [ ] API Keys → create one key for the app (`RESEND_API_KEY`, "Sending access")
      and, if you like, a second one for Supabase SMTP in step 2.
- [ ] Decide `EMAIL_FROM`, for example `Gusto <orders@mail.gusto.example>`.

## 4. Run the migrations

From your clone, with the **direct** connection string (never the pooler):

```bash
DATABASE_URL_DIRECT='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' npm run db:migrate
```

(Or put it in `.env.local` for this one command and remove it afterwards.)

Verify in Supabase → SQL Editor:

- [ ] Every table has RLS on (expect **0 rows**):

  ```sql
  select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
  ```

  (`drizzle`'s own `__drizzle_migrations` lives in the `drizzle` schema, not `public`.)
- [ ] The image bucket exists and is public (expect one row, `public = true`):

  ```sql
  select id, public, file_size_limit from storage.buckets where id = 'product-images';
  ```
- [ ] The order number sequence starts at 1001: `select last_value from order_number_seq;`
      (before any order exists it shows `1001`).
- [ ] Extensions for the cron job exist: `select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault');`
      (expect 3 rows). If a row is missing, enable it under Database → Extensions
      and re-run `npm run db:migrate` is **not** needed: run the body of
      `drizzle/0010_notifications_cron.sql` once in the SQL Editor instead.

## 5. Cron secrets (Vault) and schedule

SQL Editor, using the secret from step 0 and the final app URL:

```sql
select vault.create_secret('https://gusto.example/api/cron/notifications', 'gusto_cron_url');
select vault.create_secret('<the CRON_SECRET value>', 'gusto_cron_secret');
```

- [ ] `select jobname, schedule, active from cron.job;` shows
      `gusto-notifications | * * * * * | t`.
- [ ] After step 8 (once the app is live), a minute later:
      `select status, start_time from cron.job_run_details order by start_time desc limit 3;`
      shows `succeeded`, and
      `select status_code, created from net._http_response order by created desc limit 3;`
      shows `200`. A `401` means the two secrets differ; a connection error
      means the URL is wrong.

## 6. Vercel project

- [ ] **Add New → Project**, import the GitHub repo. Framework preset **Next.js**.
      Leave build and install commands at their defaults.
- [ ] Settings → Functions: **Function Region** = Frankfurt (`fra1`). (`vercel.json`
      sets the same; check the dashboard agrees.)
- [ ] Settings → Environment Variables, for **Production** (and Preview only if
      you want previews to work against this same project):

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://gusto.example` | No trailing slash. Inlined at build. |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Inlined at build. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | Inlined at build. Safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key | **Sensitive.** Server only. |
| `DATABASE_URL` | Transaction pooler string (port 6543) | **Sensitive.** |
| `RESEND_API_KEY` | Resend key | **Sensitive.** |
| `EMAIL_FROM` | `Gusto <orders@mail.gusto.example>` | |
| `CRON_SECRET` | the value from step 0 | **Sensitive.** Must equal the Vault secret. |

  Do **not** set `DATABASE_URL_DIRECT`, `DATABASE_URL_TEST` or `SEED_ALLOWED_HOSTS` on Vercel.
- [ ] Deploy (push to `main`, or **Deploy** in the dashboard).
- [ ] Settings → Domains: add `gusto.example`, create the DNS records Vercel shows.
- [ ] `NEXT_PUBLIC_*` values are baked in at build: if you change one, **redeploy**.

## 7. Back to Supabase: point everything at the real domain

- [ ] Auth → URL Configuration still shows `https://gusto.example` (step 2).
- [ ] Vault `gusto_cron_url` points at `https://gusto.example/api/cron/notifications`.

## 8. First admin and first data

- [ ] From your clone, grant yourself admin. This also lets your address sign in
      and creates its account, so you do not need to sign in first. It needs the
      production project's URL and service-role key as well as the database
      string; put all three in `.env.local` for this one command (and remove
      them afterwards), and check the host it prints is the production one:

  ```bash
  DATABASE_URL_DIRECT='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_ROLE_KEY='<service key>' NEXT_PUBLIC_APP_URL='https://gusto.example' NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon key>' npm run admin:grant -- you@example.com
  ```
- [ ] Open `https://gusto.example/login`, enter your address and open the link
      (check the email arrives from the Resend SMTP sender).
- [ ] `/admin/access`: register each pilot business's email (supplier owners
      and, if you want them in before any supplier invites them, buyers).
- [ ] `/admin/categories`: add the pilot category (one category for the pilot).
- [ ] **Never** run `npm run db:seed` against this project. It refuses unless
      the host is local or listed in `SEED_ALLOWED_HOSTS`.

## 9. Smoke test (about 15 minutes)

Use two real mailboxes you control (one as supplier, one as buyer) and your admin account.

- [ ] `curl -sI https://gusto.example/login` shows `content-security-policy`,
      `x-frame-options: DENY`, `referrer-policy`, `strict-transport-security`.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://gusto.example/api/cron/notifications`
      prints `401`. With `-H "Authorization: Bearer <CRON_SECRET>"` it prints `200`
      and a JSON object.
- [ ] Anonymous Data API access is closed (expect `[]` or a permission error, never rows):

  ```bash
  curl -s "https://<ref>.supabase.co/rest/v1/organizations?select=*" -H "apikey: <anon key>"
  ```
- [ ] Admin registers the supplier's address at `/admin/access`. The supplier signs in (own mailbox), onboards → appears at `/admin/suppliers` → admin approves. An address that is not registered gets "this address isn't registered" and no email.
- [ ] Supplier adds a product **with a photo** → the photo shows on the product page.
- [ ] Supplier invites the buyer (email field) → the invitation email arrives
      (Resend → Logs shows it) → buyer opens the link, signs in, completes the
      short onboarding → sees the product and its photo.
- [ ] Buyer orders → the order shows `GST-1001`; supplier gets the bell
      notification **and** the email within about a minute (immediately in most cases).
- [ ] Supplier confirms with a changed quantity → buyer gets the email; the
      order totals changed.
- [ ] Admin: `/admin` shows the pilot numbers; `/admin/orders` finds `GST-1001`;
      `/admin/audit` lists the lookup.
- [ ] Delete the test organizations' data if you want a clean start: there is no
      UI for deleting; ask Supabase support or run targeted SQL in the dashboard
      (`delete from organizations where name like '[TEST]%'` cascades; check the
      row count first). Do this **before** inviting real suppliers.

## 10. After launch

- [ ] Set up an uptime check on `https://gusto.example/login` (Vercel or any
      external monitor) and email alerts from Vercel on failed deployments.
- [ ] Put the support email/phone where users can see it (see README, "Before
      inviting real businesses").
- [ ] Run `npm run build && npm run check:secrets` locally after dependency
      updates.
- [ ] Rotating a secret: change it in the provider, in Vercel, and (for
      `CRON_SECRET`) in Vault with `select vault.update_secret(id, 'new')`.
      Redeploy after changing any Vercel variable.

## Rollback

- **App:** Vercel → Deployments → previous good deployment → **Promote to Production**.
- **Database:** migrations only move forward. To undo a bad migration, write a
  new migration; to recover data use PITR/backups (Supabase → Database → Backups).
  Take a manual backup before running a migration that drops or rewrites data.
