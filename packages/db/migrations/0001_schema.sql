CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_key" AS ENUM('requirement_analyst', 'business_analyst', 'legacy_intelligence', 'solution_architect', 'developer', 'database', 'qa', 'code_review', 'security', 'release', 'documentation');--> statement-breakpoint
CREATE TYPE "public"."artifact_kind" AS ENUM('requirement_spec', 'business_context', 'impact_map', 'change_plan', 'test_plan', 'code_change', 'db_change', 'test_results', 'review_report', 'security_report', 'release_package', 'release_notes', 'analysis_report');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('git_token', 'oracle_db', 'api_key');--> statement-breakpoint
CREATE TYPE "public"."gate_kind" AS ENUM('plan', 'release', 'escalation');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('pending', 'approved', 'changes_requested', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('viewer', 'requester', 'approver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'paused', 'blocked', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('git', 'oracle_metadata');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('idle', 'syncing', 'ready', 'error');--> statement-breakpoint
CREATE TYPE "public"."stage_key" AS ENUM('understand', 'analyse', 'plan', 'build', 'verify', 'release');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ticket_source" AS ENUM('board', 'home', 'intake_api', 'agent', 'comment');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('backlog', 'ready', 'analysing', 'awaiting_plan_approval', 'building', 'verifying', 'awaiting_release_approval', 'releasing', 'done', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('feature', 'bug', 'hotfix', 'analysis', 'task');--> statement-breakpoint
CREATE TYPE "public"."triage_state" AS ENUM('pending', 'done', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."workflow_type" AS ENUM('full_change', 'hotfix', 'analysis');--> statement-breakpoint
CREATE TABLE "activities" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activities_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"ticket_id" uuid,
	"run_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"agent_key" "agent_key",
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"step_id" uuid,
	"kind" "artifact_kind" NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"agent_key" "agent_key",
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"start_line" integer,
	"end_line" integer,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "code_edges" (
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "code_edges_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "code_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"path" text,
	"language" text,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(path, '')), 'B')) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"ciphertext" text NOT NULL,
	"created_by_id" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "gate_kind" NOT NULL,
	"status" "gate_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"step_id" uuid,
	"project_id" uuid,
	"agent_key" "agent_key",
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ticket_seq" integer DEFAULT 0 NOT NULL,
	"intake_token_hash" text,
	"archived_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "stage_key" NOT NULL,
	"task" text NOT NULL,
	"agent_key" "agent_key" NOT NULL,
	"title" text NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"current_action" text,
	"error" text,
	"artifact_id" uuid,
	"cost_usd" numeric(12, 4) DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_type" "workflow_type" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"current_stage" "stage_key",
	"temporal_workflow_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"branch" text,
	"plan_revisions" integer DEFAULT 0 NOT NULL,
	"qa_attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cost_usd" numeric(12, 4) DEFAULT 0 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"started_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"credential_id" uuid,
	"status" "source_status" DEFAULT 'idle' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_commit" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" "actor_type" NOT NULL,
	"author_id" uuid,
	"agent_key" "agent_key",
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"key" text NOT NULL,
	"type" "ticket_type" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "ticket_status" DEFAULT 'backlog' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'medium' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" "ticket_source" NOT NULL,
	"external_ref" text,
	"reporter_id" uuid,
	"assignee_id" uuid,
	"parent_id" uuid,
	"duplicate_of_id" uuid,
	"due_date" text,
	"rank" double precision NOT NULL,
	"active_run_id" uuid,
	"triage_state" "triage_state" DEFAULT 'skipped' NOT NULL,
	"triage_note" text,
	"version" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(key, '') || ' ' || coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_object_id_code_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."code_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_from_id_code_objects_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."code_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_to_id_code_objects_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."code_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_objects" ADD CONSTRAINT "code_objects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_objects" ADD CONSTRAINT "code_objects_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_id_uq" ON "activities" USING btree ("id");--> statement-breakpoint
CREATE INDEX "activities_ticket_idx" ON "activities" USING btree ("ticket_id","seq");--> statement-breakpoint
CREATE INDEX "activities_run_idx" ON "activities" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "activities_project_idx" ON "activities" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "activities_actor_idx" ON "activities" USING btree ("actor_id","seq");--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id","kind","version");--> statement-breakpoint
CREATE INDEX "artifacts_ticket_idx" ON "artifacts" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "chunks_object_idx" ON "chunks" USING btree ("object_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_search_idx" ON "chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "code_edges_to_idx" ON "code_edges" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "code_edges_project_idx" ON "code_edges" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_objects_identity_uq" ON "code_objects" USING btree ("source_id","kind","name");--> statement-breakpoint
CREATE INDEX "code_objects_project_name_idx" ON "code_objects" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "code_objects_search_idx" ON "code_objects" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "code_objects_name_trgm_idx" ON "code_objects" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_project_name_uq" ON "credentials" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "gates_pending_idx" ON "gates" USING btree ("status","project_id");--> statement-breakpoint
CREATE INDEX "gates_run_idx" ON "gates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_usage_run_idx" ON "llm_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_usage_project_idx" ON "llm_usage" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_key_uq" ON "projects" USING btree ("key");--> statement-breakpoint
CREATE INDEX "run_steps_run_idx" ON "run_steps" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_attempt_uq" ON "run_steps" USING btree ("run_id","task","attempt");--> statement-breakpoint
CREATE INDEX "runs_ticket_idx" ON "runs" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workflow_uq" ON "runs" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE INDEX "sources_project_idx" ON "sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ticket_comments_ticket_idx" ON "ticket_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_key_uq" ON "tickets" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_project_number_uq" ON "tickets" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "tickets_board_idx" ON "tickets" USING btree ("project_id","status","rank");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_parent_idx" ON "tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tickets_search_idx" ON "tickets" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));