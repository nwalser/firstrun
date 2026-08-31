import { Link, createFileRoute } from "@tanstack/solid-router";
import Check from "lucide-solid/icons/check";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import List from "lucide-solid/icons/list";
import ListFilter from "lucide-solid/icons/list-filter";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { IngestHistogram, IngestRate, ingestTotal } from "../components/ingest-histogram.js";
import { PageHeader, ROW_INTERACTION } from "../components/page-header.js";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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
  initials,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import type { MemberSummary, ProjectListItem } from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * The workspace overview: every project, and what the workspace is doing.
 *
 * Shaped after the reference's list page and its team overview
 * (`docs/vercel-structure.md` sections 1.7, 5 and 8.2), which is a different
 * page from the one this used to be in four ways worth naming.
 *
 * 1. **A heading block, then a toolbar.** The 32px title row carries the
 *    workspace name and the 32px row under it carries the filters. Then one
 *    36px toolbar row: search, sort, a view toggle and one primary action. A
 *    workspace with twenty projects needs to find one, and a grid of cards with
 *    no search is a page you scroll.
 * 2. **One divided surface, not a field of tiles.** The list is a single ringed
 *    container with hairlines between its rows, so it reads as one object. The
 *    grid is the alternative the toggle offers, not the default.
 * 3. **A rail.** The main column is the projects; the 320/404px column beside
 *    it carries what the workspace is doing and who is in it. On a project page
 *    that column would be noise. Here it is the only place those facts have.
 * 4. **No role pill.** The reference states scope once, on the sidebar's
 *    workspace switcher row, rather than restating it on every page.
 *
 * The breakpoints are CONTAINER queries on the shell's page pane, never
 * viewport ones: the sidebar collapsing has to reflow this as if the window had
 * changed size, and the pane is roughly a third narrower than the window.
 *
 * The page pads vertically only. The shell's page track already supplies the
 * 24px side margin as grid columns, and padding here would sit inside that.
 */
export const Route = createFileRoute("/w/$wslug/")({
  component: WorkspaceProjects,
});

type View = "grid" | "list";
type Sort = "activity" | "name";

/**
 * The key each sort names, rather than the word.
 *
 * A record of literals, so `t` still sees a key from its closed union and a
 * typo is a compile error. The label is read inside the component, which is
 * what makes switching language re-render the toolbar.
 */
const SORT_KEYS = {
  activity: "workspace.sort_activity",
  name: "workspace.sort_name",
} as const satisfies Record<Sort, SimpleKey>;

/** How long a project can say nothing before "receiving" stops being true. */
const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

type FacetKey = "activity" | "sources";

interface Facet {
  key: FacetKey;
  value: string;
}

/**
 * What the filter row can narrow the list by.
 *
 * A row shows its source count, so the sources facet narrows on something the
 * reader can then see in the rows it kept. Activity does not: the row draws a
 * rate and a month, and neither says when the last event actually landed. That
 * chip is the only way to ask, which is why it stays: a project with sources
 * and nothing received is the interesting failure, and "Sources: Connected"
 * plus "Activity: Nothing yet" asks for exactly that set.
 */
const FACETS: Array<{
  key: FacetKey;
  labelKey: SimpleKey;
  options: Array<{ value: string; labelKey: SimpleKey; match: (p: ProjectListItem) => boolean }>;
}> = [
  {
    key: "activity",
    labelKey: "workspace.facet_activity",
    options: [
      {
        value: "receiving",
        labelKey: "workspace.facet_receiving",
        match: (p) =>
          p.lastEventAt !== null &&
          Date.now() - new Date(p.lastEventAt).getTime() <= QUIET_AFTER_MS,
      },
      {
        value: "quiet",
        labelKey: "workspace.facet_quiet",
        match: (p) =>
          p.lastEventAt !== null &&
          Date.now() - new Date(p.lastEventAt).getTime() > QUIET_AFTER_MS,
      },
      {
        value: "silent",
        labelKey: "workspace.facet_silent",
        match: (p) => p.lastEventAt === null,
      },
    ],
  },
  {
    key: "sources",
    labelKey: "workspace.facet_sources",
    options: [
      { value: "some", labelKey: "workspace.facet_connected", match: (p) => p.sourceCount > 0 },
      { value: "none", labelKey: "common.none", match: (p) => p.sourceCount === 0 },
    ],
  },
];

