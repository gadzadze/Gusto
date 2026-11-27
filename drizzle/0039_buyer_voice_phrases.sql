CREATE TABLE "buyer_voice_phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"uses" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_voice_phrases_len" CHECK (char_length("buyer_voice_phrases"."phrase") between 2 and 60)
);
--> statement-breakpoint
ALTER TABLE "buyer_voice_phrases" ADD CONSTRAINT "buyer_voice_phrases_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_voice_phrases" ADD CONSTRAINT "buyer_voice_phrases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_voice_phrases_key" ON "buyer_voice_phrases" USING btree ("buyer_org_id","product_id","phrase");--> statement-breakpoint
CREATE INDEX "buyer_voice_phrases_buyer_idx" ON "buyer_voice_phrases" USING btree ("buyer_org_id","last_used_at");--> statement-breakpoint
ALTER TABLE "buyer_voice_phrases" ENABLE ROW LEVEL SECURITY;
