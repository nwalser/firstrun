import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One database for everything: events, identity, auth and configuration.
 *
 * Drizzle owns the DDL. It does NOT own the analytics queries -- the funnel and
 * retention SQL lives in db/queries/*.sql, because those queries are the
 * product and should be readable by someone who knows SQL and nothing about
 * this codebase.
 *
 * The hierarchy is workspace > project > source:
 *
 *   workspace   who can see things, and who can change them
 *   project     ONE PRODUCT, and one namespace of people
 *   source      one thing that sends events: a website, a desktop app
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

export const surfaceEnum = pgEnum("surface", ["web", "app"]);

/** See CLAUDE.md rule 1: token and account are exact, estimate never is. */
export const edgeMethodEnum = pgEnum("edge_method", ["token", "account", "estimate"]);

export const distinctTypeEnum = pgEnum("distinct_type", ["web_visitor", "install", "account"]);

/** What kind of thing is sending events. A project usually has both. */
export const sourceKindEnum = pgEnum("source_kind", ["web", "desktop"]);

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
 * It holds people and the projects they can see. It is deliberately NOT an
 * identity namespace -- that lives on the project, one level down.
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

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_slug_key").on(t.slug)]
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
// Projects: the identity namespace
// ---------------------------------------------------------------------------

/**
 * A project is one product, and ONE NAMESPACE OF PEOPLE.
 *
 * This is the load-bearing decision in the whole model. Every source inside a
 * project resolves to the same people -- if the website and the desktop app had
 * separate person spaces, the web-to-install join could not exist, and that
 * join is the entire product.
 *
 * So: one project per product, never one per platform. Two products in one
 * workspace are two projects, and a visitor to one is not a visitor to the
 * other.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_workspace_slug_key").on(t.workspaceId, t.slug),
    index("projects_workspace_idx").on(t.workspaceId),
  ]
);

/**
 * An ingestion site: the marketing site, the desktop app, a second app.
 *
 * `ingestKey` is what clients send. Public by necessity -- it ships in a script
 * tag -- so it identifies and never authorises. Nothing destructive is reachable
 * with one.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: sourceKindEnum("kind").notNull(),
    /** Installer basename for desktop sources, e.g. `Themia-Setup`. */
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
 * The dashboard for a project.
 *
 * `layout` is an ordered array of widgets from a fixed catalogue -- see
 * packages/schema/src/widgets.ts. Deliberately a catalogue and not a query
 * builder: every widget answers a question this product exists to answer, and
 * none of them assemble an arbitrary query. A generic explore view is the
 * failure mode here, and that catalogue is the line.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Overview"),
    layout: jsonb("layout").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dashboards_project_idx").on(t.projectId)]
);

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/** Minted at download, claimed on first run. The token lives in the filename. */
export const downloadTokens = pgTable(
  "download_tokens",
  {
    token: text("token").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    webVisitorId: text("web_visitor_id"),
    asset: text("asset").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [
    index("download_tokens_visitor_idx").on(t.projectId, t.webVisitorId),
    index("download_tokens_expiry_idx").on(t.expiresAt),
  ]
);

/**
 * Material for ESTIMATED matches only. Never for an exact join.
 *
 * A salted hash, not an address: this exists to be compared with another hash
 * of the same address for thirty minutes, and is pruned after an hour.
 */
export const downloadHints = pgTable(
  "download_hints",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    webVisitorId: text("web_visitor_id").notNull(),
    ipHash: text("ip_hash").notNull(),
    os: text("os"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("download_hints_lookup_idx").on(t.projectId, t.ipHash, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Events and identity
// ---------------------------------------------------------------------------

/**
 * The event store.
 *
 * `event_time` is client-stamped and authoritative; `ingest_time` is
 * server-stamped and read only while debugging. Nothing sorts, buckets, windows
 * or retains on ingest time. See CLAUDE.md rule 2.
 *
 * The primary key is (project_id, event_id), which makes dedup a property of
 * the schema rather than a table someone has to remember to check. The desktop
 * SDK replays its disk queue after a crash, so duplicates are the normal case.
 *
 * `person_id` is derived by @firstrun/identity. A client never sends one.
 */
export const events = pgTable(
  "events",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),

    eventName: text("event_name").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    ingestTime: timestamp("ingest_time", { withTimezone: true }).notNull().defaultNow(),
    surface: surfaceEnum("surface").notNull(),

    personId: uuid("person_id").notNull(),
    webVisitorId: text("web_visitor_id"),
    installId: text("install_id"),
    accountId: text("account_id"),
    sessionId: text("session_id"),

    appVersion: text("app_version"),
    channel: text("channel"),
    os: text("os"),
    arch: text("arch"),
    locale: text("locale"),

    url: text("url"),
    referrer: text("referrer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),

    props: jsonb("props").notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.eventId] }),
    index("events_time_idx").on(t.projectId, t.eventTime),
    index("events_person_idx").on(t.projectId, t.personId),
    index("events_name_time_idx").on(t.projectId, t.eventName, t.eventTime),
    index("events_install_idx").on(t.projectId, t.installId),
    index("events_visitor_idx").on(t.projectId, t.webVisitorId),
  ]
);

/**
 * Every belief we hold about two distincts being the same person.
 *
 * `estimate` rows live here and are read only by the funnel, which reports them
 * as a separate number. They never reach person_overrides and never influence a
 * person id. See CLAUDE.md rule 1.
 */
export const identityEdges = pgTable(
  "identity_edges",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fromType: distinctTypeEnum("from_type").notNull(),
    fromId: text("from_id").notNull(),
    toType: distinctTypeEnum("to_type").notNull(),
    toId: text("to_id").notNull(),
    method: edgeMethodEnum("method").notNull(),
    /** 1 for exact methods, strictly below 1 for estimates. */
    confidence: real("confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.method, t.fromType, t.fromId, t.toType, t.toId] }),
    index("edges_from_idx").on(t.projectId, t.fromType, t.fromId),
    index("edges_to_idx").on(t.projectId, t.toType, t.toId),
  ]
);

/**
 * The fast path for a merge.
 *
 * An exact link writes here immediately so queries are correct within a second,
 * and the squash job later folds it into events.person_id and deletes what it
 * drained. Small and hot by construction: if this table is large, squash is not
 * running.
 */
export const personOverrides = pgTable(
  "person_overrides",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    distinctType: distinctTypeEnum("distinct_type").notNull(),
    distinctId: text("distinct_id").notNull(),
    personId: uuid("person_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.distinctType, t.distinctId] })]
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
export type DownloadToken = typeof downloadTokens.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
