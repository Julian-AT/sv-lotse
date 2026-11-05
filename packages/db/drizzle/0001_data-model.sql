CREATE TYPE "public"."actor_role" AS ENUM('subject', 'helper');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('L1', 'L2', 'L3');--> statement-breakpoint
CREATE TYPE "public"."client_kind" AS ENUM('web', 'mac', 'helper');--> statement-breakpoint
CREATE TYPE "public"."detail_level" AS ENUM('brief', 'standard', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."language_register" AS ENUM('formal', 'informal');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('anonymous');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."step_owner" AS ENUM('user', 'pilot', 'office');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'in_progress', 'blocked', 'completed');--> statement-breakpoint
CREATE TYPE "public"."turn_status" AS ENUM('running', 'awaiting_approval', 'completed', 'failed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."form_format" AS ENUM('acroform', 'flat', 'scanned', 'xfa', 'html');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('auto', 'verified');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "case_actor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "actor_role" NOT NULL,
	"share_scope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_actor_case_user_unique" UNIQUE("case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text DEFAULT 'de-AT' NOT NULL,
	"register" "language_register" DEFAULT 'formal' NOT NULL,
	"detail_level" "detail_level" DEFAULT 'standard' NOT NULL,
	"autonomy_level" "autonomy_level" DEFAULT 'L1' NOT NULL,
	"carrier" text,
	"region" text,
	"age_band" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_kind" "client_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_expiry_check" CHECK ("session"."expires_at" > "session"."created_at")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"relation_to_user" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "user_kind" DEFAULT 'anonymous' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_id" text NOT NULL,
	"case_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"decision" "approval_decision" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"hmac" text NOT NULL,
	CONSTRAINT "approval_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "approval_input_hash_check" CHECK ("approval"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "approval_decision_time_check" CHECK (("approval"."decision" = 'pending' AND "approval"."decided_at" IS NULL) OR ("approval"."decision" <> 'pending' AND "approval"."decided_at" IS NOT NULL AND "approval"."decided_at" >= "approval"."requested_at")),
	CONSTRAINT "approval_consumption_check" CHECK ("approval"."consumed_at" IS NULL OR ("approval"."decision" = 'approved' AND "approval"."decided_at" IS NOT NULL AND "approval"."consumed_at" >= "approval"."decided_at"))
);
--> statement-breakpoint
CREATE TABLE "case_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"process_step" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"owner" "step_owner" NOT NULL,
	"due_at" timestamp with time zone,
	"linked_artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"initiated_by" "step_owner" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"confirmed_goal" text NOT NULL,
	"life_situation" text,
	"status" "case_status" DEFAULT 'active' NOT NULL,
	"journey_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ui_message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_case_position_unique" UNIQUE("case_id","position"),
	CONSTRAINT "message_position_check" CHECK ("message"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"capsule_digest" text,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "turn_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_key" text NOT NULL,
	"hash" text NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ocr_status" "ocr_status" DEFAULT 'pending' NOT NULL,
	"origin_client" "client_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"document_id" uuid,
	"turn_id" uuid,
	"source_fact_id" uuid,
	"source" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_confidence_check" CHECK ("fact"."confidence" >= 0 AND "fact"."confidence" <= 1),
	CONSTRAINT "fact_source_check" CHECK (num_nonnulls("fact"."document_id", "fact"."turn_id", "fact"."source_fact_id") = 1),
	CONSTRAINT "fact_not_own_source_check" CHECK ("fact"."source_fact_id" <> "fact"."id")
);
--> statement-breakpoint
CREATE TABLE "benefit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"carrier" text,
	"region" text,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "facility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"region" text,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "office" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"carrier" text,
	"region" text,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "process" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"benefit_id" uuid,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "form_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"output_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"hash" text NOT NULL,
	"version_date" date,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"format" "form_format" NOT NULL,
	"pages" integer NOT NULL,
	"status" "template_status" DEFAULT 'auto' NOT NULL,
	"schema" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_template_source_hash_unique" UNIQUE("source","hash"),
	CONSTRAINT "form_template_pages_check" CHECK ("form_template"."pages" > 0)
);
--> statement-breakpoint
CREATE TABLE "kb_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('german'::regconfig, "text")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunk_validity_check" CHECK ("kb_chunk"."valid_from" IS NULL OR "kb_chunk"."valid_to" IS NULL OR "kb_chunk"."valid_to" > "kb_chunk"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"publisher" text NOT NULL,
	"text" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_validity_check" CHECK ("source"."valid_from" IS NULL OR "source"."valid_to" IS NULL OR "source"."valid_to" > "source"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" jsonb NOT NULL,
	"approval_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helper_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"helper_id" uuid NOT NULL,
	"scope" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "helper_session_end_check" CHECK ("helper_session"."ended_at" IS NULL OR "helper_session"."ended_at" >= "helper_session"."started_at")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" text NOT NULL,
	"step_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_attempts_check" CHECK ("job"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"source" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_actor" ADD CONSTRAINT "case_actor_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_actor" ADD CONSTRAINT "case_actor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_actor_id_case_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."case_actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_step" ADD CONSTRAINT "case_step_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn" ADD CONSTRAINT "turn_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_turn_id_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turn"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact" ADD CONSTRAINT "fact_source_fact_id_fact_id_fk" FOREIGN KEY ("source_fact_id") REFERENCES "public"."fact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_benefit_id_benefit_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_instance" ADD CONSTRAINT "form_instance_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_instance" ADD CONSTRAINT "form_instance_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_instance" ADD CONSTRAINT "form_instance_template_id_form_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunk" ADD CONSTRAINT "kb_chunk_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_session" ADD CONSTRAINT "helper_session_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_session" ADD CONSTRAINT "helper_session_helper_id_user_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subject_created_by_idx" ON "subject" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "approval_case_idx" ON "approval" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_step_case_idx" ON "case_step" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_subject_idx" ON "case" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "turn_case_idx" ON "turn" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "document_subject_idx" ON "document" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "fact_subject_type_idx" ON "fact" USING btree ("subject_id","type");--> statement-breakpoint
CREATE INDEX "fact_document_idx" ON "fact" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "fact_turn_idx" ON "fact" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "fact_source_fact_idx" ON "fact" USING btree ("source_fact_id");--> statement-breakpoint
CREATE INDEX "form_instance_case_idx" ON "form_instance" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_source_idx" ON "kb_chunk" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_embedding_hnsw_idx" ON "kb_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunk_tsv_gin_idx" ON "kb_chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "helper_session_case_idx" ON "helper_session" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "job_case_idx" ON "job" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "reminder_case_idx" ON "reminder" USING btree ("case_id");