import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";
import { Fact, FactRow } from "../components/admin-shell.js";
import { PageHeader } from "../components/page-header.js";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/index.js";
import { getAdminDatabase, type AdminRelationView } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Storage, vacuum state and the pool.
 *
 * The four questions an operator has when something has got slow and nothing
 * about the code changed: which table IS the database, is autovacuum keeping up
 * with it, are the connections where they should be, and is the working set
 * still in memory. All four come from `pg_catalog` and `pg_stat_*`, so the page
 * costs a handful of catalogue reads and touches no customer data.
 *
 * Row counts are exact for the small tables and estimated for `log_entries`,
 * and the column says which each one is. Mixing the two silently would be worse
 * than either: the number an operator quotes in a support conversation has to
 * be one they can say how they got.
 */
export const Route = createFileRoute("/admin/database")({
  loader: async () => {
    const view = await getAdminDatabase();
    if (!view) throw notFound();
    return view;
  },
  component: AdminDatabasePage,
});

function AdminDatabasePage() {
  const view = Route.useLoaderData();
  const i18n = useI18n();

  const deadRows = createMemo(() =>
    view().relations.reduce((sum, row) => sum + row.deadRows, 0)
  );

  const hit = () => view().activity.cacheHitRatio;

  return (
    <main class="px-6 pb-6">
      <PageHeader title={i18n.t("admin.database_title")} />

      <div class="flex flex-col gap-4">
        <FactRow>
          <Fact label={i18n.t("admin.db_size")}>{i18n.fileSize(view().server.bytes)}</Fact>
          <Fact label={i18n.t("admin.pg_version")}>{view().server.version}</Fact>
          <Fact
            label={i18n.t("admin.connections")}
            hint={i18n.t("admin.conn_of_max", { max: view().connections.max })}
          >
            {i18n.num(view().connections.total)}
          </Fact>
          <Fact label={i18n.t("admin.cache_hit")}>
            {/*
              Below 99% the working set no longer fits in shared buffers. The
              threshold is drawn rather than described, because this is the
              number somebody scans for on the way past.
            */}
            <span class={cn(hit() !== null && hit()! < 0.99 && "text-warning")}>
              {hit() === null ? "--" : i18n.percent(hit()!)}
            </span>
          </Fact>
          <Fact label={i18n.t("admin.dead_rows")} hint={i18n.t("admin.dead_rows_hint")}>
            {i18n.compact(deadRows())}
          </Fact>
        </FactRow>

        <Card>
          <CardHeader class="flex-col items-stretch gap-1">
            <CardTitle>{i18n.t("admin.tables_title")}</CardTitle>
          </CardHeader>

          <CardContent class="px-0">
            {/* Eight columns of numbers is wider than a phone. It scrolls
                inside the card rather than making the page scroll sideways. */}
            <div class="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{i18n.t("admin.col_table")}</TableHead>
                    <TableHead numeric>{i18n.t("admin.col_rows")}</TableHead>
                    <TableHead numeric>{i18n.t("admin.col_total")}</TableHead>
                    <TableHead numeric>{i18n.t("admin.col_heap")}</TableHead>
                    <TableHead numeric>{i18n.t("admin.col_indexes")}</TableHead>
                    <TableHead numeric>{i18n.t("admin.col_dead")}</TableHead>
                    <TableHead>{i18n.t("admin.col_vacuumed")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <For each={view().relations}>{(row) => <RelationRow row={row} />}</For>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <CountersCard activity={view().activity} connections={view().connections} />
      </div>
    </main>
  );
}

function RelationRow(props: { row: AdminRelationView }) {
  const i18n = useI18n();

  return (
    <TableRow>
      <TableCell class="py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate font-medium">{props.row.name}</span>
          <Show when={props.row.partitioned}>
            <Badge variant="outline">
              {i18n.t("admin.partition_count", { count: props.row.partitions })}
            </Badge>
          </Show>
        </div>
      </TableCell>

      <TableCell numeric class="py-2">
        <div>{i18n.num(props.row.rows)}</div>
        {/* Which kind of number this is, on the number itself. An estimate and
            a count sitting in one column with nothing to tell them apart is how
            somebody quotes the wrong one. */}
        <div class="text-caption text-muted-foreground">
          {props.row.exact ? i18n.t("admin.exact") : i18n.t("admin.estimated")}
        </div>
      </TableCell>

      <TableCell numeric class="py-2">
        {i18n.fileSize(props.row.totalBytes)}
      </TableCell>
      <TableCell numeric class="py-2 text-muted-foreground">
        {i18n.fileSize(props.row.tableBytes)}
      </TableCell>
      <TableCell numeric class="py-2 text-muted-foreground">
        {i18n.fileSize(props.row.indexBytes)}
      </TableCell>
      <TableCell numeric class="py-2">
        {i18n.compact(props.row.deadRows)}
      </TableCell>
      <TableCell class="py-2 text-caption text-muted-foreground">
        {props.row.lastVacuum ? i18n.relative(props.row.lastVacuum) : i18n.t("admin.never")}
      </TableCell>
    </TableRow>
  );
}

/**
 * The cumulative counters, and the pool broken out.
 *
 * They are cumulative since `statsReset`, which is stated rather than left for
 * somebody to wonder about: a rollback count means nothing without knowing what
 * it is counted over, and on a managed Postgres that window is not the same as
 * the deployment's uptime.
 */
function CountersCard(props: {
  activity: {
    commits: number;
    rollbacks: number;
    blocksRead: number;
    blocksHit: number;
    tempFiles: number;
    tempBytes: number;
    deadlocks: number;
    statsReset: string | null;
  };
  connections: { active: number; idle: number; idleInTransaction: number };
}) {
  const i18n = useI18n();

  return (
    <Card>
      <CardHeader class="flex-col items-stretch gap-1">
        <CardTitle>{i18n.t("admin.counters_title")}</CardTitle>
        <CardDescription>
          {props.activity.statsReset
            ? i18n.t("admin.stats_since", { date: i18n.dateTime(props.activity.statsReset) })
            : i18n.t("admin.stats_never_reset")}
        </CardDescription>
      </CardHeader>

      {/* `lg-page`, not a step above it: `--container-2xl-page` is not a
          declared token, so an arbitrary variant naming it compiles to no CSS
          at all and the grid silently stays at two columns. */}
      <CardContent class="grid grid-cols-2 gap-4 @md-page/page:grid-cols-3 @lg-page/page:grid-cols-5">
        <Fact label={i18n.t("admin.conn_active")}>{i18n.num(props.connections.active)}</Fact>
        <Fact label={i18n.t("admin.conn_idle")}>{i18n.num(props.connections.idle)}</Fact>
        <Fact label={i18n.t("admin.conn_idle_tx")}>
          {/* The one connection state worth colouring. A session idle in a
              transaction holds its locks and pins the oldest snapshot, which is
              what stops vacuum reclaiming anything above it. */}
          <span class={cn(props.connections.idleInTransaction > 0 && "text-warning")}>
            {i18n.num(props.connections.idleInTransaction)}
          </span>
        </Fact>
        <Fact label={i18n.t("admin.commits")}>{i18n.compact(props.activity.commits)}</Fact>
        <Fact label={i18n.t("admin.rollbacks")}>{i18n.compact(props.activity.rollbacks)}</Fact>

        <Fact label={i18n.t("admin.blocks_hit")}>{i18n.compact(props.activity.blocksHit)}</Fact>
        <Fact label={i18n.t("admin.blocks_read")}>{i18n.compact(props.activity.blocksRead)}</Fact>
        <Fact label={i18n.t("admin.temp_files")}>{i18n.num(props.activity.tempFiles)}</Fact>
        <Fact label={i18n.t("admin.temp_bytes")}>{i18n.fileSize(props.activity.tempBytes)}</Fact>
        <Fact label={i18n.t("admin.deadlocks")}>
          <span class={cn(props.activity.deadlocks > 0 && "text-negative")}>
            {i18n.num(props.activity.deadlocks)}
          </span>
        </Fact>
      </CardContent>
    </Card>
  );
}