/**
 * The two keys a chip prints, or null for a facet nobody defines any more.
 *
 * Keys rather than words, because this runs at module scope: a word resolved
 * here would be frozen in whichever locale was active when the module was first
 * evaluated. The component translates them where it draws them.
 */
function facetLabels(facet: Facet): { facet: SimpleKey; value: SimpleKey } | null {
  const group = FACETS.find((f) => f.key === facet.key);
  const option = group?.options.find((o) => o.value === facet.value);
  return group && option ? { facet: group.labelKey, value: option.labelKey } : null;
}

/** An unknown facet matches everything: a stale chip narrows nothing silently. */
function facetMatches(facet: Facet, project: ProjectListItem): boolean {
  const option = FACETS.find((f) => f.key === facet.key)?.options.find(
    (o) => o.value === facet.value
  );
  return option ? option.match(project) : true;
}

/**
 * How the reader last looked at this list, remembered across navigation.
 *
 * A view toggle that resets every time you come back is worse than no toggle:
 * you have to notice it reset before you trust what you are reading.
 *
 * Read in `onMount` and never during render, which is what keeps the server's
 * HTML and the client's first render identical. Touching `localStorage` during
 * render would also throw outright wherever site data is blocked, and a throw
 * during render takes the page down over a preference.
 */
const VIEW_KEY = "firstrun.workspace.view";
const SORT_KEY = "firstrun.workspace.sort";

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the page renders the same, it just forgets.
  }
}

