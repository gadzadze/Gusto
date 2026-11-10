#!/usr/bin/env bash
# Encrypted logical backup of the 202 database. Run by
# .github/workflows/db-backup.yml; Linux/macOS only (it is not an npm script).
#
#   BACKUP_DATABASE_URL  session-mode or direct connection (NOT the :6543
#                        transaction pooler, which pg_dump cannot use)
#   BACKUP_PASSPHRASE    encrypts the file; without it the dump is unreadable
#   PG_DUMP, PSQL        override the binaries (CI runs them through Docker)
#
# Writes <out-dir>/gusto-<UTC timestamp>.tar.gz.enc containing:
#   public.dump      pg_dump custom format of the `public` and `drizzle` schemas
#   auth_users.csv   id + email only. No password hashes, tokens or metadata:
#                    partners sign in again by emailed link (README).
# Prints the output path on the last line.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
out_dir="${1:?usage: db-backup.sh <output-dir>}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"

mkdir -p "$out_dir"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# `drizzle` holds the migration journal; without it a restored database would
# try to re-run every migration. --no-owner/--no-privileges keep the dump
# restorable into a project whose roles differ.
"$PG_DUMP" --format=custom --no-owner --no-privileges \
  --schema=public --schema=drizzle \
  --file "$work/public.dump" "$BACKUP_DATABASE_URL"

"$PSQL" "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "\\copy (select id, email from auth.users order by created_at) to '$work/auth_users.csv' csv header"

tar -C "$work" -czf "$work/backup.tar.gz" public.dump auth_users.csv

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$out_dir/gusto-$stamp.tar.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE \
  -in "$work/backup.tar.gz" -out "$out"

echo "$out"
