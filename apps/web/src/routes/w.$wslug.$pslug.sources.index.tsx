import { Link, createFileRoute, notFound, redirect, useRouter } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import ListFilter from "lucide-solid/icons/list-filter";
import Search from "lucide-solid/icons/search";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { ingestTotal } from "../components/ingest-histogram.js";
import { PageHeader } from "../components/page-header.js";
import { SourceRow } from "../components/source-row.js";
import {
  Button,
  Card,
  ConfirmDelete,
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
  toast,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import {
  deleteSourceFn,
  getSession,
  getWorkspaceSources,
  type WorkspaceSourceSummary,
} from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * Ingestion sources for one project.
 *
 * A list page, in the reference's sense (`docs/vercel-structure.md` 1.7, 5 and
 * 8.2): a 24/600 heading whose second row carries the facet chips, a 36px
 * toolbar, a section label, then ONE ringed surface holding every row divided
 * by hairlines.
 *
 * It used to be a column of free-standing cards, one per source, each carrying
 * a whole code block and the entire install panel. That put a row at roughly
 * 240px, so three sources filled a screen and a reader comparing two keys had
 * to scroll between them. A row owes the reader recognition and a way in, and
 * nothing else: the key is a truncated mono cell with the copy button that
 * makes it useful, and the install guide is one icon.
 *
 * Every source here reports onto the same boards, and each one is its own
 * anonymous id space. The page says so, because "why is my unique count higher
 * than my user count" is the question this answers before it is asked.
 *
 * The install guide is not repeated here, only linked: somebody redeploying a
 * site six months later needs it more than the person who just created the
 * source did, and they need to be able to send it to a colleague who has no
 * login.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources/")({
  /*
   * The project layout above already loaded this project's sources, and this
   * asks for them again -- narrowed to the same project, but through the call
   * the workspace list uses.
   *
   * That is the point. The nav's copy carries a name and a last-seen stamp,
   * because that is all a sidebar needs; a ROW needs the month behind it and
   * the rate off it, and those are two grouped scans nobody navigating between
   * settings pages should pay for. Same loader, same shape, one scope down.
   */
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspaceSources({
      data: { workspace: params.wslug, project: params.pslug },
    });
    if (!view) throw notFound();
    return view;
  },
  component: Sources,
});

type Sort = "activity" | "volume" | "name";

/** How long a source can say nothing before "receiving" stops being true. */
const QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

type ActivityFacet = "receiving" | "quiet" | "never";

/**
 * What the filter row narrows by, now that a source has no type.
 *
 * It used to be the surface, which was the only facet this page had: with the
 * types gone the control would have been a button that opened an empty menu.
 * Activity replaces it because it answers the question somebody opens a source
 * list to ask -- which of these has stopped -- and because the row states the
 * same fact in words, so a chip never hides a row for a reason the reader
 * cannot see in the rows it kept.
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
 * The key each sort names, rather than the word. Read inside the component, so
 * switching language re-renders the toolbar, and a record of literals so `t`
 * still sees a key from its closed union.
 */
const SORT_KEYS = {
  activity: "sources.sort_activity",
  volume: "sources.sort_volume",
  name: "sources.sort_name",
} as const satisfies Record<Sort, SimpleKey>;

