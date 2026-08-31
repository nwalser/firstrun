-- The billing meter, and the plan columns the hosted edition reads.
--
-- `usage_daily` is a roll-up rather than a view over `log_entries`, because
-- retention DROPs a whole month of that table once it ages out and a number
-- derived from those rows stops existing exactly when somebody disputes it.
--
-- It is filed by the day entries ARRIVED, not by their own `time`. That is the
-- one exception to rule 5 and it is deliberate: `time` is client-stamped, so a
-- period counted on it never closes and a client stamping last year would
-- ingest free forever. See db/usage.ts.
--
-- Only the workspace cascades. `project_id` and `source_id` carry no foreign
-- key on purpose: deleting a project must not erase the month it was billed in.
--
-- The plan columns exist in every edition and are read by one of them. Self
-- hosted resolves UNLIMITED before it ever loads the row, so these are inert
-- there: no licence, no key, no ceiling. See packages/schema/src/plan.ts.
--
-- `plan` is text rather than an enum so that adding a tier is not a migration,
-- and so a row written by a newer deploy does not break an older one mid
-- rollout: an unrecognised plan reads as free.

CREATE TABLE "usage_daily" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"project_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"entries" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_workspace_id_day_project_id_source_id_pk" PRIMARY KEY("workspace_id","day","project_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan_limits" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_stripe_customer_key" ON "workspaces" USING btree ("stripe_customer_id");