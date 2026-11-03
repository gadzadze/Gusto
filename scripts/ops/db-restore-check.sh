#!/usr/bin/env bash
# Proves a backup from db-backup.sh can be restored: decrypts it, loads it into
# an EMPTY scratch database and counts rows. Run by the backup workflow after
# every dump, and by hand for a restore drill (docs/backups.md).
#
#   RESTORE_CHECK_URL    an empty, disposable database. It is written to.
#   BACKUP_PASSPHRASE    the passphrase the backup was encrypted with
#   PG_RESTORE, PSQL     override the binaries
#
# Refuses a database that already has tables in `public`, so it can never be
# pointed at something real by mistake.
set -euo pipefail

: "${RESTORE_CHECK_URL:?RESTORE_CHECK_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
backup="${1:?usage: db-restore-check.sh <backup.tar.gz.enc>}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"

existing="$("$PSQL" "$RESTORE_CHECK_URL" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$existing" != "0" ]; then
  echo "Refusing to restore into a database that already has $existing tables in public." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$backup" -out "$work/backup.tar.gz"
tar -C "$work" -xzf "$work/backup.tar.gz"

# What Supabase provides and the dump relies on, stood in here:
#  - auth.users, which public.profiles and others reference (the backup holds
#    only id and email);
#  - the `extensions` schema with pg_trgm, which the product search index uses
#    (extensions.gin_trgm_ops).
"$PSQL" "$RESTORE_CHECK_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
SQL
"$PSQL" "$RESTORE_CHECK_URL" -v ON_ERROR_STOP=1 -c "\\copy auth.users (id, email) from '$work/auth_users.csv' csv header"

# Left out of the restore list:
#  - the `public` schema itself, which every database already has;
#  - Supabase-only extensions, which a plain Postgres cannot create and Gusto
#    does not need to read its data.
"$PG_RESTORE" -l "$work/public.dump" \
  | grep -vE ' SCHEMA - public | SCHEMA public( |$)| EXTENSION - (pg_net|pg_cron|supabase_vault|pg_graphql|pgsodium|pgjwt)| EXTENSION (pg_net|pg_cron|supabase_vault|pg_graphql|pgsodium|pgjwt)( |$)' \
  > "$work/restore.list"
"$PG_RESTORE" --no-owner --no-privileges --exit-on-error \
  --use-list "$work/restore.list" --dbname "$RESTORE_CHECK_URL" "$work/public.dump"

echo "Restored. Row counts:"
"$PSQL" "$RESTORE_CHECK_URL" -v ON_ERROR_STOP=1 -At -F ' : ' <<'SQL'
select 'organizations', count(*) from public.organizations
union all select 'products', count(*) from public.products
union all select 'orders', count(*) from public.orders
union all select 'auth users (id + email)', count(*) from auth.users;
SQL
