import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import ChevronRight from "lucide-solid/icons/chevron-right";
import BookOpen from "lucide-solid/icons/book-open";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import ListFilter from "lucide-solid/icons/list-filter";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { IngestHistogram, IngestRate, ingestTotal } from "../components/ingest-histogram.js";
import { PageHeader } from "../components/page-header.js";
import { RefreshButton } from "../components/refresh-button.js";
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Input,
  Kbd,
  buttonVariants,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { getSession, getWorkspaceSources, type WorkspaceSourceSummary } from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * Every source in the workspace, at one scope up from the project list.
 *
 * The project's own sources page answers "what is reporting into this product".
 * This answers the question a workspace has that no project page can: what is
 * reporting into ANY of them, and which of those went quiet. With four products
 * and eleven sources, finding the one that stopped meant opening four pages and
 * comparing four lists from memory.
 *
 * The row is the project list's row, one scope up: the same 75px shape, the
 * same left block, and the same thirty-day bar chart per row -- the literal
 * same component (`components/ingest-histogram.tsx`), over the literal same
 * window, because a reader WILL compare a source's bars against its project's
 * and two charts that only looked alike would make that comparison wrong.
 *
 * Nothing here creates or deletes a source. That belongs where a source belongs,
 * which is a project: the row links into the project that owns it, and the
 * install guide is one icon away for the person redeploying six months later.
 */
export const Route = createFileRoute("/w/$wslug/sources")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspaceSources({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceSources,
});

type Sort = "activity" | "volume" | "name";

/** How long a source can say nothing before "receiving" stops being true. */
const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

type ActivityFacet = "receiving" | "quiet" | "never";

/**
 * What the filter row narrows by, beside the project.
 *
 * The other group here used to be the surface, and it went with the concept. A
 * list of sources across a whole workspace is opened to find the one that has
 * stopped, so activity is the group that replaces it -- and the row states the
 * same fact in words, so a chip never hides a row for a reason the reader
 * cannot then see in the rows it kept.
 */
const ACTIVITY: Record<
  ActivityFacet,
  { labelKey: SimpleKey; match: (s: WorkspaceSourceSummary) => boolean }
> = {
  receiving: {
    labelKey: "sources.facet_receiving",
    match: (s) =>
      s.lastSeenAt !== null && Date.now() - new Date(s.lastSeenAt).getTime() <= QUIET_AFTER_MS,
  },
  quiet: {
    labelKey: "sources.facet_quiet",
    match: (s) =>
      s.lastSeenAt !== null && Date.now() - new Date(s.lastSeenAt).getTime() > QUIET_AFTER_MS,
  },
  never: { labelKey: "sources.facet_never", match: (s) => s.lastSeenAt === null },
};

const ACTIVITY_FACETS = Object.keys(ACTIVITY) as ActivityFacet[];

/**
 * The key each sort names, rather than the word.
 *
 * A record of literals so `t` keeps its closed union, read inside the component
 * so switching language re-renders the toolbar.
 */
const SORT_KEYS = {
  activity: "sources.sort_activity",
  volume: "sources.sort_volume",
  name: "sources.sort_name",
} as const satisfies Record<Sort, SimpleKey>;

