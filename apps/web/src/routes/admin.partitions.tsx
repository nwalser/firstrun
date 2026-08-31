import { createFileRoute, notFound } from "@tanstack/solid-router";
import Layers from "lucide-solid/icons/layers";
import { For, Show, createMemo } from "solid-js";
import { Fact, FactRow } from "../components/admin-shell.js";
import { PageHeader } from "../components/page-header.js";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  Empty,
  EmptyMedia,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/index.js";
import { getAdminPartitions, type AdminPartitionView } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * The partitions of `log_entries`, and the policy that maintains them.
 *
 * Its own page rather than a card on the database one, because this is the
 * table retention actually operates on. A month here is a `DROP TABLE`: there
 * is no bulk DELETE anywhere in the repo, and there must not be, because a
 * delete over tens of millions of rows takes a lock, writes as much WAL as the
 * rows it removes and leaves the space to autovacuum, all on the database that
 * is also serving the dashboard.
 *
 * The page is also where the maintenance job is visible. Months are created two
 * ahead and one behind, and a write arriving for a month nobody created is the
 * failure that policy exists to prevent: if the months ahead stop appearing
 * here, that is the warning, and it arrives before the entries do.
 *
 * Row counts are the planner's estimate, from `pg_class.reltuples`. An exact
 * count means reading every partition, which is precisely what a page about
 * storage must not do.
 */
export const Route = createFileRoute("/admin/partitions")({
  loader: async () => {
    const view = await getAdminPartitions();
    if (!view) throw notFound();
    return view;
  },
  component: AdminPartitionsPage,
});

function AdminPartitionsPage() {
  const view = Route.useLoaderData();
  const i18n = useI18n();

  const totals = createMemo(() => ({
    count: view().partitions.length,
    rows: view().partitions.reduce((sum, p) => sum + p.rows, 0),
    bytes: view().partitions.reduce((sum, p) => sum + p.bytes, 0),
  }));

  return (
    <main class="px-6 pb-6">
      <PageHeader
        title={i18n.t("admin.partitions_title")}
        description={i18n.t("admin.partitions_hint")}
      />

      <div class="flex flex-col gap-4">
        <FactRow>
          <Fact label={i18n.t("admin.partitions_total")}>{i18n.num(totals().count)}</Fact>
          <Fact label={i18n.t("admin.entries_stored")} hint={i18n.t("admin.estimated")}>
            {i18n.compact(totals().rows)}
          </Fact>
          <Fact label={i18n.t("admin.col_size")}>{i18n.fileSize(totals().bytes)}</Fact>
          <Fact label={i18n.t("admin.retention")}>
            {i18n.t("admin.months", { count: view().retentionMonths })}
          </Fact>
          <Fact label={i18n.t("admin.created_ahead")}>
            {i18n.t("admin.months", { count: view().monthsAhead })}
          </Fact>
          <Fact label={i18n.t("admin.created_behind")}>
            {i18n.t("admin.months", { count: view().monthsBack })}
          </Fact>
        </FactRow>

        <Alert>
          <AlertDescription>{i18n.t("admin.partitions_note")}</AlertDescription>
        </Alert>

        <Card>
          <CardContent class="px-0">
            <Show
              when={view().partitions.length > 0}
              fallback={
                <Empty>
                  <EmptyMedia>
                    <Layers />
                  </EmptyMedia>
                  <EmptyTitle>{i18n.t("admin.arrivals_empty")}</EmptyTitle>
                </Empty>
              }
            >
              <div class="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18n.t("admin.col_partition")}</TableHead>
                      <TableHead>{i18n.t("admin.col_from")}</TableHead>
                      <TableHead>{i18n.t("admin.col_to")}</TableHead>
                      <TableHead numeric>{i18n.t("admin.col_rows")}</TableHead>
                      <TableHead numeric>{i18n.t("admin.col_size")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <For each={view().partitions}>
                      {(partition) => <PartitionRow partition={partition} />}
                    </For>
                  </TableBody>
                </Table>
              </div>
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function PartitionRow(props: { partition: AdminPartitionView }) {
  const i18n = useI18n();

  return (
    <TableRow>
      <TableCell class="py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate font-medium">{props.partition.name}</span>
          {/*
            The default partition is the one worth marking. Anything that
            arrives for a month nobody created lands in it, so a row here with
            entries in it means the maintenance job has fallen behind rather
            than that somebody sent something odd.
          */}
          <Show when={props.partition.from === null}>
            <Badge variant="outline">{i18n.t("admin.default_partition")}</Badge>
          </Show>
        </div>
      </TableCell>

      <TableCell class="py-2 text-muted-foreground">
        {props.partition.from ? i18n.shortDate(props.partition.from) : "--"}
      </TableCell>
      <TableCell class="py-2 text-muted-foreground">
        {props.partition.to ? i18n.shortDate(props.partition.to) : "--"}
      </TableCell>
      <TableCell numeric class="py-2">
        {i18n.num(props.partition.rows)}
      </TableCell>
      <TableCell numeric class="py-2">
        {i18n.fileSize(props.partition.bytes)}
      </TableCell>
    </TableRow>
  );
}
