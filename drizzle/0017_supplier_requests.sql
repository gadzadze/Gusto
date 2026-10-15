CREATE TYPE "public"."supplier_request_status" AS ENUM('new', 'contacted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "supplier_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"legal_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"city" text NOT NULL,
	"note" text,
	"status" "supplier_request_status" DEFAULT 'new' NOT NULL,
	"admin_note" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_requests_email_lowercase" CHECK ("supplier_requests"."email" = lower(btrim("supplier_requests"."email")))
);
--> statement-breakpoint
ALTER TABLE "supplier_requests" ADD CONSTRAINT "supplier_requests_reviewed_by_user_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_requests_status_idx" ON "supplier_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_requests_open_legal_id_key" ON "supplier_requests" USING btree ("legal_id") WHERE "supplier_requests"."status" in ('new', 'contacted');--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_requests_open_email_key" ON "supplier_requests" USING btree ("email") WHERE "supplier_requests"."status" in ('new', 'contacted');--> statement-breakpoint
-- Hand-written. See CLAUDE.md, "Security model": RLS on, zero policies.
ALTER TABLE "supplier_requests" ENABLE ROW LEVEL SECURITY;
