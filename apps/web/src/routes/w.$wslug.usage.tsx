import { Link, createFileRoute, notFound, redirect, useNavigate } from "@tanstack/solid-router";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Gauge from "lucide-solid/icons/gauge";
import ListFilter from "lucide-solid/icons/list-filter";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, type JSX } from "solid-js";
import { PageHeader } from "../components/page-header.js";
import { PlanMeter } from "../components/plan-meter.js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { getSession, getWorkspaceUsage, type UsageSlice } from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * Usage: how much this workspace has taken in, and where it came from.
 *
 * Shaped after the reference's account-level usage page
 * (`docs/vercel-structure.md` section 20): an `h1`, a row of dropdown filters
 * under it, one summary card, then a "Consumption breakdown" card holding a
 * stacked daily chart with the table of the same series underneath it. The
 * reference groups by product and can group by project; ours groups by project,
 * by source or by severity, because those are the three dimensions this data
 * model actually has.
 *
 * The reference's included-credit meter is the card at the top, and it is
 * conditional: it appears only where there IS an allowance, which means on the
 * hosted service. A self-hosted install resolves no ceilings at all, so the
 * card renders nothing and this page is exactly what it always was. A progress
 * bar with no limit behind it would be a decoration pretending to be a number,
 * which is why the condition is on the limit and not on an edition flag.
 *
 * The meter and everything below it count differently, and that is deliberate
 * rather than a discrepancy to reconcile. The meter counts entries as they
 * ARRIVE, because that is the only window that closes and the only number an
 * invoice can be checked against. Everything else on the page counts them on
 * `time`, because that is when they happened. Both say which they are.
 *
 * Two things about the numbers, both from CLAUDE.md and both stated on screen:
 *
 *  - Usage is ENTRIES, and every entry counts once. There is no error pipeline
 *    to be billed differently, because there is no error pipeline (rule 1).
 *  - The count is on `time`, which the client stamps. A machine that was
 *    offline for a day adds to the day it was used, so recent days keep filling
 *    in after the fact (rule 5). That is the first question anybody asks about
 *    these numbers, so the page answers it before it is asked.
 *
 * At project scope this is the same page with `?project=` on it rather than a
 * different route: the scope switcher narrows the filter and stays put. See
 * `lib/scope.ts`.
 */

/** The windows on offer. Each one prunes to a handful of partitions. */
const WINDOWS = [7, 30, 90] as const;

type Window = (typeof WINDOWS)[number];

/** Which dimension the chart and the table are cut by. */
type Group = "project" | "source" | "severity";

const GROUPS = ["project", "source", "severity"] as const;

/**
 * The label for each dimension, as a key rather than a word: resolved inside
 * the component, so switching language re-renders the toolbar.
 */
const GROUP_KEYS = {
  project: "usage.by_project",
  source: "usage.by_source",
  severity: "usage.by_severity",
} as const satisfies Record<Group, SimpleKey>;

interface UsageSearch {
  days: Window;
  group: Group;
  /** A project slug, or nothing for the whole workspace. */
  project?: string;
}

const isWindow = (n: unknown): n is Window => WINDOWS.includes(n as Window);
const isGroup = (v: unknown): v is Group => GROUPS.includes(v as Group);

export const Route = createFileRoute("/w/$wslug/usage")({
  // Everything optional, everything defaulted: a hand-edited or older link
  // opens on the default view rather than on an error.
  validateSearch: (search: Record<string, unknown>): UsageSearch => {
    const days = Number(search.days);
    return {
      days: isWindow(days) ? days : 30,
      group: isGroup(search.group) ? search.group : "project",
      ...(typeof search.project === "string" && search.project
        ? { project: search.project }
        : {}),
    };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspaceUsage({
      data: { workspace: params.wslug, days: deps.days, project: deps.project ?? null },
    });
    if (!view) throw notFound();
    return view;
  },
  component: Usage,
});

/**
 * How many series the chart draws before the rest become one band.
 *
 * Five, because that is how many chart tokens the palette has and because a
 * stack of twenty bands is a colour-matching exercise rather than a chart. The
 * TABLE still lists every row: the cap is on what can be told apart, not on
 * what is reported.
 */
const SERIES = 5;

