CREATE TABLE "order_waybills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rs_waybill_id" integer,
	"rs_number" text,
	"start_address" text NOT NULL,
	"driver_name" text,
	"driver_id" text,
	"vehicle" text,
	"last_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "order_waybills_status" CHECK ("order_waybills"."status" in ('draft', 'active', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "rs_connections" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"su_cipher" text NOT NULL,
	"sp_cipher" text NOT NULL,
	"payer_id" integer NOT NULL,
	"service_user_id" integer NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_waybills" ADD CONSTRAINT "order_waybills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_waybills" ADD CONSTRAINT "order_waybills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_waybills" ADD CONSTRAINT "order_waybills_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rs_connections" ADD CONSTRAINT "rs_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rs_connections" ADD CONSTRAINT "rs_connections_connected_by_user_id_profiles_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_waybills_order_key" ON "order_waybills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_waybills_org_idx" ON "order_waybills" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "rs_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_waybills" ENABLE ROW LEVEL SECURITY;