function WorkspaceProjects() {
  const i18n = useI18n();
  const data = WorkspaceRoute.useLoaderData();

  const workspace = () => data().view.workspace;
  const members = () => data().view.members;
  const isAdmin = () => workspace().role === "admin";

  const [query, setQuery] = createSignal("");
  const [facets, setFacets] = createSignal<Facet[]>([]);
  const [view, setViewSignal] = createSignal<View>("list");
  const [sort, setSortSignal] = createSignal<Sort>("activity");

  onMount(() => {
    const storedView = readStored<View>(VIEW_KEY, ["grid", "list"]);
    if (storedView) setViewSignal(storedView);
    const storedSort = readStored<Sort>(SORT_KEY, ["activity", "name"]);
    if (storedSort) setSortSignal(storedSort);
  });

  const setView = (next: View) => {
    setViewSignal(next);
    writeStored(VIEW_KEY, next);
  };
  const setSort = (next: Sort) => {
    setSortSignal(next);
    writeStored(SORT_KEY, next);
  };

  const isFacetActive = (key: FacetKey, value: string) =>
    facets().some((f) => f.key === key && f.value === value);

  /** One value per facet: another value replaces it, the same value clears it. */
  const toggleFacet = (key: FacetKey, value: string) =>
    setFacets((current) => {
      const active = current.some((f) => f.key === key && f.value === value);
      const rest = current.filter((f) => f.key !== key);
      return active ? rest : [...rest, { key, value }];
    });

  const removeFacet = (key: FacetKey) =>
    setFacets((current) => current.filter((f) => f.key !== key));

  let searchField: HTMLInputElement | undefined;

  /*
    `/` focuses the search, which is the shortcut the placeholder advertises.

    Guarded on the event target so typing a slash into any other field, or into
    a card someone is renaming, still types a slash.

    CAPTURE phase, and it stops the event dead once it has handled it. The
    shell's Find row advertises the same key on the same window, so without
    this both fire: the page focuses this field and the palette opens over the
    top of it and takes the focus back, which makes the hint in this input a
    lie. A page that owns a search field owns the shortcut while it is on
    screen, and window-capture runs before the shell's window-bubble listener.
  */
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      searchField?.focus();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  /** Newest activity first, nulls last, so "nothing yet" never leads the page. */
  const byActivity = (a: ProjectListItem, b: ProjectListItem) => {
    if (a.lastEventAt === b.lastEventAt) return a.name.localeCompare(b.name);
    if (!a.lastEventAt) return 1;
    if (!b.lastEventAt) return -1;
    return a.lastEventAt < b.lastEventAt ? 1 : -1;
  };

  const sorted = createMemo(() =>
    [...data().view.projects].sort(
      sort() === "name" ? (a, b) => a.name.localeCompare(b.name) : byActivity
    )
  );

  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const active = facets();
    return sorted().filter((project) => {
      const hit =
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.slug.includes(needle);
      return hit && active.every((facet) => facetMatches(facet, project));
    });
  });

  /** Whether anything is narrowing the list, which the empty case has to say. */
  const narrowed = () => query().trim().length > 0 || facets().length > 0;

  /** The rail's own order, which is recency whatever the list is sorted by. */
  const recent = createMemo(() => [...data().view.projects].sort(byActivity).slice(0, 6));

  const hasProjects = () => data().view.projects.length > 0;

  return (
    // The 16px above the title comes from the heading block's own top padding,
    // which is why there is none here: stating it twice would put the reference
    // 16px inner wrapper at 32.
    <main class="flex flex-col pb-4">
      <PageHeader
        title={workspace().name}
        description={i18n.t("workspace.projects_hint")}
        filters={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger as={Button} variant="outline" size="sm">
                <ListFilter class="size-3.5" />
                {i18n.t("workspace.add_filter")}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <For each={FACETS}>
                  {(group) => (
                    <>
                      <DropdownMenuLabel>{i18n.t(group.labelKey)}</DropdownMenuLabel>
                      <For each={group.options}>
                        {(option) => (
                          <DropdownMenuItem onSelect={() => toggleFacet(group.key, option.value)}>
                            <Check
                              class={cn(
                                "size-4",
                                isFacetActive(group.key, option.value)
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {i18n.t(option.labelKey)}
                          </DropdownMenuItem>
                        )}
                      </For>
                    </>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* One chip per active facet, and clicking it takes that facet off. */}
            <For each={facets()}>
              {(facet) => (
                <Show when={facetLabels(facet)}>
                  {(labels) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeFacet(facet.key)}
                      aria-label={i18n.t("workspace.remove_filter", {
                        facet: i18n.t(labels().facet),
                      })}
                    >
                      <span class="text-muted-foreground">{i18n.t(labels().facet)}:</span>
                      {i18n.t(labels().value)}
                      <X class="size-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </Show>
              )}
            </For>
          </>
        }
      />

      <Show
        when={hasProjects()}
        fallback={
          <Empty>
            <EmptyMedia>
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>{i18n.t("workspace.no_projects")}</EmptyTitle>
            <EmptyDescription>{i18n.t("workspace.no_projects_hint")}</EmptyDescription>
            <Show when={isAdmin()}>
              <EmptyContent>
                <Link
                  to="/w/$wslug/projects/new"
                  params={{ wslug: workspace().slug }}
                  class={buttonVariants()}
                >
                  {i18n.t("workspace.create_first")}
                </Link>
              </EmptyContent>
            </Show>
          </Empty>
        }
      >
        <div class="flex flex-col gap-6">
          {/* The 36px toolbar row: search, sort, view, one primary action. */}
          <div class="flex flex-row items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchField}
                type="search"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder={i18n.t("workspace.search_placeholder")}
                aria-label={i18n.t("workspace.search_label")}
                class="pr-10 pl-9"
              />
              <Kbd class="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                as={Button}
                variant="outline"
                size="toolbar-icon"
                aria-label={i18n.t("workspace.sort_by", { field: i18n.t(SORT_KEYS[sort()]) })}
                title={i18n.t("workspace.sort_by", { field: i18n.t(SORT_KEYS[sort()]) })}
              >
                <ChevronsUpDown class="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <For each={["activity", "name"] as Sort[]}>
                  {(option) => (
                    <DropdownMenuItem onSelect={() => setSort(option)}>
                      <Check
                        class={cn("size-4", sort() === option ? "opacity-100" : "opacity-0")}
                      />
                      {i18n.t(SORT_KEYS[option])}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>

            {/*
              72x36 overall: 4px of padding around two 28x32 cells. Two buttons
              in one ringed box rather than two separate ones, because they are
              one setting with two states.
            */}
            <div class="flex h-control-md shrink-0 items-center rounded-md bg-card p-1 shadow-xs">
              <ViewButton
                active={view() === "list"}
                label={i18n.t("workspace.view_list")}
                onClick={() => setView("list")}
              >
                <List class="size-4" />
              </ViewButton>
              <ViewButton
                active={view() === "grid"}
                label={i18n.t("workspace.view_grid")}
                onClick={() => setView("grid")}
              >
                <LayoutGrid class="size-4" />
              </ViewButton>
            </div>

            <Show when={isAdmin()}>
              <Link
                to="/w/$wslug/projects/new"
                params={{ wslug: workspace().slug }}
                class={cn(buttonVariants({ size: "toolbar" }), "shrink-0")}
              >
                {i18n.t("workspace.add_new")}
              </Link>
            </Show>
          </div>

          {/* Body: the projects, and the rail beside them once there is room. */}
          <div class="flex w-full flex-col gap-4 @smd-page/page:flex-row @smd-page/page:gap-6">
            <div class="min-w-0 flex-1">
              <SectionLabel
                label={i18n.t("workspace.projects")}
                trailing={
                  <Show when={narrowed()} fallback={<>{i18n.num(data().view.projects.length)}</>}>
                    {i18n.t("workspace.count_of", {
                      shown: shown().length,
                      total: data().view.projects.length,
                    })}
                  </Show>
                }
              />

              <Show
                when={shown().length > 0}
                fallback={
                  <Card class="items-center justify-center px-4 py-10 text-center">
                    <span class="text-body text-muted-foreground">
                      {i18n.t("workspace.no_matches")}
                    </span>
                  </Card>
                }
              >
                <Show
                  when={view() === "grid"}
                  fallback={
                    /*
                      One ringed surface holding every row, divided by hairlines:
                      the reference's card-style list, and the reason the list
                      reads as one object while the grid reads as many.
                    */
                    /*
                      No `overflow-hidden`. The clip used to be what kept the
                      first row's hover fill off the card's rounded corners, and
                      it also cropped the focus ring: a two-stop ring spreads
                      4px outside the row, so on a clipped list it rendered as
                      two blue bars above and below rather than as a ring. The
                      rows round their own outer corners instead, which is one
                      class and leaves the ring intact.
                    */
                    <Card>
                      <ul class="divide-y">
                        <For each={shown()}>
                          {(project) => (
                            <ProjectRow workspace={workspace().slug} project={project} />
                          )}
                        </For>
                      </ul>
                    </Card>
                  }
                >
                  <div class="grid grid-cols-1 gap-4 @smd-page/page:grid-cols-2 @lg-page/page:grid-cols-3">
                    <For each={shown()}>
                      {(project) => (
                        <ProjectTile workspace={workspace().slug} project={project} />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>

            <div class="flex shrink-0 flex-col gap-4 @smd-page/page:w-[320px] @lg-page/page:w-[404px]">
              <div>
                <SectionLabel label={i18n.t("workspace.activity")} />
                <Card>
                  <ul class="divide-y">
                    <For each={recent()}>
                      {(project) => (
                        <li class="first:rounded-t-md last:rounded-b-md">
                          <Link
                            to="/w/$wslug/$pslug"
                            params={{ wslug: workspace().slug, pslug: project.slug }}
                            class={cn(
                              ROW_INTERACTION,
                              "flex items-center gap-3 rounded-[inherit] px-4 py-2.5"
                            )}
                          >
                            <ProjectLogo
                              workspace={workspace().slug}
                              name={project.name}
                              slug={project.slug}
                              logoUpdatedAt={project.logoUpdatedAt}
                            />
                            <span class="min-w-0 flex-1 truncate text-body">{project.name}</span>
                            <span class="shrink-0 text-caption text-muted-foreground">
                              <Show
                                when={project.lastEventAt}
                                fallback={i18n.t("workspace.nothing_yet")}
                              >
                                {(at) => i18n.relative(at())}
                              </Show>
                            </span>
                          </Link>
                        </li>
                      )}
                    </For>
                  </ul>
                </Card>
              </div>

              <div>
                <SectionLabel
                  label={i18n.t("workspace.people")}
                  trailing={
                    <>
                      {i18n.num(members().length)}
                      <Link
                        to="/w/$wslug/members"
                        params={{ wslug: workspace().slug }}
                        // An inline word, so it takes the outline form of the
                        // focus ring: a box-shadow on an inline box paints
                        // around the line box and lands in the wrong place.
                        class={cn(
                          "focus-outline ml-3 rounded-sm text-caption text-muted-foreground",
                          "transition-colors hover:text-foreground"
                        )}
                      >
                        {i18n.t("workspace.manage")}
                      </Link>
                    </>
                  }
                />
                <Card>
                  <ul class="divide-y">
                    <For each={members().slice(0, 6)}>
                      {(member) => <MemberRow member={member} />}
                    </For>
                  </ul>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </main>
  );
}

/**
 * The label above a list.
 *
 * 32px, 14/500, and outside the ringed surface rather than inside it as a card
 * header: the reference puts the name of a list above the object, so the object
 * itself is nothing but rows.
 */
function SectionLabel(props: { label: string; trailing?: JSX.Element }) {
  return (
    <div class="mb-3 flex h-8 items-center justify-between gap-2 px-1.5">
      <span class="text-body font-medium text-foreground">{props.label}</span>
      {/*
        Always in the markup, empty when the label has no trailing figure, and
        out of the layout when it is empty.

        `when={props.trailing}` would read the prop to TEST it, and reading a
        markup prop BUILDS its nodes -- before the span meant to contain them
        exists. During hydration that claims the server's nodes out of order,
        Solid throws a hydration mismatch, and its own error path cannot print
        itself: the console says `template2 is not a function`, the page
        renders from SSR and then ignores every click on the whole route. Same
        rule as `components/page-header.tsx`.
      */}
      <span class="text-caption text-muted-foreground empty:hidden">{props.trailing}</span>
    </div>
  );
}

/** One cell of the 72x36 view toggle: 28 tall inside the box's 4px padding. */
function ViewButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      onClick={() => props.onClick()}
      class={cn(
        "focus-ring flex h-7 w-8 cursor-pointer items-center justify-center rounded-sm",
        "outline-none transition-colors",
        props.active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {props.children}
    </button>
  );
}

/**
 * A project's picture, or its initials while it has none.
 *
 * On Kobalte's image primitive rather than a bare `<img>`, so the initials show
 * while the image loads and STAY if it fails: a project whose logo 404s reads
 * as one without a logo instead of as a torn image icon.
 *
 * Square, not round. A logo is a mark, and a circle eats the corners of most of
 * them. Contained rather than cropped for the same reason: a wordmark that is
 * three times as wide as it is tall is a wordmark, not a badly framed photo.
 */
function ProjectLogo(props: {
  workspace: string;
  name: string;
  slug: string;
  logoUpdatedAt: string | null;
  class?: string;
}) {
  // The timestamp is the cache key. The URL is stable, so without it the
  // browser keeps serving the picture it already has and a replacement looks
  // like it did not save. Same reason the serving route sets an ETag.
  const src = () =>
    props.logoUpdatedAt
      ? `/api/logo/${props.workspace}/${props.slug}?v=${new Date(props.logoUpdatedAt).getTime()}`
      : undefined;

  return (
    <Avatar class={cn("size-8 shrink-0 rounded-md bg-muted", props.class)}>
      <Show when={src()}>
        {(url) => <AvatarImage src={url()} alt="" class="rounded-md object-contain" />}
      </Show>
      <AvatarFallback class="rounded-md text-caption font-semibold">
        {initials(props.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The rate, with the unit this page puts on it.
 *
 * The figure lives in `components/ingest-histogram.tsx`, beside the bars it is
 * read with: the sources list draws the identical pair at the identical size.
 * The UNIT stays here, because the bars count this project's events on this page
 * and one source's on that one.
 */
function ProjectPerHour(props: { perHour: number; inline?: boolean; class?: string }) {
  const i18n = useI18n();
  return (
    <IngestRate
      perHour={props.perHour}
      unit={i18n.t("workspace.per_hour_unit")}
      inline={props.inline}
      class={props.class}
    />
  );
}

/**
 * The subtitle under a project's name: how many sources report into it.
 *
 * A fact about configuration rather than about volume, which is why it sits
 * here and the rate sits by the chart. "Three sources and a flat month" is a
 * different problem from "no sources at all", and the two lines say which.
 *
 * The count goes through the plural family rather than an `=== 1` check.
 * `Intl.PluralRules` picks the form, and the count is run through the active
 * locale on the way into the sentence.
 */
function ProjectSources(props: { count: number; class?: string }) {
  const i18n = useI18n();
  return (
    <div class={cn("truncate text-caption text-muted-foreground", props.class)}>
      {i18n.t("workspace.sources", { count: props.count })}
    </div>
  );
}

/**
 * The project histogram, with the sentence this page puts on it.
 *
 * The drawing lives in `components/ingest-histogram.tsx` because the sources
 * list draws the identical chart over the identical window, and two copies
 * would be two things to keep in step. The LABEL stays here: the bars mean
 * "this project's entries" on this page and "this source's entries" on that
 * one, and a shared component reaching into somebody else's catalogue for a
 * string is how one page ends up describing another page's numbers.
 */
function ProjectHistogram(props: { daily: number[]; height?: number }) {
  const i18n = useI18n();
  return (
    <IngestHistogram
      daily={props.daily}
      height={props.height}
      label={i18n.t("workspace.ingest_30d", { count: ingestTotal(props.daily) })}
    />
  );
}

/**
 * A row of the list view: the reference's 75px project row.
 *
 * The chevron is placed at the row's top right rather than centred in it,
 * which is where the reference puts a row's actions: it stays put as the middle
 * block grows a second line, instead of drifting down with it.
 */
function ProjectRow(props: { workspace: string; project: ProjectListItem }) {
  return (
    /*
      The corner radius is stated on the ROW and inherited by the link inside
      it, rather than clipped off by the container. `first:`/`last:` read the
      element's own position among its siblings, so they only mean anything
      here, on the item: on the link they would match every row, because a link
      is the only child of its own item.
    */
    <li class="first:rounded-t-md last:rounded-b-md">
      <Link
        to="/w/$wslug/$pslug"
        params={{ wslug: props.workspace, pslug: props.project.slug }}
        class={cn(ROW_INTERACTION, "relative flex items-center gap-3 rounded-[inherit] p-4")}
      >
        {/*
          The reference splits this row at its own extra-large pane step. We
          split at the medium one: their measuring pane was 2258px wide and
          ours rarely is, so holding a 75px row stacked until 1280px would
          leave most panes showing the tall form of a short row.
        */}
        <div class="flex min-w-0 items-center gap-4 @md-page/page:w-[calc(25%+48px)]">
          <ProjectLogo
            workspace={props.workspace}
            name={props.project.name}
            slug={props.project.slug}
            logoUpdatedAt={props.project.logoUpdatedAt}
            class="size-10"
          />
          <div class="min-w-0">
            <div class="truncate text-body font-medium">{props.project.name}</div>
            <ProjectSources count={props.project.sourceCount} />
          </div>
        </div>

        {/* The figure, then the shape it came from: how big, then what it did. */}
        <ProjectPerHour perHour={props.project.perHour} class="hidden @md-page/page:block" />

        {/*
          The chart takes the whole rest of the row rather than a fixed column.
          Thirty bars in 88px is a texture; thirty bars in three or four hundred
          is a shape, and the shape is the only thing this row is here to show.
          32px of right padding keeps the bars clear of the chevron.
        */}
        <div class="hidden min-w-0 flex-1 pr-8 @md-page/page:block">
          <ProjectHistogram daily={props.project.daily} />
        </div>

        <ChevronRight class="absolute top-[21px] right-4 size-4 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** A card of the grid view. The same two facts, stacked. */
function ProjectTile(props: { workspace: string; project: ProjectListItem }) {
  return (
    <Link
      to="/w/$wslug/$pslug"
      params={{ wslug: props.workspace, pslug: props.project.slug }}
      class={cn(ROW_INTERACTION, "group flex flex-col gap-4 rounded-md bg-card p-4 shadow-sm")}
    >
      <div class="flex items-center gap-3">
        <ProjectLogo
          workspace={props.workspace}
          name={props.project.name}
          slug={props.project.slug}
          logoUpdatedAt={props.project.logoUpdatedAt}
          class="size-10"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate text-body font-medium">{props.project.name}</div>
          <ProjectSources count={props.project.sourceCount} />
        </div>
        <ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {/*
        The figure on its own line, then the month at the card's full width. The
        row puts these side by side because a row is wide; a tile in a three
        column grid is not, and the chart is the thing that suffers first.
      */}
      <div class="flex flex-col gap-2">
        <ProjectPerHour perHour={props.project.perHour} inline />
        <ProjectHistogram daily={props.project.daily} height={48} />
      </div>
    </Link>
  );
}

function MemberRow(props: { member: MemberSummary }) {
  const i18n = useI18n();
  return (
    <li class="flex items-center gap-3 px-4 py-2.5">
      <Avatar>
        <Show when={props.member.avatarUrl}>
          {(url) => <AvatarImage src={url()} alt="" />}
        </Show>
        <AvatarFallback>{initials(props.member.name ?? props.member.login)}</AvatarFallback>
      </Avatar>
      <div class="min-w-0 flex-1">
        <div class="truncate text-body">{props.member.name ?? props.member.login}</div>
        <div class="truncate text-caption text-muted-foreground">@{props.member.login}</div>
      </div>
      <Badge variant={props.member.role === "admin" ? "secondary" : "outline"}>
        {i18n.t(props.member.role === "admin" ? "workspace.role_admin" : "workspace.role_read")}
      </Badge>
    </li>
  );
}
