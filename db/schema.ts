import { relations } from "drizzle-orm";
import {
  bigint,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One database for everything: log entries, auth and configuration.
 *
 * Drizzle owns the DDL, with one exception it cannot express: `log_entries` is
 * partitioned, so its real DDL is hand-written in
 * migrations/0000_initial.sql and the declaration below exists for the
 * types and the snapshot.
 *
 * Drizzle does NOT own the analytics queries. Every question a board asks is
 * compiled by db/query.ts from a saved query, parameter-bound. There is no
 * folder of hand-written .sql any more: a question the compiler cannot express
 * is a question the customer cannot ask either, and a file that answers one
 * behind their back is the closed catalogue coming back through the side door.
 *
 * The hierarchy is workspace > project > source:
 *
 *   workspace   who can see things, and who can change them
 *   project     one product, and one namespace of event names
 *   source      one thing that writes events. There is only the one kind.
 */

/**
 * `bytea`, which drizzle-orm does not ship a column type for.
 *
 * `pg` gives us a Buffer on the way out and takes one on the way in, so the
 * mapping is the identity function and the only thing this adds is the type.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// ---------------------------------------------------------------------------
// Enumerations. Genuinely closed sets, so the database enforces them.
// ---------------------------------------------------------------------------

/**
 * Two roles, and only two for now.
 *
 * `admin` can change things: projects, sources, dashboards, who else is in.
 * `read` can look. Anything finer is a guess about how teams will actually use
 * this, and a permission model is much easier to widen than to narrow.
 */
export const memberRoleEnum = pgEnum("member_role", ["admin", "read"]);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** GitHub's numeric id. Stable across username changes, unlike the login. */
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_github_id_key").on(t.githubId)]
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the token. The cookie holds the plaintext; this never does. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)]
);

// ---------------------------------------------------------------------------
// Workspaces: the access boundary
// ---------------------------------------------------------------------------

/**
 * A workspace is who, not what.
 *
 * It holds people and the projects they can see, and nothing else: it is not a
 * namespace for entries, for entry names, or for anybody's id.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    /**
     * The workspace logo, in the database rather than on disk or in a bucket.
     *
     * Railway's filesystem is ephemeral, so a file written on one deploy is gone
     * on the next; object storage is a managed dependency the deployment
     * decision rules out. The image is downscaled to 256px client-side before it
     * ever reaches us, so these rows are a few tens of kilobytes and Postgres
     * does not care. `logo_updated_at` is the cache key for serving it.
     */
    logo: bytea("logo"),
    logoMimeType: text("logo_mime_type"),
    logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),

    /**
     * Billing. Present in every edition, read by one of them.
     *
     * The self-hosted edition never looks at these columns: `entitlementsFor`
     * returns UNLIMITED before it reaches the row, so a self-hoster gets every
     * feature with no ceiling, no licence and nothing to switch on. The columns
     * still exist there because one schema that is partly unused beats two
     * schemas that drift, and because a customer who moves onto the hosted
     * edition should be a plan change rather than a migration.
     *
     * `plan` is text rather than an enum. The closed set lives in
     * `@firstrun/schema/plan`, where an unknown value reads as free instead of
     * throwing: adding a tier should not need a migration, and a row written by
     * a newer deploy must not break an older one mid-rollout.
     *
     * `plan_limits` overrides the tier's ceilings for one workspace. It exists
     * because the first customers get hand-tuned limits, and none of that
     * belongs in the tier constants everybody else is measured against.
     */
    plan: text("plan").notNull().default("free"),
    planLimits: jsonb("plan_limits"),
    billingStatus: text("billing_status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_slug_key").on(t.slug),
    // The Stripe webhook arrives knowing a customer id and nothing else.
    uniqueIndex("workspaces_stripe_customer_key").on(t.stripeCustomerId),
  ]
);

