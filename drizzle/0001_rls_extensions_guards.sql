-- Hand-written. See CLAUDE.md, "Security model" and "Database rules".

-- Trigram search (used from milestone 2). Supabase keeps extensions in their
-- own schema; create it if this is a plain Postgres (tests).
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint

-- RLS on with zero policies: Supabase's Data API (anon / authenticated roles)
-- can read and write nothing. The app connects as the table owner, which
-- bypasses RLS; tenant isolation is enforced in src/server/. Every new table
-- needs the same line in its migration.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- An organization's type decides what its members can do. It is fixed at
-- creation; no code path may change it.
CREATE OR REPLACE FUNCTION public.organizations_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'organizations.type is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER organizations_type_immutable
BEFORE UPDATE OF type ON "organizations"
FOR EACH ROW EXECUTE FUNCTION public.organizations_type_immutable();
