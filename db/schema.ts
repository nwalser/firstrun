import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
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
 * One database for everything.
 *
 * Events, identity, auth and configuration used to be split across ClickHouse
 * and SQLite. At the shape this serves -- a desktop app with a few thousand
 * monthly visitors -- that split bought nothing and cost a second client, a
 * second migration runner, and a seam where the two could disagree. Postgres
 * does all of it, and the squash job becomes an ordinary transactional UPDATE
 * instead of an asynchronous mutation.
 *
 * The crossover is somewhere in the tens of millions of events per workspace.
 * When it arrives, the analytics tables move behind the same repository seam
 * that is here now.
 *
 * Drizzle owns the DDL. It does NOT own the analytics queries -- the funnel and
 * retention SQL lives in db/queries/*.sql, because those queries are the
 * product and should be readable by someone who knows SQL and nothing about
 * this codebase.
 */

// ---------------------------------------------------------------------------
// Enumerations. Genuinely closed sets, so the database enforces them.
// ---------------------------------------------------------------------------

export const surfaceEnum = pgEnum("surface", ["web", "app"]);

/** See CLAUDE.md rule 1: token and account are exact, estimate never is. */
export const edgeMethodEnum = pgEnum("edge_method", ["token", "account", "estimate"]);

export const distinctTypeEnum = pgEnum("distinct_type", ["web_visitor", "install", "account"]);

/** What kind of thing is sending events. A workspace usually has both. */
export const sourceKindEnum = pgEnum("source_kind", ["web", "desktop"]);

export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);

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
    /** Opaque random token. Stored hashed; the cookie holds the plaintext. */
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
// Workspaces and their ingestion sources
// ---------------------------------------------------------------------------

/**
 * A workspace is ONE identity namespace.
 *
 * This is the load-bearing decision in the whole model. A person is resolved
 * within a workspace, never within a source -- if the website and the desktop
 * app had separate person spaces, the web-to-install join could not exist, and
 * the join is the entire product. Sources are ingestion endpoints, nothing more.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_slug_key").on(t.slug)]
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("members_user_idx").on(t.userId)]
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: sourceKindEnum("kind").notNull(),
    /** Installer basename for desktop sources, e.g. `Themia-Setup`. */
    assetName: text("asset_name"),
    ingestKey: text("ingest_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sources_ingest_key_key").on(t.ingestKey),
    index("sources_workspace_idx").on(t.workspaceId),
  ]
);

/**
 * The one screen, as configured by whoever owns the workspace.
 *
 * `layout` is an ordered array of widgets from a fixed catalogue -- see
 * packages/schema/src/widgets.ts. Deliberately a catalogue and not a query
 * builder: every widget answers a question this product exists to answer, and
 * none of them let you assemble an arbitrary query. A generic explore view is
 * the failure mode here, and the line between "arrangeable" and "Grafana with
 * extra steps" is exactly that catalogue.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Overview"),
    layout: jsonb("layout").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dashboards_workspace_idx").on(t.workspaceId)]
);

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/** Minted at download, claimed on first run. The token lives in the filename. */
export const downloadTokens = pgTable(
  "download_tokens",
  {
    token: text("token").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    webVisitorId: text("web_visitor_id"),
    asset: text("asset").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [
    index("download_tokens_visitor_idx").on(t.workspaceId, t.webVisitorId),
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webVisitorId: text("web_visitor_id").notNull(),
    ipHash: text("ip_hash").notNull(),
    os: text("os"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("download_hints_lookup_idx").on(t.workspaceId, t.ipHash, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Events and identity
// ---------------------------------------------------------------------------

/**
 * The event store.
 *
 * `event_time` is client-stamped and authoritative; `ingest_time` is
 * server-stamped and read only while debugging. Nothing sorts, buckets, windows
 * or retains on ingest time -- an app offline for three days must land in the
 * bucket it happened in. See CLAUDE.md rule 2.
 *
 * The primary key is (workspace_id, event_id), which makes dedup a property of
 * the schema rather than a table someone has to remember to check. The desktop
 * SDK replays its disk queue after a crash, so duplicates are the normal case;
 * `ON CONFLICT DO NOTHING` handles them and reports how many were new.
 *
 * `person_id` is derived by @firstrun/identity. A client never sends one.
 */
export const events = pgTable(
  "events",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    primaryKey({ columns: [t.workspaceId, t.eventId] }),
    index("events_time_idx").on(t.workspaceId, t.eventTime),
    index("events_person_idx").on(t.workspaceId, t.personId),
    index("events_name_time_idx").on(t.workspaceId, t.eventName, t.eventTime),
    index("events_install_idx").on(t.workspaceId, t.installId),
    index("events_visitor_idx").on(t.workspaceId, t.webVisitorId),
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    primaryKey({ columns: [t.workspaceId, t.method, t.fromType, t.fromId, t.toType, t.toId] }),
    index("edges_from_idx").on(t.workspaceId, t.fromType, t.fromId),
    index("edges_to_idx").on(t.workspaceId, t.toType, t.toId),
  ]
);

/**
 * The fast path for a merge.
 *
 * An exact link writes here immediately so queries are correct within a second,
 * and the squash job later folds it into events.person_id and deletes what it
 * drained. Small and hot by construction: a row exists only between a merge and
 * the next squash. If this table is large, squash is not running.
 */
export const personOverrides = pgTable(
  "person_overrides",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    distinctType: distinctTypeEnum("distinct_type").notNull(),
    distinctId: text("distinct_id").notNull(),
    personId: uuid("person_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.distinctType, t.distinctId] })]
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
  sources: many(sources),
  dashboards: many(dashboards),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const sourcesRelations = relations(sources, ({ one }) => ({
  workspace: one(workspaces, { fields: [sources.workspaceId], references: [workspaces.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Dashboard = typeof dashboards.$inferSelect;
export type DownloadToken = typeof downloadTokens.$inferSelect;
