ALTER TYPE "public"."notification_event" ADD VALUE 'terms_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_event" ADD VALUE 'terms_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_event" ADD VALUE 'terms_declined';--> statement-breakpoint
ALTER TYPE "public"."notification_event" ADD VALUE 'customer_connected';--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "order_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;