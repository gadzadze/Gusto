CREATE TABLE "buyer_supplier_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"contact_phone" text,
	"contact_email" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"supplier_org_id" uuid,
	"connected_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_requests" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "buyer_supplier_invites" ADD CONSTRAINT "buyer_supplier_invites_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_supplier_invites" ADD CONSTRAINT "buyer_supplier_invites_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_supplier_invites" ADD CONSTRAINT "buyer_supplier_invites_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_supplier_invites_token_hash_key" ON "buyer_supplier_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "buyer_supplier_invites_buyer_idx" ON "buyer_supplier_invites" USING btree ("buyer_org_id","created_at");--> statement-breakpoint
CREATE INDEX "buyer_supplier_invites_supplier_idx" ON "buyer_supplier_invites" USING btree ("supplier_org_id");--> statement-breakpoint
ALTER TABLE "supplier_requests" ADD CONSTRAINT "supplier_requests_invite_id_buyer_supplier_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."buyer_supplier_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_supplier_invites" ENABLE ROW LEVEL SECURITY;
