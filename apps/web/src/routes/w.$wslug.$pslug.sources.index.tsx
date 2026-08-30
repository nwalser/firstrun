import { ALL_SURFACES, SURFACE_LABELS, type Surface } from "@firstrun/schema/surface";
import { Link, createFileRoute, useRouter } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import BookOpen from "lucide-solid/icons/book-open";
import Box from "lucide-solid/icons/box";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Copy from "lucide-solid/icons/copy";
import Globe from "lucide-solid/icons/globe";
import ListFilter from "lucide-solid/icons/list-filter";
import Monitor from "lucide-solid/icons/monitor";
import Search from "lucide-solid/icons/search";
import Server from "lucide-solid/icons/server";
import Smartphone from "lucide-solid/icons/smartphone";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { installTopicFor } from "../components/install-guide.js";
import { PageHeader } from "../components/page-header.js";
import { RefreshButton } from "../components/refresh-button.js";
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
import { deleteSourceFn, type SourceSummary } from "../lib/api.js";
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
  component: Sources,
});

/** One icon per surface. The list is closed, so the record is total. */
const SURFACE_ICON: Record<Surface, (props: { class?: string }) => ReturnType<typeof Globe>> = {
  web: Globe,
  desktop: Monitor,
  mobile: Smartphone,
  server: Server,
  other: Box,
};

type Sort = "activity" | "name";

/**
 * The key each sort names, rather than the word. Read inside the component, so
 * switching language re-renders the toolbar, and a record of literals so `t`
 * still sees a key from its closed union.
 */
const SORT_KEYS = {
  activity: "sources.sort_activity",
  name: "sources.sort_name",
} as const satisfies Record<Sort, SimpleKey>;

/**
 * The empty state's options, one card per kind the new-source flow can actually
 * create. Not one per surface: `mobile`, `server` and `other` have no step in
 * that flow yet, and an option leading nowhere is worse than a missing one.
 */
const NEW_SOURCE_OPTIONS: {
  kind: "web" | "desktop";
  title: SimpleKey;
  body: SimpleKey;
  /*
   * The action carries its own key rather than being built from "Add a " and a
   * lower-cased title. Lower-casing a German noun to fit it into a sentence is
   * wrong in every case, and that is what the English version did.
   */
  action: SimpleKey;
}[] = [
  {
    kind: "web",
    title: "sources.option_web_title",
    body: "sources.option_web_body",
    action: "sources.option_web_action",
  },
  {
    kind: "desktop",
    title: "sources.option_desktop_title",
    body: "sources.option_desktop_body",
    action: "sources.option_desktop_action",
  },
];

