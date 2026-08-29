CREATE TYPE "public"."distinct_type" AS ENUM('web_visitor', 'install', 'account');--> statement-breakpoint
CREATE TYPE "public"."edge_method" AS ENUM('token', 'account', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('web', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."surface" AS ENUM('web', 'app');--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text DEFAULT 'Overview' NOT NULL,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_hints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"web_visitor_id" text NOT NULL,
	"ip_hash" text NOT NULL,
	"os" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"web_visitor_id" text,
	"asset" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"workspace_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"source_id" uuid,
	"event_name" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone DEFAULT now() NOT NULL,
	"surface" "surface" NOT NULL,
	"person_id" uuid NOT NULL,
	"web_visitor_id" text,
	"install_id" text,
	"account_id" text,
	"session_id" text,
	"app_version" text,
	"channel" text,
	"os" text,
	"arch" text,
	"locale" text,
	"url" text,
	"referrer" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "events_workspace_id_event_id_pk" PRIMARY KEY("workspace_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "identity_edges" (
	"workspace_id" uuid NOT NULL,
	"from_type" "distinct_type" NOT NULL,
	"from_id" text NOT NULL,
	"to_type" "distinct_type" NOT NULL,
	"to_id" text NOT NULL,
	"method" "edge_method" NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_edges_workspace_id_method_from_type_from_id_to_type_to_id_pk" PRIMARY KEY("workspace_id","method","from_type","from_id","to_type","to_id")
);
--> statement-breakpoint
CREATE TABLE "person_overrides" (
	"workspace_id" uuid NOT NULL,
	"distinct_type" "distinct_type" NOT NULL,
	"distinct_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	CONSTRAINT "person_overrides_workspace_id_distinct_type_distinct_id_pk" PRIMARY KEY("workspace_id","distinct_type","distinct_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"asset_name" text,
	"ingest_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_hints" ADD CONSTRAINT "download_hints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_tokens" ADD CONSTRAINT "download_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_tokens" ADD CONSTRAINT "download_tokens_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_edges" ADD CONSTRAINT "identity_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_overrides" ADD CONSTRAINT "person_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboards_workspace_idx" ON "dashboards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "download_hints_lookup_idx" ON "download_hints" USING btree ("workspace_id","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "download_tokens_visitor_idx" ON "download_tokens" USING btree ("workspace_id","web_visitor_id");--> statement-breakpoint
CREATE INDEX "download_tokens_expiry_idx" ON "download_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" USING btree ("workspace_id","event_time");--> statement-breakpoint
CREATE INDEX "events_person_idx" ON "events" USING btree ("workspace_id","person_id");--> statement-breakpoint
CREATE INDEX "events_name_time_idx" ON "events" USING btree ("workspace_id","event_name","event_time");--> statement-breakpoint
CREATE INDEX "events_install_idx" ON "events" USING btree ("workspace_id","install_id");--> statement-breakpoint
CREATE INDEX "events_visitor_idx" ON "events" USING btree ("workspace_id","web_visitor_id");--> statement-breakpoint
CREATE INDEX "edges_from_idx" ON "identity_edges" USING btree ("workspace_id","from_type","from_id");--> statement-breakpoint
CREATE INDEX "edges_to_idx" ON "identity_edges" USING btree ("workspace_id","to_type","to_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_ingest_key_key" ON "sources" USING btree ("ingest_key");--> statement-breakpoint
CREATE INDEX "sources_workspace_idx" ON "sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_id_key" ON "users" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");