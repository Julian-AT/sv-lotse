CREATE TABLE "helper_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"case_id" uuid NOT NULL,
	"issuer_id" uuid NOT NULL,
	"share_scope" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "helper_invite_token_hash_check" CHECK ("helper_invite"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "helper_invite_expiry_check" CHECK ("helper_invite"."expires_at" > "helper_invite"."created_at"),
	CONSTRAINT "helper_invite_consumption_check" CHECK ("helper_invite"."consumed_at" IS NULL OR "helper_invite"."consumed_at" >= "helper_invite"."created_at")
);
--> statement-breakpoint
ALTER TABLE "helper_invite" ADD CONSTRAINT "helper_invite_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_invite" ADD CONSTRAINT "helper_invite_issuer_id_user_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helper_invite_case_idx" ON "helper_invite" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "helper_invite_issuer_idx" ON "helper_invite" USING btree ("issuer_id");