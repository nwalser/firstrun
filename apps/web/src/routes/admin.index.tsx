import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show, createMemo } from "solid-js";
import { Fact, FactRow } from "../components/admin-shell.js";
import { PageHeader } from "../components/page-header.js";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/index.js";
import { getAdminInstance } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * The deployment at a glance.
 *
 * The first question an operator has is never about one workspace: it is how
 * much of this there is, what it is running on, and whether anything is still
 * arriving. Those are three cards, and each of them is a catalogue read or a
 * roll-up, so opening this page costs the database nothing worth measuring.
 *
 * `entriesStored` is the planner's ESTIMATE and the card says so beneath it.
 * Counting the rows would read every partition of `log_entries`, which is the
 * one thing a page about storage must not do, and an approximate number that
 * admits it beats an exact one nobody can afford.
 */
export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const view = await getAdminInstance();
    if (!view) throw notFound();
    return view;
  },
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const view = Route.useLoaderData();
  const i18n = useI18n();

  const uptime = () => {
    const started = view().server.startedAt;
    if (!started) return null;
    return i18n.duration(new Date(view().server.now).getTime() - new Date(started).getTime());
  };

  return (
    <main class="px-6 pb-6">
      <PageHeader title={i18n.t("admin.title")} description={i18n.t("admin.overview_hint")} />

      <div class="flex flex-col gap-4">
        <Show when={!view().cloud}>
          {/* Recorded and ignored, which is worth saying out loud: the columns
              are the same in both editions and only one of them reads them. */}
          <Alert>
            <AlertDescription>{i18n.t("admin.self_hosted")}</AlertDescription>
          </Alert>
        </Show>

        <FactRow>
          <Fact label={i18n.t("admin.workspaces")}>{i18n.num(view().workspaces)}</Fact>
          <Fact label={i18n.t("admin.stat_projects")}>
            {i18n.num(view().counts.projects ?? 0)}
          </Fact>
          <Fact label={i18n.t("admin.stat_sources")}>{i18n.num(view().counts.sources ?? 0)}</Fact>
          <Fact label={i18n.t("admin.stat_people")}>{i18n.num(view().counts.users ?? 0)}</Fact>
          <Fact label={i18n.t("admin.stat_boards")}>{i18n.num(view().counts.dashboards ?? 0)}</Fact>
        </FactRow>

        <FactRow>
          <Fact
            label={i18n.t("admin.entries_stored")}
            hint={i18n.t("admin.estimated")}
          >
            {i18n.compact(view().entriesStored)}
          </Fact>
          <Fact
            label={i18n.t("admin.total_entries")}
            hint={i18n.dateRange(view().period.from, view().period.to)}
          >
            {i18n.num(view().entriesThisMonth)}
          </Fact>
          <Fact label={i18n.t("admin.db_size")}>{i18n.fileSize(view().server.bytes)}</Fact>
          <Fact label={i18n.t("admin.pg_version")}>{view().server.version}</Fact>
          <Show when={uptime()}>
            {(up) => (
              <Fact
                label={i18n.t("admin.uptime")}
                hint={i18n.dateTime(view().server.startedAt!)}
              >
                {up()}
              </Fact>
            )}
          </Show>
        </FactRow>

        <ArrivalsCard days={view().arrivals} />
      </div>
    </main>
  );
}

/**
 * Thirty days of arrivals, as bars.
 *
 * Drawn as divs rather than through the query layer, and deliberately: the
 * board compiler answers questions about a customer's entries inside one
 * project, and this is one number per day across every workspace on the box,
 * off the billing roll-up. Running it through the dashboard would mean giving
 * the compiler a mode with no project in it, which is exactly the widening rule
 * 8 exists to prevent.
 *
 * Scaled against the busiest day rather than against a fixed ceiling, so a
 * quiet deployment still shows a shape. The busiest day's own number is on the
 * axis, which is what stops a full-height bar reading as a limit.
 */
function ArrivalsCard(props: { days: { day: string; entries: number }[] }) {
  const i18n = useI18n();
  const peak = createMemo(() => Math.max(0, ...props.days.map((d) => d.entries)));
  const total = createMemo(() => props.days.reduce((sum, d) => sum + d.entries, 0));

  return (
    <Card>
      <CardHeader class="flex-col items-stretch gap-1">
        <CardTitle>{i18n.t("admin.arrivals_title")}</CardTitle>
        <CardDescription>{i18n.t("admin.arrivals_hint")}</CardDescription>
      </CardHeader>

      <CardContent>
        <Show
          when={total() > 0}
          fallback={
            <p class="text-body text-muted-foreground">{i18n.t("admin.arrivals_empty")}</p>
          }
        >
          <div class="flex flex-col gap-2">
            <div class="flex h-32 items-end gap-1">
              <For each={props.days}>
                {(day) => (
                  <div
                    class="min-w-0 flex-1 rounded-t-sm bg-foreground/80"
                    /* A day with entries never rounds to nothing: 2px is the
                       floor, so "quiet" and "silent" stay different shapes. */
                    style={{
                      height:
                        day.entries === 0
                          ? "1px"
                          : `${Math.max(2, (day.entries / peak()) * 100)}%`,
                    }}
                    title={`${i18n.shortDate(day.day)}: ${i18n.num(day.entries)}`}
                  />
                )}
              </For>
            </div>

            <div class="flex items-center justify-between text-caption text-muted-foreground">
              <span>{i18n.shortDate(props.days[0]!.day)}</span>
              <span class="tabular-nums">{i18n.compact(peak())}</span>
              <span>{i18n.shortDate(props.days[props.days.length - 1]!.day)}</span>
            </div>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}
