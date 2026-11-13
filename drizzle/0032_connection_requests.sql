ALTER TYPE "public"."notification_event" ADD VALUE 'connection_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_event" ADD VALUE 'connection_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_event" ADD VALUE 'connection_declined';--> statement-breakpoint
CREATE TABLE "connection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_org_id" uuid NOT NULL,
	"to_org_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"price_list_id" uuid,
	"requested_by_user_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_requests_status" CHECK ("connection_requests"."status" in ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
	CONSTRAINT "connection_requests_distinct" CHECK ("connection_requests"."from_org_id" <> "connection_requests"."to_org_id"),
	CONSTRAINT "connection_requests_message_len" CHECK ("connection_requests"."message" is null or char_length("connection_requests"."message") <= 300)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "findable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_from_org_id_organizations_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_to_org_id_organizations_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_requested_by_user_id_profiles_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_decided_by_user_id_profiles_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_requests_one_pending" ON "connection_requests" USING btree (least("from_org_id", "to_org_id"),greatest("from_org_id", "to_org_id")) WHERE "connection_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "connection_requests_to_idx" ON "connection_requests" USING btree ("to_org_id","status");--> statement-breakpoint
CREATE INDEX "connection_requests_from_idx" ON "connection_requests" USING btree ("from_org_id","status");--> statement-breakpoint
ALTER TABLE "connection_requests" ENABLE ROW LEVEL SECURITY;
