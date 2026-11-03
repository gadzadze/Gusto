# Backups and monitoring

Two things protect the production database beyond the host's own features:
a nightly, encrypted, **restore-tested** dump, and a health endpoint that an
uptime monitor watches. Both cost nothing.

## What the nightly backup holds

`.github/workflows/db-backup.yml` runs at 02:23 UTC and stores
`gusto-<timestamp>.tar.gz.enc` as a GitHub Actions artifact for 14 days. The
file is encrypted with `BACKUP_PASSPHRASE` (AES-256), so having the artifact is
not enough to read it. Inside:

| File | Contents |
|---|---|
| `public.dump` | Every table in `public` and the `drizzle` migration journal (`pg_dump` custom format) |
| `auth_users.csv` | `id` and `email` of every sign-in account. No password hashes or tokens |

Before the file is kept, the same workflow restores it into a throwaway
Postgres 17 and counts rows (`scripts/ops/db-restore-check.sh`). A dump that
does not restore fails the run, and GitHub emails the failure.

**Not in the backup** (rebuild these from the repo and the dashboards):

- Product images: they live in Supabase Storage, not in the database. Suppliers
  can re-upload; keep this in mind before the catalog is photo-heavy.
- The notification cron job and its Vault secrets (migration `0010`, README).
- Passwords. Partners sign in again by emailed link and choose a new one.
- Environment variables (Vercel) and Supabase Auth settings.

## One-time setup

1. Supabase → **Connect** → **Session pooler** (port **5432**, user
   `postgres.<ref>`). Not the direct host (IPv6 only, unreachable from GitHub)
   and not the `:6543` pooler (`pg_dump` cannot use it).
2. GitHub → repository **Settings → Secrets and variables → Actions**, add:
   - `BACKUP_DATABASE_URL`: that connection string.
   - `BACKUP_PASSPHRASE`: `openssl rand -base64 32`. **Also store it in your
     password manager.** It is not recoverable from GitHub.
3. **Actions → Database backup → Run workflow**, once by hand, and confirm it
   goes green and an artifact appears. The workflow has not been run on GitHub
   yet; the scripts were exercised against a local Postgres only.

GitHub pauses scheduled workflows on a **public** repository after 60 days
without repository activity. If this repository is public, a quiet period will
silently stop the backups; check the Actions tab now and then.

## Restore drill (do this before real customers)

An untried backup is a hope, not a backup. With a scratch Supabase project:

```bash
# 1. Download the artifact, then decrypt (prompts for the passphrase).
openssl enc -d -aes-256-cbc -pbkdf2 -in gusto-<timestamp>.tar.gz.enc -out backup.tar.gz
tar -xzf backup.tar.gz            # public.dump, auth_users.csv

# 2. Prove it loads into an empty local Postgres (same check CI runs).
RESTORE_CHECK_URL=postgresql://postgres:postgres@127.0.0.1:5432/scratch \
BACKUP_PASSPHRASE=... scripts/ops/db-restore-check.sh gusto-<timestamp>.tar.gz.enc
```

For a real recovery into a new Supabase project:

1. Create the project in the same region. **Do not run migrations**: the dump
   already contains the schema and the migration journal.
2. In the SQL editor: `create extension if not exists pg_trgm with schema extensions;`
3. Recreate the sign-in accounts **with their original ids** from
   `auth_users.csv` (`public.profiles` and the memberships point at those ids).
   The Auth admin API or the SQL editor can do this; **the drill must settle
   which works on your project. Until it has been done once, treat identity
   recovery as unproven.**
4. `pg_restore --no-owner --no-privileges --dbname "<session pooler url>" public.dump`
   (if it complains about the existing `public` schema or Supabase-only
   extensions, filter them with `pg_restore -l` as the check script does).
5. Re-create the cron job and Vault secrets, point Vercel at the new project.
6. Partners sign in by emailed link and set a new password.

## Health endpoint and uptime monitor

`GET /api/health` is public and answers `{"status":"ok"}` with 200 when the app
can reach the database **and** no queued notification is more than 15 minutes
overdue. Otherwise it answers 503 with `database: "down"` or `outbox:
"stalled"` (the notification cron has stopped). It returns no counts, hosts or
error text.

1. Create a free monitor (UptimeRobot or similar), type **HTTP(s)**, URL
   `https://<domain>/api/health`, 5-minute interval, alert to your email or
   phone.
2. Also add a keyword check for `"ok"` if the monitor supports it.

On Supabase's free plan a project pauses after a week without activity. The
monitor's checks, and the nightly backup, are database activity, so the project
stays awake. On a usage-billed database that sleeps when idle (Neon), do the
opposite: do not poll, or the compute never sleeps.
