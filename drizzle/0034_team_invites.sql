CREATE TABLE "team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_lowercase" CHECK ("team_invites"."email" = lower(btrim("team_invites"."email")))
);
--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invited_by_user_id_profiles_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_open_key" ON "team_invites" USING btree ("organization_id","email") WHERE "team_invites"."accepted_at" is null and "team_invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "team_invites_email_idx" ON "team_invites" USING btree ("email");--> statement-breakpoint
ALTER TABLE "team_invites" ENABLE ROW LEVEL SECURITY;