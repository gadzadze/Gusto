CREATE TABLE "payment_term_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"method" text,
	"interval_days" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_term_requests_status" CHECK ("payment_term_requests"."status" in ('pending', 'approved', 'declined')),
	CONSTRAINT "payment_term_requests_method" CHECK ("payment_term_requests"."method" is null or "payment_term_requests"."method" in ('cash', 'transfer'))
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid,
	"kind" text NOT NULL,
	"method" text,
	"interval_days" integer,
	"min_qty_milli" integer,
	"adjust_bp" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_rules_kind" CHECK ("price_rules"."kind" in ('method', 'interval', 'qty')),
	CONSTRAINT "price_rules_shape" CHECK (("price_rules"."kind" = 'method' and "price_rules"."method" in ('cash', 'transfer') and "price_rules"."interval_days" is null and "price_rules"."min_qty_milli" is null)
        or ("price_rules"."kind" = 'interval' and "price_rules"."method" is null and "price_rules"."interval_days" between 0 and 365 and "price_rules"."min_qty_milli" is null)
        or ("price_rules"."kind" = 'qty' and "price_rules"."method" is null and "price_rules"."interval_days" is null and "price_rules"."min_qty_milli" > 0)),
	CONSTRAINT "price_rules_adjust_range" CHECK ("price_rules"."adjust_bp" between -9000 and 5000)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "list_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "adjust_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_interval_days" integer;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD COLUMN "terms_method" text;--> statement-breakpoint
ALTER TABLE "supplier_customers" ADD COLUMN "terms_interval_days" integer;--> statement-breakpoint
ALTER TABLE "payment_term_requests" ADD CONSTRAINT "payment_term_requests_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_term_requests" ADD CONSTRAINT "payment_term_requests_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_term_requests" ADD CONSTRAINT "payment_term_requests_decided_by_user_id_profiles_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_list_fk" FOREIGN KEY ("price_list_id","supplier_org_id") REFERENCES "public"."price_lists"("id","supplier_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_product_fk" FOREIGN KEY ("product_id","supplier_org_id") REFERENCES "public"."products"("id","supplier_org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_term_requests_one_pending" ON "payment_term_requests" USING btree ("supplier_org_id","buyer_org_id") WHERE "payment_term_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payment_term_requests_supplier_idx" ON "payment_term_requests" USING btree ("supplier_org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rules_key" ON "price_rules" USING btree ("price_list_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid),"kind",coalesce("method", ''),coalesce("interval_days", -1),coalesce("min_qty_milli", -1));--> statement-breakpoint
CREATE INDEX "price_rules_list_idx" ON "price_rules" USING btree ("price_list_id");--> statement-breakpoint
ALTER TABLE "price_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_term_requests" ENABLE ROW LEVEL SECURITY;