/**
 * Membership is per workspace, not per project.
 *
 * Someone who can see a workspace can see everything in it. Per-project access
 * is a real thing teams eventually want, and adding it later means adding rows;
 * starting with it means guessing at a shape nobody has asked for yet.
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("read"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_user_idx").on(t.userId)]
);

// ---------------------------------------------------------------------------
// Projects, sources and dashboards
// ---------------------------------------------------------------------------

/**
 * A project is one product, and one namespace of EVENT NAMES.
 *
 * Every source inside a project reports into the same vocabulary, so a board
 * can put the website and the desktop app side by side and `page_view` means
 * the same thing on both. What a project is NOT is a namespace of people: the
 * anonymous ids of two sources are never linked to each other, here or
 * anywhere else. A browser has a visitor id, an app has an install id, and
 * nothing merges them.
 *
 * So: one project per product, never one per platform.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    /**
     * The project's own picture, stored exactly like the workspace's.
     *
     * Same three columns, same reasons: Railway's filesystem is ephemeral and
     * object storage is a dependency the deployment decision rules out, and the
     * image is downscaled to 256px in the browser before it ever arrives.
     * `logo_updated_at` is the cache key the serving route builds an ETag from.
     *
     * Unset is the normal case, and a project without one draws its initials.
     */
    logo: bytea("logo"),
    logoMimeType: text("logo_mime_type"),
    logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_workspace_slug_key").on(t.workspaceId, t.slug),
    index("projects_workspace_idx").on(t.workspaceId),
  ]
);

/**
 * An ingestion site: the marketing site, the desktop app, a backend service.
 *
 * `ingestKey` is what clients send. Public by necessity -- it ships in a script
 * tag, and in a binary anyone can unpack -- so it identifies and never
 * authorises. Nothing destructive is reachable with one.
 *
 * A source has no TYPE. There used to be five -- web, desktop, mobile, server,
 * other -- recorded here and stamped onto every event. It bought a badge on a
 * row, a filter chip, and a guess at which install page to open, and it cost a
 * closed list the customer had to place their own software into. A CLI, a
 * daemon, a games console and a browser extension all wrote to the same table
 * either way. The list is gone rather than widened: whatever a source is, it
 * is one thing that writes events, and the events say the rest in attributes.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Optional installer basename, e.g. `Themia-Setup`. */
    assetName: text("asset_name"),
    ingestKey: text("ingest_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sources_ingest_key_key").on(t.ingestKey),
    index("sources_project_idx").on(t.projectId),
  ]
);