function WorkspaceSources() {
  const i18n = useI18n();
  const data = Route.useLoaderData();
  const workspace = WorkspaceRoute.useLoaderData();

  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("activity");
  const [projects, setProjects] = createSignal<string[]>([]);
  const [activity, setActivity] = createSignal<ActivityFacet[]>([]);

  let searchField: HTMLInputElement | undefined;

  const sources = () => data().sources;
  const hasSources = () => sources().length > 0;

  // `/` focuses the search, which is the shortcut the placeholder advertises.
  // Guarded on the event target so typing a slash into any other field still
  // types a slash.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      searchField?.focus();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  /**
   * Only the projects this workspace actually has sources in. A facet that can
   * only ever match nothing is not a filter anybody would pick on purpose.
   */
  /** Only the states this workspace's sources are actually in. */
  const presentActivity = createMemo(() =>
    ACTIVITY_FACETS.filter((state) => sources().some(ACTIVITY[state].match))
  );

  const presentProjects = createMemo(() => {
    const seen = new Map<string, string>();
    for (const source of sources()) seen.set(source.projectSlug, source.projectName);
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
  });

  const toggle = <T,>(set: (fn: (current: T[]) => T[]) => void, value: T) =>
    set((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    );

  /** Newest activity first, nulls last, so "never seen" never leads the page. */
  const byActivity = (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) => {
    if (a.lastSeenAt === b.lastSeenAt) return a.name.localeCompare(b.name);
    if (!a.lastSeenAt) return 1;
    if (!b.lastSeenAt) return -1;
    return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
  };

  const byVolume = (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) =>
    ingestTotal(b.daily) - ingestTotal(a.daily) || a.name.localeCompare(b.name);

  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const chosen = projects();
    const states = activity();
    const order =
      sort() === "name"
        ? (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) => a.name.localeCompare(b.name)
        : sort() === "volume"
          ? byVolume
          : byActivity;

    return [...sources()]
      .filter((s) => states.length === 0 || states.some((state) => ACTIVITY[state].match(s)))
      .filter((s) => chosen.length === 0 || chosen.includes(s.projectSlug))
      .filter(
        (s) =>
          !needle ||
          s.name.toLowerCase().includes(needle) ||
          s.projectName.toLowerCase().includes(needle) ||
          s.ingestKey.toLowerCase().includes(needle)
      )
      .sort(order);
  });

  const narrowed = () => shown().length !== sources().length;

  return (
    <main class="w-full py-4">
      <PageHeader
        title={i18n.t("sources.title")}
        description={i18n.t("sources.workspace_hint")}
        filters={
          // Built only once there is something to filter. An `Add filter` chip
          // over a workspace with no sources is a control with nothing behind
          // it, and the heading drops its filter row when handed nothing.
          hasSources() ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger as={Button} variant="outline" size="sm" class="rounded-md">
                  <ListFilter class="size-3.5" />
                  {i18n.t("sources.add_filter")}
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{i18n.t("sources.facet_activity")}</DropdownMenuLabel>
                  <For each={presentActivity()}>
                    {(state) => (
                      <DropdownMenuItem onSelect={() => toggle(setActivity, state)}>
                        <Check
                          class={cn(
                            "size-4",
                            activity().includes(state) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {i18n.t(ACTIVITY[state].labelKey)}
                      </DropdownMenuItem>
                    )}
                  </For>

                  <DropdownMenuLabel>{i18n.t("sources.project_label")}</DropdownMenuLabel>
                  <For each={presentProjects()}>
                    {(project) => (
                      <DropdownMenuItem onSelect={() => toggle(setProjects, project.slug)}>
                        <Check
                          class={cn(
                            "size-4",
                            projects().includes(project.slug) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {project.name}
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* One chip per active facet, and clicking it takes that facet off. */}
              <For each={activity()}>
                {(state) => (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={i18n.t("sources.remove_filter", {
                      facet: i18n.t(ACTIVITY[state].labelKey),
                    })}
                    onClick={() => toggle(setActivity, state)}
                  >
                    <span class="text-muted-foreground">{i18n.t("sources.facet_activity")}:</span>
                    {i18n.t(ACTIVITY[state].labelKey)}
                    <X class="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </For>
              <For each={projects()}>
                {(slug) => (
                  <Button
                    variant="outline"
                    size="sm"
                    class="rounded-md"
                    aria-label={i18n.t("sources.remove_filter", { facet: slug })}
                    onClick={() => toggle(setProjects, slug)}
                  >
                    <span class="text-muted-foreground">{i18n.t("sources.project_label")}:</span>
                    {presentProjects().find((p) => p.slug === slug)?.name ?? slug}
                    <X class="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </For>
            </>
          ) : undefined
        }
      />

      <Show
        when={hasSources()}
        fallback={
          <Empty>
            <EmptyMedia>
              <Antenna />
            </EmptyMedia>
            <EmptyTitle>{i18n.t("sources.none_in_workspace")}</EmptyTitle>
            <EmptyDescription>{i18n.t("sources.none_in_workspace_hint")}</EmptyDescription>
            <EmptyContent>
              <Link
                to="/w/$wslug"
                params={{ wslug: workspace().view.workspace.slug }}
                class={buttonVariants({ size: "sm" })}
              >
                {i18n.t("sources.open_projects")}
              </Link>
            </EmptyContent>
          </Empty>
        }
      >
        <div class="flex flex-col gap-4">
          {/* The 36px toolbar row: search, sort, refresh. */}
          <div class="flex flex-row items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchField}
                type="search"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder={i18n.t("sources.search_placeholder")}
                aria-label={i18n.t("sources.search_label")}
                class="pr-10 pl-9"
              />
              <Kbd class="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                variant="outline"
                size="toolbar-icon"
                aria-label={i18n.t("sources.sort_by", { field: i18n.t(SORT_KEYS[sort()]) })}
                title={i18n.t("sources.sort_by", { field: i18n.t(SORT_KEYS[sort()]) })}
              >
                <ChevronsUpDown class="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <For each={["activity", "volume", "name"] as Sort[]}>
                  {(option) => (
                    <DropdownMenuItem onSelect={() => setSort(option)}>
                      <Check class={cn("size-4", sort() === option ? "opacity-100" : "opacity-0")} />
                      {i18n.t(SORT_KEYS[option])}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>

            <RefreshButton />
          </div>

          <div>
            <div class="mb-3 flex h-8 items-center justify-between gap-2 px-1.5">
              <span class="text-body font-medium text-foreground">{i18n.t("sources.title")}</span>
              <span class="text-caption text-muted-foreground">
                <Show when={narrowed()} fallback={<>{i18n.num(sources().length)}</>}>
                  {i18n.t("sources.count_of", {
                    shown: shown().length,
                    total: sources().length,
                  })}
                </Show>
              </span>
            </div>

            <Show
              when={shown().length > 0}
              fallback={
                <Card class="items-center justify-center px-4 py-10 text-center">
                  <span class="text-body text-muted-foreground">{i18n.t("sources.no_matches")}</span>
                </Card>
              }
            >
              {/* One ringed surface holding every row, divided by hairlines. */}
              <ul class="divide-y rounded-md bg-card shadow-sm">
                <For each={shown()}>
                  {(source) => (
                    <SourceRow workspace={workspace().view.workspace.slug} source={source} />
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </Show>
    </main>
  );
}

/**
 * One source, at the reference's 75px row shape.
 *
 * The row opens the source's own page, but it is not WRAPPED in an anchor:
 * three things on it are separately worth clicking (the project, the key, the
 * guide), and inside one anchor copying a key would be a navigation. So the
 * link is stretched across the row from underneath and everything interactive
 * sits above it.
 */
function SourceRow(props: { workspace: string; source: WorkspaceSourceSummary }) {
  const i18n = useI18n();
  const total = () => ingestTotal(props.source.daily);

  return (
    <li class="relative flex items-center gap-3 p-4 has-[a:hover]:bg-accent">
      {/* The stretched link. First in the markup and behind everything, so it
          is what a click on dead space in the row lands on. */}
      <Link
        to="/w/$wslug/$pslug/sources/$sid"
        params={{
          wslug: props.workspace,
          pslug: props.source.projectSlug,
          sid: props.source.id,
        }}
        class="absolute inset-0 z-0 outline-none"
        aria-label={i18n.t("sources.open_source", { name: props.source.name })}
      />

      <div class="pointer-events-none flex min-w-0 items-center gap-4 @md-page/page:w-[calc(25%+48px)]">
        <div class="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Antenna class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-body font-medium" title={props.source.name}>
            {props.source.name}
          </div>
          {/*
            Muted rather than a warning colour: a source added a minute ago has
            never been seen either, and nothing on this row tells the two apart.
            On `time`, so this is when the source was last ACTIVE rather than
            when we last heard from it.
          */}
          <div class="truncate text-caption text-muted-foreground">
            <Show when={props.source.lastSeenAt} fallback={i18n.t("sources.never_seen")}>
              {(at) => <>{i18n.t("sources.seen", { when: i18n.relative(at()) })}</>}
            </Show>
          </div>
        </div>
      </div>

      {/* Which product this reports into, and a way into it. The one thing this
          page has that the project's own list cannot. */}
      {/*
        The CELL stays transparent to the pointer and only the link inside it is
        raised. A raised cell swallows every click across its whole width, which
        is most of the row: the stretched link under it would then only work on
        the gaps between columns.
      */}
      <div class="pointer-events-none hidden w-[22%] min-w-0 shrink-0 flex-col gap-0.5 @md-page/page:flex">
        <span class="text-caption text-muted-foreground">
          {i18n.t("sources.project_label")}
        </span>
        <Link
          to="/w/$wslug/$pslug/sources"
          params={{ wslug: props.workspace, pslug: props.source.projectSlug }}
          class="pointer-events-auto relative z-10 w-fit max-w-full truncate text-body hover:underline"
          title={i18n.t("sources.open_project", { name: props.source.projectName })}
        >
          {props.source.projectName}
        </Link>
      </div>

      {/*
        No key on the row. It was the widest column here and it earned none of
        that: a public identifier nobody reads, that everybody scans past, in a
        list whose job is "which of these has stopped". It is still one click
        away on the source itself, where somebody who actually wants to paste it
        has gone looking for it.
      */}

      {/*
        The figure, then the shape it came from, at the geometry a project row
        uses: the rate stacked over its unit, then the month taking whatever is
        left. Both lists draw the same pair from the same component over the same
        window, so a source's bars can honestly be read against its project's.
        Thirty bars in 140px is a texture; thirty bars in three hundred is a
        shape, and the shape is what the row is here to show.
      */}
      <div class="pointer-events-none hidden shrink-0 @md-page/page:block">
        <IngestRate perHour={props.source.perHour} unit={i18n.t("sources.per_hour_unit")} />
      </div>

      <div class="pointer-events-none hidden min-w-0 flex-1 @md-page/page:block">
        <IngestHistogram
          daily={props.source.daily}
          label={i18n.t("sources.ingest_30d", { count: total() })}
        />
      </div>

      <div class="relative z-10 flex shrink-0 items-center gap-2">
        {/*
          The id travels in the query string, so the documentation opens with this source
          already selected and every snippet on it carries this key.
        */}
        <Link
          to="/docs"
          search={{ source: props.source.id }}
          class={buttonVariants({ variant: "ghost", size: "toolbar-icon" })}
          aria-label={i18n.t("sources.how_to_install", { name: props.source.name })}
          title={i18n.t("sources.guide_hint")}
        >
          <BookOpen class="size-4" />
        </Link>

        <ChevronRight class="pointer-events-none size-4 text-muted-foreground" />
      </div>
    </li>
  );
}