function Usage() {
  const i18n = useI18n();
  const view = Route.useLoaderData();
  const search = Route.useSearch();
  const workspace = WorkspaceRoute.useLoaderData();
  const navigate = useNavigate({ from: "/w/$wslug/usage" });

  const projects = () => workspace().view.projects;

  const narrow = (next: Partial<UsageSearch>) =>
    navigate({ search: (prev: UsageSearch) => ({ ...prev, ...next }), replace: true });

  const rows = (): UsageSlice[] => {
    switch (search().group) {
      case "source":
        return view().bySource;
      case "severity":
        return view().bySeverity;
      default:
        return view().byProject;
    }
  };

  const total = () => view().total;
  const delta = () => i18n.delta(change(total(), view().previousTotal));

  /** Per day, over the window, so a total has a scale beside it. */
  const perDay = () => (view().days.length === 0 ? 0 : total() / view().days.length);

  const busiest = createMemo(() => {
    const totals = view().days.map((_, i) =>
      view().byProject.reduce((sum, row) => sum + (row.daily[i] ?? 0), 0)
    );
    let best = -1;
    let at = -1;
    totals.forEach((n, i) => {
      if (n > best) {
        best = n;
        at = i;
      }
    });
    return at >= 0 && best > 0 ? { day: view().days[at]!, entries: best } : null;
  });

  /**
   * The bands the chart draws: the biggest few, and everything else as one.
   *
   * `rows()` is already sorted by size on the server, so this is a slice rather
   * than a sort, and the remainder is folded day by day so the stack still adds
   * up to the day's real total.
   */
  const bands = createMemo(() => {
    const all = rows();
    const top = all.slice(0, SERIES);
    const rest = all.slice(SERIES);
    if (rest.length === 0) return top;

    const daily = view().days.map((_, i) =>
      rest.reduce((sum, row) => sum + (row.daily[i] ?? 0), 0)
    );
    return [
      ...top,
      {
        key: "__other",
        label: i18n.t("usage.other"),
        projectSlug: null,
        entries: rest.reduce((sum, row) => sum + row.entries, 0),
        previous: null,
        daily,
      },
    ];
  });

  const windowLabel = (days: Window) => i18n.t("usage.window_days", { days });

  const projectName = () =>
    projects().find((p) => p.slug === search().project)?.name ?? search().project ?? "";

  return (
    <main class="w-full py-4">
      <PageHeader
        title={i18n.t("usage.title")}
        description={i18n.t("usage.hint")}
        filters={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger as={Button} variant="outline" size="sm" class="rounded-md">
                <ListFilter class="size-3.5" />
                {i18n.t("usage.window_label")}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{i18n.t("usage.window_label")}</DropdownMenuLabel>
                <For each={WINDOWS}>
                  {(days) => (
                    <DropdownMenuItem onSelect={() => void narrow({ days })}>
                      <Check
                        class={cn("size-4", search().days === days ? "opacity-100" : "opacity-0")}
                      />
                      {windowLabel(days)}
                    </DropdownMenuItem>
                  )}
                </For>

                <DropdownMenuLabel>{i18n.t("usage.project_label")}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void narrow({ project: undefined })}>
                  <Check class={cn("size-4", search().project ? "opacity-0" : "opacity-100")} />
                  {i18n.t("usage.all_projects")}
                </DropdownMenuItem>
                <For each={projects()}>
                  {(project) => (
                    <DropdownMenuItem onSelect={() => void narrow({ project: project.slug })}>
                      <Check
                        class={cn(
                          "size-4",
                          search().project === project.slug ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {project.name}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* The window is always a chip: these numbers mean nothing without
                it, and "over what period" is the first question. */}
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              <span class="text-muted-foreground">{i18n.t("usage.window_label")}:</span>
              {windowLabel(search().days)}
            </Badge>

            <Show when={search().project}>
              <Button
                variant="outline"
                size="sm"
                class="rounded-md"
                aria-label={i18n.t("usage.remove_filter", {
                  filter: i18n.t("usage.project_label"),
                })}
                onClick={() => void narrow({ project: undefined })}
              >
                <span class="text-muted-foreground">{i18n.t("usage.project_label")}:</span>
                {projectName()}
                <X class="size-3.5 text-muted-foreground" />
              </Button>
            </Show>

            {/* The reference's "By Product" cell, in the same row and with the
                same job: it decides what the chart's bands and the table's rows
                are, not what is counted. */}
            <DropdownMenu>
              <DropdownMenuTrigger as={Button} variant="outline" size="sm" class="rounded-md">
                {i18n.t(GROUP_KEYS[search().group])}
                <ChevronsUpDown class="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{i18n.t("usage.group_label")}</DropdownMenuLabel>
                <For each={GROUPS}>
                  {(group) => (
                    <DropdownMenuItem onSelect={() => void narrow({ group })}>
                      <Check
                        class={cn("size-4", search().group === group ? "opacity-100" : "opacity-0")}
                      />
                      {i18n.t(GROUP_KEYS[group])}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div class="flex flex-col gap-4">
        {/*
          The plan meter, on the hosted service only. It is the reference's
          included-credit card, and it is the one thing on this page counted on
          arrival rather than on `time`.
        */}
        <PlanMeter
          billing={workspace().view.billing}
          workspaceSlug={workspace().view.workspace.slug}
          role={workspace().view.workspace.role}
        />

        {/*
          The summary card. Volume against the window before it, which is the
          question this page answers whether or not there is a plan above it.
          Three facts, one row, and both resolved windows written out: a delta
          whose baseline is unstated is a number nobody can check.
        */}
        <Card>
          <CardContent class="flex flex-col gap-4 @md-page/page:flex-row @md-page/page:items-end @md-page/page:gap-10">
            <div class="min-w-0">
              <div class="text-caption text-muted-foreground">{i18n.t("usage.events")}</div>
              <div class="flex items-baseline gap-2">
                <span class="text-h1 tabular-nums">{i18n.num(total())}</span>
                <Show when={delta()} fallback={<span class="sr-only" />}>
                  {(d) => (
                    <span
                      class={cn(
                        "text-caption",
                        d().dir === "up"
                          ? "text-positive"
                          : d().dir === "down"
                            ? "text-negative"
                            : "text-muted-foreground"
                      )}
                    >
                      {d().label}
                    </span>
                  )}
                </Show>
              </div>
              <div class="mt-0.5 truncate text-caption text-muted-foreground">
                {i18n.dateRange(view().from, view().to)}
                {" · "}
                {i18n.t("usage.against", {
                  range: i18n.dateRange(view().compare.from, view().compare.to),
                })}
              </div>
            </div>

            <Fact label={i18n.t("usage.per_day")}>
              {i18n.num(perDay(), { maximumFractionDigits: 0 })}
            </Fact>

            <Show when={busiest()}>
              {(day) => (
                <Fact label={i18n.t("usage.busiest_day")}>
                  {i18n.shortDate(day().day)}
                  <span class="ml-2 text-muted-foreground">{i18n.num(day().entries)}</span>
                </Fact>
              )}
            </Show>

            <p class="max-w-md text-caption text-muted-foreground @md-page/page:ml-auto">
              {i18n.t("usage.late_note")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("usage.breakdown")}</CardTitle>
            {/* The reference's Daily / Weekly / Monthly segmented control sits
                here. Ours has one bucket: every window on offer is short enough
                that a day is the readable unit, and a control with one option
                is a label. */}
            <Badge variant="outline">{i18n.t("usage.daily")}</Badge>
          </CardHeader>

          <CardContent class="flex flex-col gap-4">
            <Show
              when={total() > 0}
              fallback={
                <Empty>
                  <EmptyMedia>
                    <Gauge />
                  </EmptyMedia>
                  <EmptyTitle>{i18n.t("usage.none")}</EmptyTitle>
                  <EmptyDescription>{i18n.t("usage.none_hint")}</EmptyDescription>
                </Empty>
              }
            >
              <StackedDays days={view().days} bands={bands()} total={total()} />

              <table class="w-full text-body">
                <thead>
                  <tr class="border-b text-caption text-muted-foreground">
                    <th class="py-2 text-left font-normal">{i18n.t("usage.col_name")}</th>
                    <th class="py-2 text-right font-normal">{i18n.t("usage.col_events")}</th>
                    <th class="py-2 text-right font-normal">{i18n.t("usage.col_share")}</th>
                    <th class="py-2 text-right font-normal">{i18n.t("usage.col_change")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows()}>
                    {(row, i) => (
                      <Row
                        row={row}
                        total={total()}
                        tone={i() < SERIES ? TONES[i()]! : "bg-muted-foreground/40"}
                        workspace={workspace().view.workspace.slug}
                      />
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

/** A labelled figure in the summary card. */
function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="min-w-0 shrink-0">
      <div class="text-caption text-muted-foreground">{props.label}</div>
      <div class="truncate text-body tabular-nums">{props.children}</div>
    </div>
  );
}

/**
 * The five chart tokens, in order, plus the band everything else falls into.
 *
 * Fills rather than strokes, and the same order the table is sorted in, so the
 * dot beside a row names the band above it without a legend of its own.
 */
const TONES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

const FILLS = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5"];

/** The change between two numbers, or null when there is nothing to compare. */
function change(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Entries per day, stacked by band.
 *
 * Drawn in viewBox units with `preserveAspectRatio="none"`, the same trade as
 * `IngestHistogram`: a rectangle stretched horizontally still reads as a
 * rectangle. No text goes inside the SVG for exactly that reason -- stretched
 * type does not -- so the scale and the dates are HTML around it.
 *
 * A day with nothing gets a one-unit stub in the border colour, so a window
 * always shows as many bars as it has days. A gap would read as a shorter
 * window.
 */
function StackedDays(props: { days: string[]; bands: UsageSlice[]; total: number }) {
  const i18n = useI18n();

  const totals = createMemo(() =>
    props.days.map((_, i) => props.bands.reduce((sum, band) => sum + (band.daily[i] ?? 0), 0))
  );
  const max = createMemo(() => Math.max(1, ...totals()));
  const width = createMemo(() => Math.max(1, props.days.length * PITCH - GAP));

  /**
   * The geometry, computed once rather than accumulated while rendering.
   *
   * A running offset mutated inside the JSX would be wrong the moment Solid
   * re-evaluated one of those attributes on its own: the accumulator would keep
   * climbing and the stack would walk off the top of the box. Plain data in,
   * plain rectangles out.
   *
   * Bottom-up, so the biggest band is the base of every column and the eye can
   * follow one series across the chart.
   */
  const columns = createMemo(() =>
    props.days.map((_, day) => {
      const bars: Array<{ fill: string; y: number; h: number }> = [];
      let offset = 0;
      props.bands.forEach((band, b) => {
        const value = band.daily[day] ?? 0;
        if (value <= 0) return;
        const h = (value / max()) * HEIGHT;
        bars.push({ fill: FILLS[b] ?? "fill-muted-foreground/40", y: HEIGHT - offset - h, h });
        offset += h;
      });
      return bars;
    })
  );

  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-baseline justify-between text-caption text-muted-foreground">
        <span class="tabular-nums">{i18n.num(max())}</span>
        <span>{i18n.t("usage.daily")}</span>
      </div>

      <svg
        class="block h-40 w-full"
        viewBox={`0 0 ${width()} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={i18n.t("usage.chart_label", { count: props.total })}
      >
        <For each={columns()}>
          {(bars, day) => (
            <>
              {/* A day with nothing still gets a bar, in the border colour: a
                  window has to show as many bars as it has days, or it reads as
                  a shorter window. */}
              <Show when={bars.length === 0}>
                <rect
                  class="fill-border"
                  x={day() * PITCH}
                  y={HEIGHT - 1}
                  width={PITCH - GAP}
                  height={1}
                />
              </Show>
              <For each={bars}>
                {(bar) => (
                  <rect
                    class={bar.fill}
                    x={day() * PITCH}
                    y={bar.y}
                    width={PITCH - GAP}
                    height={bar.h}
                  />
                )}
              </For>
            </>
          )}
        </For>
      </svg>

      {/* The axis, as HTML: two dates and nothing between them. The chart has a
          bar per day and no gridlines, so a tick per day would be noise, and
          text inside a stretched viewBox would be stretched with it. */}
      <div class="flex items-baseline justify-between text-caption text-muted-foreground">
        <span>{props.days[0] ? i18n.shortDate(props.days[0]) : ""}</span>
        <span>
          {props.days.length > 0 ? i18n.shortDate(props.days[props.days.length - 1]!) : ""}
        </span>
      </div>
    </div>
  );
}

/** The histogram's units: a 3-wide bar every 4, in a 100-tall box. */
const PITCH = 4;
const GAP = 1;
const HEIGHT = 100;

/** One row of the breakdown. */
function Row(props: { row: UsageSlice; total: number; tone: string; workspace: string }) {
  const i18n = useI18n();
  const share = () => i18n.share(props.row.entries, props.total);
  const delta = () => i18n.delta(change(props.row.entries, props.row.previous));

  return (
    <tr class="border-b last:border-b-0">
      <td class="py-2">
        <span class="flex min-w-0 items-center gap-2">
          <span class={cn("size-2 shrink-0 rounded-full", props.tone)} aria-hidden="true" />
          <Show
            when={props.row.projectSlug}
            fallback={
              <span class="truncate" title={props.row.label}>
                {props.row.label}
              </span>
            }
          >
            {(slug) => (
              <Link
                to="/w/$wslug/$pslug"
                params={{ wslug: props.workspace, pslug: slug() }}
                class="min-w-0 truncate hover:underline"
                title={i18n.t("usage.open_project", { name: props.row.label })}
              >
                {props.row.label}
              </Link>
            )}
          </Show>
        </span>
      </td>
      <td class="py-2 text-right tabular-nums">{i18n.num(props.row.entries)}</td>
      <td class="py-2 text-right tabular-nums text-muted-foreground">{share() ?? "-"}</td>
      <td class="py-2 text-right tabular-nums">
        <Show when={delta()} fallback={<span class="text-muted-foreground">-</span>}>
          {(d) => (
            <span
              class={
                d().dir === "up"
                  ? "text-positive"
                  : d().dir === "down"
                    ? "text-negative"
                    : "text-muted-foreground"
              }
            >
              {d().label}
            </span>
          )}
        </Show>
      </td>
    </tr>
  );
}
