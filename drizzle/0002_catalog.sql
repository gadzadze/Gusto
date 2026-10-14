CREATE TYPE "public"."product_unit" AS ENUM('piece', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'case', 'bottle');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"brand" text,
	"sku" text,
	"unit" "product_unit" NOT NULL,
	"pack_description" text,
	"image_path" text,
	"base_price_minor" bigint NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"min_qty_milli" integer DEFAULT 1000 NOT NULL,
	"qty_step_milli" integer DEFAULT 1000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_nonneg" CHECK ("products"."base_price_minor" >= 0),
	CONSTRAINT "products_min_qty_positive" CHECK ("products"."min_qty_milli" > 0),
	CONSTRAINT "products_qty_step_positive" CHECK ("products"."qty_step_milli" > 0),
	CONSTRAINT "products_vat_range" CHECK ("products"."vat_rate_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "supplier_settings" ADD COLUMN "import_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_key" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "categories_sort_idx" ON "categories" USING btree ("is_archived","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "products_supplier_sku_key" ON "products" USING btree ("supplier_org_id","sku") WHERE "products"."sku" is not null;--> statement-breakpoint
CREATE INDEX "products_supplier_active_idx" ON "products" USING btree ("supplier_org_id","is_active");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_search_trgm_idx" ON "products" USING gin ("search_text" extensions.gin_trgm_ops);