/**
 * The dashboards for a project. Plural: a project has a tab strip of them.
 *
 * `layout` is an ordered array of widgets, and a widget is a SAVED QUERY plus a
 * visualisation -- filter tree, group by, aggregation, time bucket, order,
 * limit, compiled by db/query.ts. The conventional shapes in
 * packages/schema/src are starting points a picker offers, not the set of
 * questions the product can answer.
 *
 * A board is addressed by `slug`, not by id, because the URL of a board is a
 * thing people paste to each other. `position` is the tab order, kept as a
 * column rather than inferred from `created_at` so a board can be dragged
 * somewhere without being recreated.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Overview"),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    layout: jsonb("layout").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dashboards_project_slug_key").on(t.projectId, t.slug),
    index("dashboards_project_idx").on(t.projectId),
  ]
);

// ---------------------------------------------------------------------------
// Log entries
// ---------------------------------------------------------------------------

/**
 * One structured log entry. There is no second telemetry table.
 *
 * An error is a log entry. An event is a log entry. A metric sample is a log
 * entry. What one of them MEANS is assigned by convention at write time (the
 * `name` a client picks, the attribute keys it uses) and by query at read time,
 * never by a closed set of types down here. The backend stays small; the
 * indexes and db/query.ts do the work.
 *
 * The shape is OpenTelemetry's log data model, so the SDK conventions have a
 * spec to point at instead of a vocabulary we invented:
 *
 *   time         the entry's own timestamp -- OTel `timestamp`. Client-stamped
 *                and authoritative. Everything buckets, sorts, windows,
 *                partitions and retains on this.
 *   ingested_at  OTel `observed_timestamp`. Server-stamped at the edge, read
 *                while debugging and never used for bucketing.
 *   severity     OTel `severity_number`, the 1..24 ladder. Nullable, because an
 *                entry with no severity is honestly unclassified and one
 *                silently filed as INFO is a lie a filter would act on.
 *                `severity_text` is DERIVED from this and never stored.
 *   name         OTel's log record event name: the short, low-cardinality thing
 *                this entry is. `page_view`, `exception`, `http.request`.
 *   attributes   everything else.
 *
 * `trace_id` and `span_id` are reserved by the spec and unused here. When they
 * arrive they arrive as attributes first, and are promoted only if a query
 * needs them to be columns.
 *
 * ## Five promoted columns, and no more
 *
 * `project_id`, `time`, `distinct_id`, `severity` and `name` are real columns
 * because every query in the product constrains on them. `os`, `app_version`,
 * `url`, `referrer`, the utm fields, the session id, the user id and the source
 * id are NOT: they live in `attributes` and are queried from there. That makes
 * a breakdown by OS slower than a column scan would have been, and that is the
 * trade -- a closed set of columns is a closed set of questions, and the one
 * thing we cannot know in advance is which question a customer needs answered.
 * A generated column over `attributes` is the escape hatch when one of them
 * turns out to be hot enough to pay for, and adding one is an index and a
 * migration rather than a redesign.
 *
 * ## The primary key
 *
 * `(project_id, time, entry_id)`.
 *
 * Dedup wants `(project_id, entry_id)`: every SDK replays its disk queue after
 * a crash, so the same entry id arriving twice is the normal case and
 * `ON CONFLICT DO NOTHING` is how it is absorbed. But Postgres cannot enforce a
 * unique constraint on a partitioned table unless the constraint CONTAINS the
 * partition key, so `time` has to be in it. That is a real weakening and it is
 * worth naming: two entries with the same id at genuinely different timestamps
 * would both be stored. They cannot arise from a replay, because a replayed
 * entry carries the timestamp it was stamped with on the client, which is the
 * only way the same id is ever sent twice.
 *
 * `time` sits SECOND rather than last on purpose: the key's btree is then also
 * the per-project time-range index every query starts with, so
 * `where project_id = $1 and time >= $2 and time < $3` needs no index of its
 * own and the hottest table in the database carries one btree fewer.
 *
 * ## Drizzle does not own this table's DDL
 *
 * `PARTITION BY RANGE (time)` has no Drizzle expression, so the real DDL is
 * hand-written in migrations/0000_initial.sql and this declaration exists
 * for the types, for the query builder and for the snapshot. Do NOT run
 * `drizzle-kit push` against it: push would replace a partitioned table with an
 * ordinary one and take every partition with it.
 *
 * There is no foreign key to `projects` either. A partitioned table can carry
 * one, but every partition then carries the trigger, and `deleteProject`
 * already drops the project's entries explicitly. The cascade was doing work
 * the repo does anyway.
 */
