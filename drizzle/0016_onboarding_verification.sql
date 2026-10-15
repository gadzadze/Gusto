ALTER TABLE "organizations" DROP CONSTRAINT "organizations_buyer_shape";--> statement-breakpoint
ALTER TABLE "allowed_emails" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "allowed_emails" ADD COLUMN "legal_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_type_legal_id_key" ON "organizations" USING btree ("type","legal_id") WHERE "organizations"."legal_id" is not null;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_buyer_shape" CHECK ("organizations"."type" <> 'buyer' or "organizations"."business_type" is not null);