function Sources() {
  const i18n = useI18n();
  const view = ProjectRoute.useLoaderData();
  const router = useRouter();

  const isAdmin = () => view().role === "admin";
  const hasSources = () => view().sources.length > 0;

  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("activity");
  const [facets, setFacets] = createSignal<Surface[]>([]);

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
   * Only the surfaces this project actually has, in the schema's own order. A
   * facet that can only ever match nothing is not a filter anybody would pick
   * on purpose.
   */
  const present = createMemo(() => {
    const seen = new Set<Surface>(view().sources.map((source) => source.kind));
    return ALL_SURFACES.filter((kind) => seen.has(kind));
  });

  function toggleFacet(kind: Surface) {
    setFacets((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]
    );
  }

  /** Newest activity first, nulls last, so "never seen" never leads the page. */
  const byActivity = (a: SourceSummary, b: SourceSummary) => {
    if (a.lastSeenAt === b.lastSeenAt) return a.name.localeCompare(b.name);
    if (!a.lastSeenAt) return 1;
    if (!b.lastSeenAt) return -1;
    return a.lastSeenAt < b.lastSeenAt ? 1 : -1;
  };

  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const chosen = facets();
    return [...view().sources]
      .filter((source) => chosen.length === 0 || chosen.includes(source.kind))
      .filter(
        (source) =>
          !needle ||
          source.name.toLowerCase().includes(needle) ||
          source.ingestKey.toLowerCase().includes(needle)
      )
      .sort(sort() === "name" ? (a, b) => a.name.localeCompare(b.name) : byActivity);
  });

  async function remove(source: SourceSummary) {
    const result = await deleteSourceFn({
      data: {
        workspace: view().workspace.slug,
        project: view().project.slug,
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
                  <DropdownMenuLabel>{i18n.t("sources.surface_label")}</DropdownMenuLabel>
                  <For each={present()}>
                    {(kind) => (
                      <DropdownMenuItem onSelect={() => toggleFacet(kind)}>
                        <Check
                          class={cn(
                            "size-4",
                            facets().includes(kind) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {SURFACE_LABELS[kind]}
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenu>

              <For each={facets()}>
                {(kind) => (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={i18n.t("sources.remove_filter", {
                      surface: SURFACE_LABELS[kind],
                    })}
                    onClick={() => toggleFacet(kind)}
                  >
                    {i18n.t("sources.surface_label")}: {SURFACE_LABELS[kind]}
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
                <For each={NEW_SOURCE_OPTIONS}>
                  {(option) => (
                    <div class="flex w-full flex-col items-start gap-3 rounded-md bg-card p-4 text-left shadow-2xs">
                      <div>
                        <div class="text-body font-semibold text-foreground">
                          {i18n.t(option.title)}
                        </div>
                        <p class="mt-1 text-copy-13 text-muted-foreground">
                          {i18n.t(option.body)}
                        </p>
                      </div>
                      <Link
                        to="/w/$wslug/$pslug/sources/new"
                        params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
                        search={{ kind: option.kind }}
                        class={buttonVariants({ size: "sm" })}
                      >
                        {i18n.t(option.action)}
                      </Link>
                    </div>
                  )}
                </For>
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
                <For each={["activity", "name"] as Sort[]}>
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

            <Show when={isAdmin()}>
              <Link
                to="/w/$wslug/$pslug/sources/new"
                params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
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
                  when={shown().length !== view().sources.length}
                  fallback={<>{i18n.num(view().sources.length)}</>}
                >
                  {i18n.t("sources.count_of", {
                    shown: shown().length,
                    total: view().sources.length,
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
                      isAdmin={isAdmin()}
                      onRemove={() => remove(source)}
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

/**
 * One source, at the reference's row shape: 16px of padding and a 12px gap, so
 * the row lands at about 75px. A left block naming it, a middle block carrying
 * the key, and a right block of icon actions.
 */
function SourceRow(props: { source: SourceSummary; isAdmin: boolean; onRemove: () => void }) {
  const i18n = useI18n();
  return (
    <li class="flex items-center gap-3 p-4">
      {/*
        The reference splits this row at its own extra-large pane step. We
        split at the medium one: their measuring pane was 2258px wide and
        ours rarely is, so holding a 75px row stacked until 1280px would
        leave most panes showing the tall form of a short row.
      */}
      <div class="flex min-w-0 items-center gap-4 @md-page/page:w-[calc(25%+48px)]">
        <div class="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Dynamic component={SURFACE_ICON[props.source.kind] ?? Box} class="size-4" />
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
            {SURFACE_LABELS[props.source.kind]}
            {" · "}
            <Show when={props.source.lastSeenAt} fallback={i18n.t("sources.never_seen")}>
              {(at) => <>{i18n.t("sources.seen", { when: i18n.relative(at()) })}</>}
            </Show>
          </div>
        </div>
      </div>

      <div class="hidden min-w-0 flex-1 flex-col gap-0.5 @md-page/page:flex">
        <span class="text-caption text-muted-foreground">{i18n.t("sources.key_label")}</span>
        <KeyCell value={props.source.ingestKey} />
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        {/*
          The id travels in the query string, so the documentation opens with this source
          already selected and every snippet on it carries this key. An icon,
          not a panel: the guide is five pages long and belongs where it can be
          read, which is the documentation and the step that just created the key.
        */}
        <Link
          to="/docs/$topic"
          params={{ topic: installTopicFor(props.source.kind) }}
          search={{ source: props.source.id }}
          class={buttonVariants({ variant: "ghost", size: "toolbar-icon" })}
          aria-label={i18n.t("sources.how_to_install", { name: props.source.name })}
          title={i18n.t("sources.guide_hint")}
        >
          <BookOpen class="size-4" />
        </Link>

        <Show when={props.isAdmin}>
          <ConfirmDelete
            trigger={
              <Button
                variant="ghost"
                size="toolbar-icon"
                class="text-muted-foreground hover:text-destructive"
                aria-label={i18n.t("sources.remove_source", { name: props.source.name })}
                title={i18n.t("sources.remove_source_title")}
              >
                <Trash2 class="size-4" />
              </Button>
            }
            title={i18n.t("sources.remove_confirm_title", { name: props.source.name })}
            description={i18n.t("sources.remove_confirm_hint")}
            confirmWord={props.source.name}
            actionLabel={i18n.t("sources.remove_action")}
            onConfirm={() => props.onRemove()}
          />
        </Show>
      </div>
    </li>
  );
}

/**
 * A key, inline, with the copy button that makes it useful.
 *
 * A source key is public by necessity and authorises nothing, so it is shown
 * rather than masked: the reader is here to compare it against what they pasted
 * into a deploy, and a value behind a "reveal" is one more click before they
 * can. It is still copied from the string rather than from the DOM, so a key
 * truncated on a narrow pane pastes whole.
 */
function KeyCell(props: { value: string }) {
  const i18n = useI18n();
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard is not worth a dialog: the key is on screen and can
      // be selected by hand.
      toast.error(i18n.t("sources.clipboard_failed"));
    }
  }

  return (
    <div class="flex min-w-0 items-center gap-1">
      <span class="truncate font-mono text-mono text-muted-foreground" title={props.value}>
        {props.value}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={copy}
        aria-label={copied() ? i18n.t("common.copied") : i18n.t("sources.copy_key")}
        title={copied() ? i18n.t("common.copied") : i18n.t("sources.copy_key")}
      >
        <Show when={copied()} fallback={<Copy class="size-3.5" />}>
          <Check class="size-3.5 text-positive" />
        </Show>
      </Button>
    </div>
  );
}
