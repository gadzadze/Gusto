-- Hand-written. See CLAUDE.md, "Security model".

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Product image bucket. Public read (catalog images aren't secret; paths are
-- unguessable UUIDs), and no storage policies, so only the server's
-- service-role key can write. Skipped on plain Postgres (tests), which has
-- no `storage` schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('product-images', 'product-images', true, 1048576, ARRAY['image/webp'])
    ON CONFLICT (id) DO UPDATE
      SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
