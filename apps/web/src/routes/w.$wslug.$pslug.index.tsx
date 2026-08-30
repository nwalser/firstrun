import { OVERVIEW_RANGE, describeRange, overviewQuestions } from "@firstrun/schema";
import { sparklineQuery } from "@firstrun/schema/board";
import { queryKey, rowsAt, type LogQuery, type QueryRow } from "@firstrun/schema/query";
import { SURFACE_LABELS, type Surface } from "@firstrun/schema/surface";
import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Calendar from "lucide-solid/icons/calendar";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Plug from "lucide-solid/icons/plug";
import Plus from "lucide-solid/icons/plus";
import { For, Show, type JSX } from "solid-js";
import { ROW_INTERACTION } from "../components/page-header.js";
import { RefreshButton } from "../components/refresh-button.js";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  buttonVariants,
} from "../components/ui/index.js";
import { VisualisationBody } from "../components/widgets.js";
import { cn } from "../lib/cn.js";
import { getProjectOverview, getSession, type SourceSummary } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * The project overview: where a project opens.
 *
 * This used to redirect to the first board, which meant a project had no page
 * of its own and the sidebar's "Overview" row led somewhere else. The two
 * questions somebody arrives with (is this thing alive, and what is it saying)
 * were answerable only by reading a board that may have been arranged to answer
 * something entirely different.
 *
 * So it is a page now, and a FIXED one: seven cards, one window, no picker and
 * nothing to drag. That is the whole difference between this and a board. Every
 * number on it comes out of the same five-part query a customer builds their
 * own cards from (`packages/schema/src/overview.ts`), and every answer is
 * looked up by a key derived here from the same query the server derived it
 * from, so nothing is passed by name.
 *
 * The boards are still one click away, from the sidebar and from the card at
 * the bottom right, and the toolbar's primary action opens the first one.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });

    // The snapshot alone. The project, its sources and its boards are already
    // loaded by the layout route, and asking for them twice to draw one page is
    // a second round trip for facts the page is holding.
    const snapshot = await getProjectOverview({
      data: { workspace: params.wslug, project: params.pslug },
    });
    if (!snapshot) throw notFound();
    return snapshot;
  },
  component: ProjectOverview,
  pendingComponent: ProjectOverviewPending,
});

/**
 * What this page is while its numbers are still being counted.
 *
 * It is the one page in the product whose loader is seven SQL queries over a
 * partitioned table, so it is also the one that can visibly take a moment. With
 * nothing here the router simply held the previous route on screen and the
 * whole app looked frozen: no spinner, no skeleton, no cursor, and the same
 * board still showing its old numbers.
 *
 * The shape is the real page's, card for card, so nothing moves when the
 * answers land. The router only shows this after its own pending delay, so a
 * fast load never flashes it.
 */
function ProjectOverviewPending() {
  return (
    <main class="flex flex-col gap-6 py-6">
      <div class="flex h-control-md flex-row items-center gap-2">
        <Skeleton class="h-4 w-64" />
      </div>
      <div class="mt-4 grid grid-cols-1 gap-4 @lg-page/page:grid-cols-3">
        {/*
          Seven cards at the page's own fixed height, two of them double width,
          in the order the page draws them.
        */}
        <Skeleton class="h-[240px] @lg-page/page:col-span-2" />
        <Skeleton class="h-[240px]" />
        <Skeleton class="h-[240px]" />
        <Skeleton class="h-[240px]" />
        <Skeleton class="h-[240px]" />
        <Skeleton class="h-[240px] @lg-page/page:col-span-2" />
        <Skeleton class="h-[240px]" />
      </div>
    </main>
  );
}

/**
 * The questions, resolved once.
 *
 * Module scope rather than per render: they are pure data, and the keys derived
 * from them are what every card looks its own answer up by.
 */
const Q = overviewQuestions();

/** How long a project can say nothing before the status card stops saying fine. */
const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

