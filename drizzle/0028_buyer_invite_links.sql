CREATE TABLE "buyer_invite_links" (
	"buyer_org_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyer_invite_links" ADD CONSTRAINT "buyer_invite_links_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_invite_links_token_key" ON "buyer_invite_links" USING btree ("token");--> statement-breakpoint
ALTER TABLE "buyer_invite_links" ENABLE ROW LEVEL SECURITY;
