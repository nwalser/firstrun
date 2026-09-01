import type { AdminMessages } from "./admin.en.js";

/**
 * "Deployment", "Workspace", "Plan" und "Stripe" bleiben englisch, wie überall
 * sonst in der Oberfläche. "Entry" wird zu "Eintrag", weil hier gezählt und
 * abgerechnet wird.
 *
 * Register wie im Englischen: knapp, für den Betreiber und nicht für Kundschaft.
 */
export const admin: AdminMessages = {
  "admin.title": "Deployment",
  "admin.nav": "Deployment",

  "admin.workspaces": "Workspaces",
  "admin.total_entries": "Einträge diesen Monat",
  "admin.paying": "Auf bezahltem Plan",
  "admin.period": "Abrechnungszeitraum",

  "admin.col_workspace": "Workspace",
  "admin.col_plan": "Plan",
  "admin.col_status": "Status",
  "admin.col_entries": "Einträge",
  "admin.col_limit": "Limit",
  "admin.col_projects": "Projekte",
  "admin.col_people": "Personen",
  "admin.col_last_seen": "Zuletzt empfangen",
  "admin.never": "Nie",
  "admin.no_limit": "Kein Limit",
  "admin.limit_placeholder": "Plan-Standard",
  "admin.override": "Override",
  "admin.of_previous": "vorher {count}",
  "admin.stripe_linked": "Hat einen Stripe-Kunden",

  "admin.status_active": "Aktiv",
  "admin.status_past_due": "Zahlung offen",
  "admin.status_canceled": "Gekündigt",

  "admin.set_plan": "Plan setzen",
  "admin.set_status": "Status setzen",
  "admin.plan_forced": "{workspace} ist jetzt auf {plan}.",
  "admin.limit_set": "{workspace} ist auf {count} Einträge pro Monat begrenzt.",
  "admin.limit_cleared": "{workspace} nutzt wieder das Limit seines Plans.",
  "admin.forced_warning":
    "Einen Plan zu erzwingen schreibt dieselben Spalten wie Stripe. Ein Workspace mit aktivem " +
    "Abo fällt beim nächsten Stripe-Ereignis auf den Plan seines Preises zurück. Für eine " +
    "dauerhafte Anhebung stattdessen ein Limit setzen.",

  "admin.empty": "Noch keine Workspaces auf dieser Instanz",

  "admin.back_to_app": "Zurück zur App",
  "admin.group_instance": "Instanz",
  "admin.nav_overview": "Übersicht",
  "admin.nav_workspaces": "Workspaces",
  "admin.nav_database": "Datenbank",
  "admin.nav_partitions": "Partitionen",
  "admin.edition_cloud": "Cloud",
  "admin.edition_self": "Selbst gehostet",

  "admin.workspaces_title": "Workspaces",
  "admin.database_title": "Datenbank",
  "admin.partitions_title": "Partitionen",

  "admin.stat_projects": "Projekte",
  "admin.stat_sources": "Sources",
  "admin.stat_people": "Konten",
  "admin.stat_boards": "Boards",
  "admin.entries_stored": "Gespeicherte Einträge",
  "admin.estimated": "Geschätzt",
  "admin.exact": "Gezählt",
  "admin.db_size": "Datenbankgröße",
  "admin.pg_version": "Postgres",
  "admin.uptime": "Läuft seit",
  "admin.reading_taken": "Gelesen um",

  "admin.arrivals_title": "Empfangene Einträge",
  "admin.arrivals_empty": "In den letzten 30 Tagen ist nichts angekommen",

  "admin.cache_hit": "Cache-Trefferquote",
  "admin.connections": "Verbindungen",
  "admin.conn_active": "Aktiv",
  "admin.conn_idle": "Idle",
  "admin.conn_idle_tx": "Idle in Transaktion",
  "admin.conn_of_max": "von {max}",
  "admin.dead_rows": "Tote Zeilen",
  "admin.dead_rows_hint": "Warten auf Vacuum, über alle Tabellen",
  "admin.tables_title": "Tabellen",
  "admin.col_table": "Tabelle",
  "admin.col_rows": "Zeilen",
  "admin.col_total": "Gesamt",
  "admin.col_heap": "Heap",
  "admin.col_indexes": "Indizes",
  "admin.col_dead": "Tot",
  "admin.col_vacuumed": "Letztes Vacuum",
  "admin.partition_count_one": "{count} Partition",
  "admin.partition_count_other": "{count} Partitionen",
  "admin.counters_title": "Zähler",
  "admin.stats_since": "Kumulativ seit {date}",
  "admin.stats_never_reset": "Kumulativ seit dem letzten Zurücksetzen der Statistik",
  "admin.commits": "Commits",
  "admin.rollbacks": "Rollbacks",
  "admin.blocks_hit": "Blöcke aus dem Cache",
  "admin.blocks_read": "Blöcke von der Platte",
  "admin.temp_files": "Temp-Dateien",
  "admin.temp_bytes": "Temp geschrieben",
  "admin.deadlocks": "Deadlocks",

  "admin.col_partition": "Partition",
  "admin.col_from": "Von",
  "admin.col_to": "Bis",
  "admin.col_size": "Größe",
  "admin.default_partition": "Default, ohne Grenze",
  "admin.partitions_total": "Partitionen",
  "admin.retention": "Retention",
  "admin.months_one": "{count} Monat",
  "admin.months_other": "{count} Monate",
  "admin.created_ahead": "Vorab angelegt",
  "admin.created_behind": "Rückwirkend angelegt",
};