function Sources() {
  const i18n = useI18n();
  const data = Route.useLoaderData();
  const nav = ProjectRoute.useLoaderData();
  const router = useRouter();

  const sources = () => data().sources;
  const isAdmin = () => nav().role === "admin";
  const hasSources = () => sources().length > 0;

  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("activity");
  const [facets, setFacets] = createSignal<ActivityFacet[]>([]);

  let searchField: HTMLInputElement | undefined;

  /*
    `/` focuses the search, which is the shortcut the placeholder advertises.

    Guarded on the event target so typing a slash into any other field, or into
    the confirm box of a delete dialog, still types a slash.

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

  /**
   * Only the states this project's sources are actually in. A facet that can
   * only ever match nothing is not a filter anybody would pick on purpose.
   */
  const present = createMemo(() =>
    ACTIVITY_FACETS.filter((state) => sources().some(ACTIVITY[state].match))
  );

  function toggleFacet(state: ActivityFacet) {
    setFacets((current) =>
      current.includes(state) ? current.filter((s) => s !== state) : [...current, state]
    );
  }

  /** Newest activity first, nulls last, so "never seen" never leads the page. */
  const byActivity = (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) => {
    if (a.lastSeenAt === b.lastSeenAt) return a.name.localeCompare(b.name);
    if (!a.lastSeenAt) return 1;
    if (!b.lastSeenAt) return -1;
    return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
  };

  /** Busiest month first, so "what is this project mostly" reads off the top. */
  const byVolume = (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) =>
    ingestTotal(b.daily) - ingestTotal(a.daily) || a.name.localeCompare(b.name);

  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const chosen = facets();
    const order =
      sort() === "name"
        ? (a: WorkspaceSourceSummary, b: WorkspaceSourceSummary) => a.name.localeCompare(b.name)
        : sort() === "volume"
          ? byVolume
          : byActivity;

    return [...sources()]
      .filter((source) => chosen.length === 0 || chosen.some((s) => ACTIVITY[s].match(source)))
      /*
        Not on the key. The row stopped showing it, and a search that silently
        matches something invisible reports a row whose reason for being there
        the reader cannot see.
      */
      .filter((source) => !needle || source.name.toLowerCase().includes(needle))
      .sort(order);
  });

  async function remove(source: WorkspaceSourceSummary) {
    const result = await deleteSourceFn({
      data: {
        workspace: nav().workspace.slug,
        project: nav().project.slug,
        sourceId: source.id,
      },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await router.invalidate();
  }

  return (
    <main class="w-full py-4">
      <PageHeader
        title={i18n.t("sources.title")}
        description={i18n.t("sources.list_hint")}
        filters={
          // Built only once there is something to filter. An `Add filter` chip
          // over a project with no sources is a control with nothing behind it,
          // and the heading drops its filter row when it is handed nothing.
          hasSources() ? (
            <>
              <DropdownMenu>
                {/* No radius override. `docs/geist-reference.md` puts surfaces
                    and popover rows at 6px and small controls and CHIPS at 4,
                    which is what the small button size already is. The filter
                    row on the workspace list never overrode it, so the two
                    filter rows in the product were a pixel apart. */}
                <DropdownMenuTrigger as={Button} variant="outline" size="sm">
                  <ListFilter class="size-3.5" />
                  {i18n.t("sources.add_filter")}
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{i18n.t("sources.facet_activity")}</DropdownMenuLabel>
                  <For each={present()}>
                    {(state) => (
                      <DropdownMenuItem onSelect={() => toggleFacet(state)}>
                        <Check
                          class={cn(
                            "size-4",
                            facets().includes(state) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {i18n.t(ACTIVITY[state].labelKey)}
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenu>

              <For each={facets()}>
                {(state) => (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={i18n.t("sources.remove_filter", {
                      facet: i18n.t(ACTIVITY[state].labelKey),
                    })}
                    onClick={() => toggleFacet(state)}
                  >
                    <span class="text-muted-foreground">{i18n.t("sources.facet_activity")}:</span>
                    {i18n.t(ACTIVITY[state].labelKey)}
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
            <EmptyTitle>{i18n.t("sources.none_yet")}</EmptyTitle>
            <EmptyDescription>{i18n.t("sources.none_yet_hint")}</EmptyDescription>
            <Show when={isAdmin()}>
              {/*
                The reference's options block: one card per thing the reader
                could create, each saying what it measures and carrying its own
                button, rather than a single button labelled "Add" that asks the
                question again on the next page.
              */}
              <EmptyContent class="w-full max-w-[820px] flex-col gap-3">
                {/*
                  One action, because there is one kind of source. This used to
                  be two cards, "a website" and "a desktop app", which chose the
                  first step of the wizard for the reader. That step is gone with
                  the kinds, and a chooser in front of a form with nothing to
                  choose is a click that asks a question it already knows.
                */}
                <Link
                  to="/w/$wslug/$pslug/sources/new"
                  params={{ wslug: nav().workspace.slug, pslug: nav().project.slug }}
                  class={buttonVariants({ size: "sm" })}
                >
                  {i18n.t("sources.add")}
                </Link>
              </EmptyContent>
            </Show>
          </Empty>
        }
      >
        <div class="flex flex-col gap-4">
          {/*
            The 36px toolbar row: search, sort, one primary action. The action
            lives here rather than beside the `h1` so the page states it once.
          */}
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

            <Show when={isAdmin()}>
              <Link
                to="/w/$wslug/$pslug/sources/new"
                params={{ wslug: nav().workspace.slug, pslug: nav().project.slug }}
                class={cn(buttonVariants({ size: "toolbar" }), "shrink-0")}
              >
                {i18n.t("sources.add")}
              </Link>
            </Show>
          </div>

          <div>
            <div class="mb-3 flex h-8 items-center justify-between gap-2 px-1.5">
              <span class="text-body font-medium text-foreground">
                {i18n.t("sources.title")}
              </span>
              <span class="text-caption text-muted-foreground">
                <Show
                  when={shown().length !== sources().length}
                  fallback={<>{i18n.num(sources().length)}</>}
                >
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
                  <span class="text-body text-muted-foreground">
                    {i18n.t("sources.no_matches")}
                  </span>
                </Card>
              }
            >
              {/*
                One ringed surface holding every row, divided by hairlines. The
                edge is the shadow ring, so nothing here carries a border too.
              */}
              <ul class="divide-y rounded-md bg-card shadow-sm">
                <For each={shown()}>
                  {(source) => (
                    <SourceRow
                      source={source}
                      workspace={nav().workspace.slug}
                      showProject={false}
                      actions={
                        <Show when={isAdmin()}>
                          <ConfirmDelete
                            trigger={
                              <Button
                                variant="ghost"
                                size="toolbar-icon"
                                class="text-muted-foreground hover:text-destructive"
                                aria-label={i18n.t("sources.remove_source", { name: source.name })}
                                title={i18n.t("sources.remove_source_title")}
                              >
                                <Trash2 class="size-4" />
                              </Button>
                            }
                            title={i18n.t("sources.remove_confirm_title", { name: source.name })}
                            description={i18n.t("sources.remove_confirm_hint")}
                            confirmWord={source.name}
                            actionLabel={i18n.t("sources.remove_action")}
                            onConfirm={() => remove(source)}
                          />
                        </Show>
                      }
                    />
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
