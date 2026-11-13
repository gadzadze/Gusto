ALTER TABLE "buyer_supplier_invites" ADD COLUMN "legal_id" text;--> statement-breakpoint
ALTER TABLE "buyer_supplier_invites" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD COLUMN "legal_id" text;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_customer_id_supplier_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."supplier_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_supplier_invites_code_idx" ON "buyer_supplier_invites" USING btree ("legal_id");--> statement-breakpoint
CREATE INDEX "supplier_customers_open_invite_code_idx" ON "supplier_customers" USING btree ("legal_id") WHERE "supplier_customers"."status" = 'invited' and "supplier_customers"."buyer_org_id" is null and "supplier_customers"."legal_id" is not null;