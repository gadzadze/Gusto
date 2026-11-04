CREATE TABLE "regular_order_items" (
	"regular_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_milli" integer NOT NULL,
	CONSTRAINT "regular_order_items_regular_order_id_product_id_pk" PRIMARY KEY("regular_order_id","product_id"),
	CONSTRAINT "regular_order_items_qty_positive" CHECK ("regular_order_items"."qty_milli" > 0)
);
--> statement-breakpoint
CREATE TABLE "regular_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekday" integer NOT NULL,
	"last_reminded_on" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regular_orders_weekday_range" CHECK ("regular_orders"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "regular_order_items" ADD CONSTRAINT "regular_order_items_regular_order_id_regular_orders_id_fk" FOREIGN KEY ("regular_order_id") REFERENCES "public"."regular_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regular_order_items" ADD CONSTRAINT "regular_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regular_orders" ADD CONSTRAINT "regular_orders_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regular_orders" ADD CONSTRAINT "regular_orders_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regular_orders" ADD CONSTRAINT "regular_orders_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regular_orders_buyer_idx" ON "regular_orders" USING btree ("buyer_org_id");--> statement-breakpoint
-- Hand-written. See CLAUDE.md, "Security model": RLS on, zero policies.
ALTER TABLE "regular_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regular_order_items" ENABLE ROW LEVEL SECURITY;
