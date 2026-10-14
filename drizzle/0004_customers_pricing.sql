-- Must exist before the composite FKs below reference it.
ALTER TABLE "products" ADD CONSTRAINT "products_id_supplier_key" UNIQUE("id","supplier_org_id");--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('invited', 'active', 'blocked');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"price_minor" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_price_list_id_product_id_pk" PRIMARY KEY("price_list_id","product_id"),
	CONSTRAINT "price_list_items_price_nonneg" CHECK ("price_list_items"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_id_supplier_key" UNIQUE("id","supplier_org_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"buyer_org_id" uuid,
	"status" "customer_status" DEFAULT 'invited' NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"price_list_id" uuid,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_customers_active_has_buyer" CHECK ("supplier_customers"."status" <> 'active' or "supplier_customers"."buyer_org_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_supplier_customer_id_supplier_customers_id_fk" FOREIGN KEY ("supplier_customer_id") REFERENCES "public"."supplier_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_profiles_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_list_fk" FOREIGN KEY ("price_list_id","supplier_org_id") REFERENCES "public"."price_lists"("id","supplier_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_fk" FOREIGN KEY ("product_id","supplier_org_id") REFERENCES "public"."products"("id","supplier_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD CONSTRAINT "supplier_customers_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD CONSTRAINT "supplier_customers_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD CONSTRAINT "supplier_customers_price_list_fk" FOREIGN KEY ("price_list_id","supplier_org_id") REFERENCES "public"."price_lists"("id","supplier_org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_customer_idx" ON "invitations" USING btree ("supplier_customer_id");--> statement-breakpoint
CREATE INDEX "price_list_items_product_idx" ON "price_list_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_supplier_name_key" ON "price_lists" USING btree ("supplier_org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_one_default_per_supplier" ON "price_lists" USING btree ("supplier_org_id") WHERE "price_lists"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_customers_supplier_buyer_key" ON "supplier_customers" USING btree ("supplier_org_id","buyer_org_id") WHERE "supplier_customers"."buyer_org_id" is not null;--> statement-breakpoint
CREATE INDEX "supplier_customers_buyer_idx" ON "supplier_customers" USING btree ("buyer_org_id","status");--> statement-breakpoint
CREATE INDEX "supplier_customers_supplier_idx" ON "supplier_customers" USING btree ("supplier_org_id","status");
