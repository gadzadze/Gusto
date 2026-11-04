ALTER TABLE "shared_product_images" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "shared_product_images" CASCADE;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_image_source_check";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "image_source";