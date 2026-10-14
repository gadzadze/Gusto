import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { testDatabaseUrl } from "./test-database";

// Rebuilds the test database from scratch, then applies the real migrations —
// so every run also proves the migrations work on an empty database.
//
// Plain Postgres has no Supabase `auth` schema, so a minimal stand-in is
// created first: the `auth.users` columns our code touches, and the
// anon/authenticated roles with Supabase's default grants (for the RLS test).
export default async function setup() {
  const url = testDatabaseUrl();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      DROP SCHEMA IF EXISTS extensions CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      CREATE SCHEMA public;

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$;

      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE,
        raw_user_meta_data jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    `);
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
