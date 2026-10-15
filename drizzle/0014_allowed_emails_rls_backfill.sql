-- Hand-written. See CLAUDE.md, "Security model".
ALTER TABLE "allowed_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Sign-in became invite-only with this migration. Everyone who already has an
-- account keeps access: without this, existing users would be locked out.
INSERT INTO "allowed_emails" ("email", "note", "created_by_label")
SELECT lower(btrim(u.email)), 'Existing account when sign-in became invite-only', 'migration'
FROM auth.users u
WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
ON CONFLICT ("email") DO NOTHING;