function ProjectOverview() {
  const i18n = useI18n();
  const snapshot = Route.useLoaderData();
  const nav = ProjectRoute.useLoaderData();

  const workspace = () => nav().workspace.slug;
  const project = () => nav().project;
  const sources = () => nav().sources;
  const boards = () => nav().dashboards;
  const isAdmin = () => nav().role === "admin";

  const rows = (query: LogQuery): QueryRow[] => rowsAt(snapshot().results, queryKey(query));
  const previous = (query: LogQuery): QueryRow[] | null => {
    const earlier = snapshot().previous;
    return earlier ? rowsAt(earlier, queryKey(query)) : null;
  };
  const compare = () => snapshot().compare;
  const measured = () => i18n.dateRange(snapshot().from, snapshot().to);

  /** The most recent entry from any source, which is what "alive" means here. */
  const lastSeen = (): string | null => {
    const stamps = sources()
      .map((s) => s.lastSeenAt)
      .filter((at): at is string => at !== null);
    return stamps.length === 0 ? null : stamps.reduce((a, b) => (a > b ? a : b));
  };

  const firstBoard = () => boards()[0] ?? null;

  return (
    // The dashboard variant of a page: a 24px-gap column of a 36px toolbar row
    // and then the body, with no `h1` at all. Vertical padding only, because the
    // shell's page track already supplies the 24px side margin as grid columns.
    <main class="flex flex-col gap-6 py-6">
      {/*
        What a heading would have said, the project's name, is already the top
        bar's scope segment and the breadcrumb title. What the toolbar carries
        instead is the thing these numbers cannot be read without: the resolved
        days they cover, and the resolved days every delta is measured against.
        A baseline nobody can see is a percentage nobody can check.
      */}
      <div class="flex h-control-md flex-row items-center gap-2">
        <Calendar class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex min-w-0 flex-1 items-center gap-2 text-body">
          <span class="shrink-0 text-muted-foreground">{describeRange(OVERVIEW_RANGE)}</span>
          <span class="truncate">{measured()}</span>
          <Show when={compare()}>
            {(baseline) => (
              <span class="truncate text-muted-foreground">
                {i18n.t("project.against", {
                  range: i18n.dateRange(baseline().from, baseline().to),
                })}
              </span>
            )}
          </Show>
        </div>

        {/* Re-reads the snapshot in place. The window is fixed on this page, so
            "is this thing alive" is a question whose answer changes without
            anything on screen changing, and a reload was the only way to ask
            it again. */}
        <RefreshButton />

        <Link
          to="/w/$wslug/$pslug/sources"
          params={{ wslug: workspace(), pslug: project().slug }}
          class={buttonVariants({ variant: "outline", size: "toolbar" })}
        >
          {i18n.t("project.sources")}
          <Badge variant="secondary">{i18n.num(sources().length)}</Badge>
        </Link>
        <Show when={firstBoard()}>
          {(board) => (
            <Link
              to="/w/$wslug/$pslug/dashboards/$dslug"
              params={{ wslug: workspace(), pslug: project().slug, dslug: board().slug }}
              class={buttonVariants({ size: "toolbar" })}
            >
              {i18n.t("project.open_board", { name: board().name })}
            </Link>
          )}
        </Show>
      </div>

      <Show
        when={sources().length > 0}
        fallback={
          <Empty>
            <EmptyMedia>
              <Plug />
            </EmptyMedia>
            <EmptyTitle>{i18n.t("project.no_sources")}</EmptyTitle>
            <EmptyDescription>{i18n.t("project.no_sources_hint")}</EmptyDescription>
            <Show when={isAdmin()}>
              <EmptyContent>
                <Link
                  to="/w/$wslug/$pslug/sources/new"
                  params={{ wslug: workspace(), pslug: project().slug }}
                  class={buttonVariants({ size: "sm" })}
                >
                  {i18n.t("project.add_source")}
                </Link>
              </EmptyContent>
            </Show>
          </Empty>
        }
      >
        {/*
          One column becoming three, which is the reference's project overview
          and the opposite of the canvas next door: a page nobody arranges does
          not need a grid you can leave gaps in. There is no two-column step in
          between, because a two-up row of these cards was never measured and it
          puts the hero at a width nothing else on the page shares.

          The breakpoint is a CONTAINER query on the shell's page pane, not a
          viewport one. The pane is what the content actually has: collapsing
          the sidebar, or opening a panel beside the content, has to reflow this
          as if the window had changed size. A viewport breakpoint here read the
          window and squeezed three cards into a pane half that wide.
        */}
        <div class="mt-4 grid grid-cols-1 gap-4 @lg-page/page:grid-cols-3">
          {/*
            The hero. The headline figure beside its own shape over time: the
            same pairing the reference gives a production deployment, what it is
            on the left and what it looks like on the right.
          */}
          <OverviewCard
            class="@lg-page/page:col-span-2"
            title={i18n.t("project.card_events")}
            hint={measured()}
          >
            <div class="flex h-full min-h-0 gap-5">
              <div class="w-2/5 min-w-0 max-w-[220px]">
                <VisualisationBody
                  viz="number"
                  query={Q.entries}
                  rows={rows(Q.entries)}
                  previous={previous(Q.entries)}
                  compare={compare()}
                  sparkline={[]}
                />
              </div>
              <div class="min-w-0 flex-1">
                <VisualisationBody
                  viz="area"
                  query={Q.series}
                  rows={rows(Q.series)}
                  previous={previous(Q.series)}
                  compare={compare()}
                />
              </div>
            </div>
          </OverviewCard>

          <StatusCard
            lastSeen={lastSeen()}
            sources={sources()}
            boards={boards().length}
            measured={measured()}
          />

          <OverviewCard
            title={i18n.t("project.card_uniques")}
            hint={i18n.t("project.card_uniques_hint")}
          >
            <VisualisationBody
              viz="number"
              query={Q.uniques}
              rows={rows(Q.uniques)}
              previous={previous(Q.uniques)}
              compare={compare()}
              sparkline={rows(sparklineQuery(Q.uniques))}
            />
          </OverviewCard>

          <OverviewCard
            title={i18n.t("project.card_errors")}
            hint={i18n.t("project.card_errors_hint")}
          >
            <VisualisationBody
              viz="number"
              query={Q.errors}
              rows={rows(Q.errors)}
              previous={previous(Q.errors)}
              compare={compare()}
              sparkline={rows(sparklineQuery(Q.errors))}
            />
          </OverviewCard>

          <OverviewCard
            title={i18n.t("project.card_names")}
            hint={i18n.t("project.card_names_hint")}
          >
            <VisualisationBody viz="list" query={Q.names} rows={rows(Q.names)} />
          </OverviewCard>

          <OverviewCard
            class="@lg-page/page:col-span-2"
            title={i18n.t("project.card_sources")}
            hint={i18n.t("project.card_sources_hint")}
            action={
              <Link
                to="/w/$wslug/$pslug/sources"
                params={{ wslug: workspace(), pslug: project().slug }}
                class={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {i18n.t("common.all")}
                <ArrowRight />
              </Link>
            }
          >
            <div class="h-full min-h-0 overflow-auto">
              <For each={sources()}>
                {(source) => (
                  <Row>
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-foreground" title={source.name}>
                        {source.name}
                      </span>
                      <Badge variant="secondary">{SURFACE_LABELS[source.kind]}</Badge>
                    </span>
                    {/*
                      Muted rather than a warning colour: a source added a minute
                      ago has never been seen either, and nothing here tells the
                      two apart.
                    */}
                    <span class="shrink-0 text-muted-foreground">
                      {source.lastSeenAt
                        ? i18n.relative(source.lastSeenAt)
                        : i18n.t("project.never_seen")}
                    </span>
                  </Row>
                )}
              </For>
            </div>
          </OverviewCard>

          <OverviewCard
            title={i18n.t("project.card_boards")}
            hint={i18n.t("project.card_boards_hint")}
            action={
              <Show when={isAdmin()}>
                <Link
                  to="/w/$wslug/$pslug/dashboards/new"
                  params={{ wslug: workspace(), pslug: project().slug }}
                  class={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Plus />
                  {i18n.t("project.new_board")}
                </Link>
              </Show>
            }
          >
            <div class="h-full min-h-0 overflow-auto">
              <Show
                when={boards().length > 0}
                fallback={
                  <div class="flex h-full items-center justify-center px-2 text-center">
                    <span class="text-caption text-muted-foreground">
                      {i18n.t("project.no_boards")}
                    </span>
                  </div>
                }
              >
                <For each={boards()}>
                  {(board) => (
                    <Link
                      to="/w/$wslug/$pslug/dashboards/$dslug"
                      params={{ wslug: workspace(), pslug: project().slug, dslug: board.slug }}
                      /*
                        The same fill and the same focus ring as every other
                        clickable row in the product. It used to have neither:
                        the arrow nudged and nothing else happened, so the only
                        row on this page you can actually follow was the one
                        that looked least like a target. The fill bleeds 8px
                        into the card's own padding so it reads as a row rather
                        than as a box drawn around the text.
                      */
                      class={cn(ROW_INTERACTION, "group -mx-2 block rounded-sm px-2")}
                    >
                      <Row>
                        <span class="flex min-w-0 items-center gap-2">
                          <LayoutDashboard class="size-3.5 shrink-0 text-muted-foreground" />
                          <span class="truncate text-foreground">{board.name}</span>
                        </span>
                        <ArrowRight class="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Row>
                    </Link>
                  )}
                </For>
              </Show>
            </div>
          </OverviewCard>
        </div>
      </Show>
    </main>
  );
}

/**
 * One card of the overview.
 *
 * A fixed height, which on a board would be a bug and here is the point: this
 * page is not a canvas, nobody resizes these, and a row of cards that agree on
 * their height is what makes a grid read as one page rather than as a pile.
 */
function OverviewCard(props: {
  title: string;
  hint?: string;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Card class={cn("h-[240px]", props.class)}>
      <CardHeader>
        <div class="min-w-0">
          <CardTitle class="truncate">{props.title}</CardTitle>
          <Show when={props.hint}>
            {(hint) => (
              <div class="mt-0.5 truncate text-caption text-muted-foreground" title={hint()}>
                {hint()}
              </div>
            )}
          </Show>
        </div>
        {props.action}
      </CardHeader>
      <CardContent class="min-h-0 flex-1">{props.children}</CardContent>
    </Card>
  );
}

/** A row in one of the two list cards. Same pitch as the ranked list beside it. */
function Row(props: { children: JSX.Element }) {
  return (
    <div
      class={cn(
        "flex items-center justify-between gap-3 border-b py-1.5 text-caption",
        "last:border-b-0"
      )}
    >
      {props.children}
    </div>
  );
}

/** A label and its value, in the metadata card beside the hero. */
function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div
      class={cn(
        "flex items-baseline justify-between gap-3 border-b py-1.5 text-caption",
        "last:border-b-0"
      )}
    >
      <span class="shrink-0 text-muted-foreground">{props.label}</span>
      <span class="min-w-0 truncate text-right text-foreground">{props.children}</span>
    </div>
  );
}

