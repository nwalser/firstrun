import type { Namespaced } from "./namespace.js";

/**
 * The operator's pages: the deployment, its workspaces, its database, its
 * partitions.
 *
 * Written for whoever runs the service, not for a customer, so the register is
 * flatter than the rest of the app: no reassurance, no explanation of what a
 * workspace is, and numbers rather than sentences.
 *
 * There are no page descriptions and no explanatory notes here, and that is the
 * register rather than an omission: a label, a number and a one-word qualifier
 * on the numbers that need one. The one prose string left is the caveat about
 * forced plans, because that one is a footgun on a control sitting directly
 * underneath it rather than a description of what a page is for.
 */
export const admin = {
  "admin.title": "Deployment",
  "admin.nav": "Deployment",

  // The summary strip.
  "admin.workspaces": "Workspaces",
  "admin.total_entries": "Entries this month",
  "admin.paying": "On a paid plan",
  "admin.period": "Billed period",

  // The table.
  "admin.col_workspace": "Workspace",
  "admin.col_plan": "Plan",
  "admin.col_status": "Status",
  "admin.col_entries": "Entries",
  "admin.col_limit": "Limit",
  "admin.col_projects": "Projects",
  "admin.col_people": "People",
  "admin.col_last_seen": "Last received",
  "admin.never": "Never",
  "admin.no_limit": "No limit",
  "admin.limit_placeholder": "Plan default",
  "admin.override": "Override",
  "admin.of_previous": "was {count}",
  "admin.stripe_linked": "Has a Stripe customer",

  // Status values, so the table does not print raw column values.
  "admin.status_active": "Active",
  "admin.status_past_due": "Past due",
  "admin.status_canceled": "Cancelled",

  // Actions and their consequences.
  "admin.set_plan": "Set plan",
  "admin.set_status": "Set status",
  "admin.plan_forced": "{workspace} is now on {plan}.",
  "admin.limit_set": "{workspace} is capped at {count} entries a month.",
  "admin.limit_cleared": "{workspace} is back on its plan's limit.",
  "admin.forced_warning":
    "Forcing a plan writes the same columns Stripe writes. A workspace with a live subscription " +
    "goes back to whatever its price says on the next Stripe event. To lift a ceiling durably, " +
    "set a limit instead.",

  "admin.empty": "No workspaces on this instance yet",

  // The shell around these pages.
  "admin.back_to_app": "Back to the app",
  "admin.group_instance": "Instance",
  "admin.nav_overview": "Overview",
  "admin.nav_workspaces": "Workspaces",
  "admin.nav_database": "Database",
  "admin.nav_partitions": "Partitions",
  "admin.edition_cloud": "Cloud",
  "admin.edition_self": "Self-hosted",

  // Overview.
  "admin.workspaces_title": "Workspaces",
  "admin.database_title": "Database",
  "admin.partitions_title": "Partitions",

  // Counts and sizes.
  "admin.stat_projects": "Projects",
  "admin.stat_sources": "Sources",
  "admin.stat_people": "Accounts",
  "admin.stat_boards": "Boards",
  "admin.entries_stored": "Entries stored",
  "admin.estimated": "Estimated",
  "admin.exact": "Counted",
  "admin.db_size": "Database size",
  "admin.pg_version": "Postgres",
  "admin.uptime": "Up since",
  "admin.reading_taken": "Read at",

  // Arrivals.
  "admin.arrivals_title": "Entries received",
  "admin.arrivals_empty": "Nothing has arrived in the last 30 days",

  // The database page.
  "admin.cache_hit": "Cache hit ratio",
  "admin.connections": "Connections",
  "admin.conn_active": "Active",
  "admin.conn_idle": "Idle",
  "admin.conn_idle_tx": "Idle in transaction",
  "admin.conn_of_max": "of {max}",
  "admin.dead_rows": "Dead rows",
  "admin.dead_rows_hint": "Awaiting vacuum, across every table",
  "admin.tables_title": "Tables",
  "admin.col_table": "Table",
  "admin.col_rows": "Rows",
  "admin.col_total": "Total",
  "admin.col_heap": "Heap",
  "admin.col_indexes": "Indexes",
  "admin.col_dead": "Dead",
  "admin.col_vacuumed": "Last vacuum",
  "admin.partition_count_one": "{count} partition",
  "admin.partition_count_other": "{count} partitions",
  "admin.counters_title": "Counters",
  "admin.stats_since": "Cumulative since {date}",
  "admin.stats_never_reset": "Cumulative since the statistics were last reset",
  "admin.commits": "Commits",
  "admin.rollbacks": "Rollbacks",
  "admin.blocks_hit": "Blocks from cache",
  "admin.blocks_read": "Blocks read from disk",
  "admin.temp_files": "Temp files",
  "admin.temp_bytes": "Temp written",
  "admin.deadlocks": "Deadlocks",

  // The partitions page.
  "admin.col_partition": "Partition",
  "admin.col_from": "From",
  "admin.col_to": "To",
  "admin.col_size": "Size",
  "admin.default_partition": "Default, no bound",
  "admin.partitions_total": "Partitions",
  "admin.retention": "Retention",
  "admin.months_one": "{count} month",
  "admin.months_other": "{count} months",
  "admin.created_ahead": "Created ahead",
  "admin.created_behind": "Created behind",
} satisfies Namespaced<"admin">;

export type AdminMessages = typeof admin;
