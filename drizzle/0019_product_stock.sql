ALTER TABLE "products" ADD COLUMN "stock_milli" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_nonneg" CHECK ("products"."stock_milli" >= 0);