export const logEntries = pgTable(
  "log_entries",
  {
    projectId: uuid("project_id").notNull(),

    /** OTel `timestamp`. Client-stamped, authoritative, and the partition key. */
    time: timestamp("time", { withTimezone: true }).notNull(),

    /** Client-generated, so a replayed queue deduplicates instead of doubling. */
    entryId: uuid("entry_id").notNull(),

    /** OTel `observed_timestamp`. Ours. Debugging only. */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * The anonymous id the client generated and persisted for ITS OWN source:
     * a visitor id in a browser, an install id in an app. Required, because an
     * entry that belongs to nothing cannot be counted as a unique.
     *
     * `user.id` -- whatever the customer passed to `identify()` -- is an
     * attribute, not a column. A unique is
     * `count(distinct coalesce(attributes ->> 'user.id', distinct_id))`, and
     * nothing else ever folds two ids together.
     */
    distinctId: text("distinct_id").notNull(),

    /** OTel `severity_number`, 1..24. Null means unclassified, not INFO. */
    severity: smallint("severity"),

    name: text("name").notNull(),

    attributes: jsonb("attributes").notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.time, t.entryId] }),

    // Almost every question is "one name, one window", so this is the index the
    // whole product stands on. Time last, because the name is an equality and
    // the time is the range that follows it.
    index("log_entries_name_time_idx").on(t.projectId, t.name, t.time),

    // "Errors and worse, over the last day" is a range on the ladder, and the
    // severity filter is the one a log view opens with.
    index("log_entries_severity_time_idx").on(t.projectId, t.severity, t.time),

    // One person's timeline, and every unique-counting walk.
    index("log_entries_distinct_time_idx").on(t.projectId, t.distinctId, t.time),

    // The index that makes attributes a first-class query surface rather than a
    // blob we happen to store. Default `jsonb_ops` rather than
    // `jsonb_path_ops`: path_ops is smaller and faster but indexes only
    // containment (`@>`), and the compiler also emits key existence (`?`, `?|`)
    // for "is set" and "has one of these keys", which path_ops cannot answer at
    // all. One index covering every index-eligible operator we emit beats two
    // indexes on the hottest table in the database. If containment ever
    // dominates hard enough to matter this is the line to change, and
    // db/query.ts records exactly which predicates would benefit.
    index("log_entries_attributes_idx").using("gin", t.attributes),
  ]
);

/**
 * The billing meter: how many entries a workspace has been charged for.
 *
 * ## Why a roll-up and not `count(*)` over `log_entries`
 *
 * Retention drops the evidence. `log_entries` is partitioned by `time` and a
 * whole month is DROPped once it ages out (rule 4), so a number derived from
 * those rows stops being derivable exactly when somebody disputes an invoice.
 * This table is a few rows per source per day, survives the partition drop, and
 * is the only durable record of what was billed.
 *
 * ## The day is the day it ARRIVED, not the entry's own `time`
 *
 * This is the one place in the codebase that counts on arrival, and it is
 * deliberate. Rule 5 governs the query layer, where bucketing on `ingested_at`
 * would put a laptop's offline week on the wrong days. Billing is the opposite
 * question:
 *
 *  - `time` is client-stamped, so a client that stamps last year would land
 *    outside every open billing period and ingest for free forever.
 *  - A period counted on `time` never closes: an entry uploaded on the 3rd
 *    changes an invoice sent on the 1st.
 *  - Arrival is when the row actually cost a page of Postgres.
 *
 * So the usage PAGE buckets on `time` and this table counts on arrival, they
 * will not agree to the row, and both numbers say on screen which they are.
 *
 * ## No foreign key to projects or sources
 *
 * Only the workspace cascades. A billing record has to outlive the thing it
 * describes: deleting a project must not erase the month it was invoiced in. A
 * breakdown that names a project which no longer exists renders as deleted.
 *
 * `source_id` costs nothing to carry because a batch arrives under exactly one
 * source key, so the writer already has it and never has to group.
 */
export const usageDaily = pgTable(
  "usage_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** The UTC day the entries arrived on. Plain `date`: no zone, no bucket maths. */
    day: date("day").notNull(),

    projectId: uuid("project_id").notNull(),
    sourceId: uuid("source_id").notNull(),

    /** Entries the primary key accepted as NEW. A replayed queue is not billed twice. */
    entries: bigint("entries", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    // Workspace first: every read of this table is one workspace over a month.
    primaryKey({ columns: [t.workspaceId, t.day, t.projectId, t.sourceId] }),
  ]
);

// ---------------------------------------------------------------------------
// Relations, for the typed query API
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
  sessions: many(sessions),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  projects: many(projects),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  sources: many(sources),
  dashboards: many(dashboards),
}));

export const sourcesRelations = relations(sources, ({ one }) => ({
  project: one(projects, { fields: [sources.projectId], references: [projects.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Dashboard = typeof dashboards.$inferSelect;
export type LogEntryRow = typeof logEntries.$inferSelect;
export type UsageDailyRow = typeof usageDaily.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
