CREATE TABLE "relative_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"owner_session_id" uuid NOT NULL,
	"helper_session_id" uuid,
	"state" text DEFAULT 'invited' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relative_session_invite_id_unique" UNIQUE("invite_id"),
	CONSTRAINT "relative_session_state_check" CHECK ("relative_session"."state" IN ('invited', 'pending', 'approved', 'ended')),
	CONSTRAINT "relative_session_helper_check" CHECK ("relative_session"."state" NOT IN ('pending', 'approved') OR "relative_session"."helper_session_id" IS NOT NULL),
	CONSTRAINT "relative_session_expiry_check" CHECK ("relative_session"."expires_at" > "relative_session"."created_at")
);
--> statement-breakpoint
ALTER TABLE "relative_session" ADD CONSTRAINT "relative_session_invite_id_helper_invite_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."helper_invite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relative_session" ADD CONSTRAINT "relative_session_owner_session_id_session_id_fk" FOREIGN KEY ("owner_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relative_session" ADD CONSTRAINT "relative_session_helper_session_id_session_id_fk" FOREIGN KEY ("helper_session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;