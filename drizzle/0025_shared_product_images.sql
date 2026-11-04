CREATE TABLE "shared_product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barcode" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"attribution" text NOT NULL,
	"image_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_product_images_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_source" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_image_source_check" CHECK ("image_source" in ('own', 'shared'));