/**
 * Is this thing alive.
 *
 * Read off the sources' own last-seen stamps rather than out of a query,
 * because "nothing arrived in the window" and "nothing has ever arrived" are
 * different answers and only one of them is a problem. Those stamps are on
 * `time`, which is client-stamped: an app that was offline for a day sends its
 * backlog when it next runs, so a quiet hour is not an outage.
 */
function StatusCard(props: {
  lastSeen: string | null;
  sources: SourceSummary[];
  boards: number;
  measured: string;
}) {
  const i18n = useI18n();

  const quiet = () =>
    props.lastSeen !== null && Date.now() - new Date(props.lastSeen).getTime() > QUIET_AFTER_MS;

  const state = () => {
    if (props.lastSeen === null) {
      return { dot: "bg-muted-foreground", label: i18n.t("project.status_silent") };
    }
    if (quiet()) return { dot: "bg-warning", label: i18n.t("project.status_quiet") };
    return { dot: "bg-positive", label: i18n.t("project.status_receiving") };
  };

  /** "2 Web, 1 Desktop", so the shape of the project reads in one line. */
  const surfaces = () => {
    const counts = new Map<Surface, number>();
    for (const source of props.sources) {
      counts.set(source.kind, (counts.get(source.kind) ?? 0) + 1);
    }
    // The count goes through the active locale; the surface does not. It is one
    // of the schema's five closed values and it is the same word in both
    // languages, which is the point of leaving it in English.
    return [...counts.entries()]
      .map(([kind, n]) => `${i18n.num(n)} ${SURFACE_LABELS[kind]}`)
      .join(", ");
  };

  return (
    <OverviewCard title={i18n.t("project.card_status")} hint={props.measured}>
      <div class="flex h-full min-h-0 flex-col">
        <Fact label={i18n.t("project.fact_reporting")}>
          <span class="inline-flex items-center gap-2">
            <span class={cn("size-2 rounded-full", state().dot)} aria-hidden="true" />
            {state().label}
          </span>
        </Fact>
        <Fact label={i18n.t("project.fact_last_event")}>
          {props.lastSeen ? i18n.relative(props.lastSeen) : i18n.t("common.never")}
        </Fact>
        <Fact label={i18n.t("project.fact_sources")}>
          {surfaces() || i18n.t("common.none")}
        </Fact>
        <Fact label={i18n.t("project.fact_boards")}>{i18n.num(props.boards)}</Fact>
      </div>
    </OverviewCard>
  );
}
