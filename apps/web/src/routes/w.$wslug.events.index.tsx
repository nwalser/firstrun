import {
  FEED_PAGE,
  SEVERITY_BANDS,
  SEVERITY_LABELS,
  mergeFeed,
  type FeedEntry,
  type FeedRequest,
  type SeverityBand,
} from "@firstrun/schema";
import { createFileRoute, notFound, redirect, useNavigate } from "@tanstack/solid-router";
import Check from "lucide-solid/icons/check";
import ListFilter from "lucide-solid/icons/list-filter";
import Radio from "lucide-solid/icons/radio";
import ScrollText from "lucide-solid/icons/scroll-text";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { EntryRow } from "../components/entry-row.js";
import { PageHeader } from "../components/page-header.js";
import { RefreshButton } from "../components/refresh-button.js";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Input,
  Kbd,
  Spinner,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { getEventFeed, getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * The log: every entry this workspace has received, newest first.
 *
 * The product's answer to "what is happening" has been a board -- a saved query
 * drawn as a number or a chart -- and a board cannot answer "what did that one
 * client actually send". Aggregates are the wrong shape for that question: you
 * do not want the count, you want the row, with the attributes on it.
 *
 * So this is deliberately NOT the query layer. It does not go through the
 * compiler, it is not expressible as a card, and it cannot be saved: it returns
 * ROWS, one bounded page at a time, and the reason a saved card may not is that
 * a card that returned ten thousand rows would page a project's whole month
 * into a browser. See `packages/schema/src/feed.ts` and `db/feed.ts`.
 *
 * Three things it takes from CLAUDE.md and states on screen rather than
 * assuming:
 *
 *  - Every entry is the same row shape. An exception at severity 17, a page
 *    view at 9 and a measurement carrying a number are one list here, because
 *    they are one table underneath. There is no error tab.
 *  - `time` is the client's and is what this sorts, windows and pages on. When
 *    it differs from `ingested_at` by more than a moment, the opened row says
 *    so: a laptop that was offline for a day is the single most common cause of
 *    a number somebody thinks is wrong (rule 5).
 *  - The window is not a convenience. The table is partitioned by time and
 *    every read prunes on it, so "no window" is not on offer (rule 4).
 *
 * The filters live in the URL rather than in signals. A log somebody is reading
 * is a log they will send to a colleague, and a link that arrives showing
 * something else is worse than no link. It is also what makes Refresh work: the
 * loader re-runs with the same filter and the list resets to what it returns.
 */

/**
 * Which window the log offers, in DAYS -- which is what the URL carries, because
 * `?days=7` reads better than `?hours=168` in a link somebody sends.
 *
 * The wire carries hours, and the window rolls from now rather than snapping to
 * midnight: `FEED_WINDOWS` in the contract says why a log is the one place that
 * differs from a board's calendar range.
 */
const WINDOWS = [1, 7, 30] as const;

const HOURS_PER_DAY = 24;

type Window = (typeof WINDOWS)[number];

interface EventSearch {
  /**
   * Days back. One of `WINDOWS`, because a log is read from the top.
   *
   * Optional in the TYPE and never absent in practice: `validateSearch` always
   * fills it in. Declaring it required would mean every link into the log --
   * from a source's page, from an entry's page -- had to state a window it has
   * no opinion about, and would state the wrong one.
   */
  days?: Window;
  /** A project slug, or nothing for every project the reader can see. */
  project?: string;
  /**
   * A source id, or nothing for every source.
   *
   * An id rather than a name, because a source's page is what links here and
   * that is what it has. Nothing in the toolbar sets this: it is a filter you
   * arrive with, and the chip is how you take it off.
   */
  source?: string;
  /** The floor on the severity ladder, as a band. */
  severity?: SeverityBand;
  /** A substring of the name, the client id, or the message. */
  q?: string;
}

const isWindow = (n: unknown): n is Window => WINDOWS.includes(n as Window);

const isBand = (v: unknown): v is SeverityBand =>
  typeof v === "string" && (SEVERITY_BANDS as readonly string[]).includes(v);

export const Route = createFileRoute("/w/$wslug/events/")({
  /*
   * Everything is optional and everything has a fallback. A link somebody
   * hand-edited, or one from an older version of this page, opens on the
   * default window rather than on an error: there is nothing here worth
   * refusing to render a log over.
   */
  validateSearch: (search: Record<string, unknown>): EventSearch => {
    const days = Number(search.days);
    return {
      days: isWindow(days) ? days : 1,
      ...(typeof search.project === "string" && search.project
        ? { project: search.project }
        : {}),
      ...(typeof search.source === "string" && search.source ? { source: search.source } : {}),
      ...(isBand(search.severity) ? { severity: search.severity } : {}),
      ...(typeof search.q === "string" && search.q.trim() ? { q: search.q.slice(0, 200) } : {}),
    };
  },
  // Without this the loader would not re-run when a filter changes, and the
  // page would navigate to a URL describing a list it was not showing.
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const page = await getEventFeed({
      data: { workspace: params.wslug, filter: requestFrom(deps) },
    });
    if (!page) throw notFound();
    return page;
  },
  component: Events,
});

/** The URL's filter, as the wire's. One function, so both sides cannot drift. */
function requestFrom(search: EventSearch, before?: FeedEntry): FeedRequest {
  return {
    hours: (search.days ?? 1) * HOURS_PER_DAY,
    projects: search.project ? [search.project] : [],
    sources: search.source ? [search.source] : [],
    severity: search.severity ?? null,
    search: search.q ?? null,
    before: before ? { time: before.time, entryId: before.entryId } : null,
    limit: FEED_PAGE,
  };
}

/** How often the live tail asks. Slow enough to be ignorable, fast enough to feel live. */
const POLL_MS = 8_000;

function Events() {
  const i18n = useI18n();
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const workspace = WorkspaceRoute.useLoaderData();
  const navigate = useNavigate({ from: "/w/$wslug/events/" });

  const slug = () => workspace().view.workspace.slug;
  /** The window, with the default filled in for a link that named none. */
  const days = (): Window => search().days ?? 1;
  const projects = () => workspace().view.projects;

  const [entries, setEntries] = createSignal<FeedEntry[]>(page().entries);
  const [more, setMore] = createSignal(page().more);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [live, setLive] = createSignal(false);
  const [open, setOpen] = createSignal<string | null>(null);

  /*
   * A new answer from the loader REPLACES the list.
   *
   * Deferred, so the effect does not fire on mount over the value the signal
   * was already created with. After that, every reason the loader re-runs -- a
   * filter changed, Refresh was pressed -- is a reason the pages loaded below
   * the first one no longer belong to it.
   */
  createEffect(
    on(
      page,
      (fresh) => {
        setEntries(fresh.entries);
        setMore(fresh.more);
        setOpen(null);
      },
      { defer: true }
    )
  );

  /** Narrow, replacing the entry in history: a filter is not a place. */
  const narrow = (next: Partial<EventSearch>) =>
    navigate({ search: (prev: EventSearch) => ({ ...prev, ...next }), replace: true });

  // Typing navigates, so the search is in the URL like every other filter --
  // but only once somebody stops typing. A loader run per keystroke would be a
  // query per keystroke over a partitioned table.
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const [draft, setDraft] = createSignal(search().q ?? "");
  createEffect(on(() => search().q, (q) => setDraft(q ?? ""), { defer: true }));

  function typed(value: string) {
    setDraft(value);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      void narrow({ q: value.trim() ? value.trim() : undefined });
    }, 350);
  }
  onCleanup(() => clearTimeout(debounce));

  /**
   * The live tail: re-read the HEAD of the feed and merge.
   *
   * Not "everything after a cursor". A poll that missed more than one page
   * would leave a hole in the middle of the list with nothing on screen saying
   * so, and `mergeFeed` makes the head-read idempotent instead. It also skips
   * while the tab is hidden: a background tab polling a partitioned table for
   * an hour is work nobody is looking at.
   */
  async function poll() {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const fresh = await getEventFeed({
      data: { workspace: slug(), filter: requestFrom(search()) },
    });
    if (!fresh) return;
    setEntries((prev) => mergeFeed(fresh.entries, prev));
  }

  createEffect(() => {
    if (!live()) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  async function older() {
    const last = entries().at(-1);
    if (!last || loadingOlder()) return;
    setLoadingOlder(true);
    try {
      const next = await getEventFeed({
        data: { workspace: slug(), filter: requestFrom(search(), last) },
      });
      if (!next) return;
      setEntries((prev) => [...prev, ...next.entries]);
      setMore(next.more);
    } finally {
      setLoadingOlder(false);
    }
  }

  const windowLabel = (days: Window) =>
    days === 1 ? i18n.t("events.window_hours") : i18n.t("events.window_days", { days });

  const projectName = () =>
    projects().find((p) => p.slug === search().project)?.name ?? search().project ?? "";

  const filtered = () =>
    search().project !== undefined ||
    search().source !== undefined ||
    search().severity !== undefined ||
    search().q !== undefined;

  const measured = createMemo(() => i18n.dateRange(page().from, page().to));

  return (
    <main class="w-full py-4">
      <PageHeader
        title={i18n.t("events.title")}
        description={i18n.t("events.hint")}
        filters={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger as={Button} variant="outline" size="sm" class="rounded-md">
                <ListFilter class="size-3.5" />
                {i18n.t("sources.add_filter")}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{i18n.t("events.window_label")}</DropdownMenuLabel>
                <For each={WINDOWS}>
                  {(option) => (
                    <DropdownMenuItem onSelect={() => void narrow({ days: option })}>
                      <Check
                        class={cn("size-4", days() === option ? "opacity-100" : "opacity-0")}
                      />
                      {windowLabel(option)}
                    </DropdownMenuItem>
                  )}
                </For>

                <DropdownMenuLabel>{i18n.t("events.project_label")}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void narrow({ project: undefined })}>
                  <Check
                    class={cn("size-4", search().project ? "opacity-0" : "opacity-100")}
                  />
                  {i18n.t("events.all_projects")}
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

                <DropdownMenuLabel>{i18n.t("events.severity_label")}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void narrow({ severity: undefined })}>
                  <Check class={cn("size-4", search().severity ? "opacity-0" : "opacity-100")} />
                  {i18n.t("events.severity_any")}
                </DropdownMenuItem>
                <For each={SEVERITY_BANDS}>
                  {(band) => (
                    <DropdownMenuItem onSelect={() => void narrow({ severity: band })}>
                      <Check
                        class={cn(
                          "size-4",
                          search().severity === band ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {i18n.t("events.severity_min", { band: SEVERITY_LABELS[band] })}
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenu>

            {/*
              The window is always a chip, even at its default, because these
              numbers mean nothing without it and there is no reading of this
              page where "over what period" is not the first question.
            */}
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              <span class="text-muted-foreground">{i18n.t("events.window_label")}:</span>
              {windowLabel(days())}
            </Badge>

            <Show when={search().project}>
              <FacetChip
                label={i18n.t("events.project_label")}
                value={projectName()}
                remove={i18n.t("events.remove_filter", { filter: i18n.t("events.project_label") })}
                onRemove={() => void narrow({ project: undefined })}
              />
            </Show>
            <Show when={search().source}>
              <FacetChip
                label={i18n.t("events.source_label")}
                value={i18n.t("events.one_source")}
                remove={i18n.t("events.remove_filter", { filter: i18n.t("events.source_label") })}
                onRemove={() => void narrow({ source: undefined })}
              />
            </Show>
            <Show when={search().severity}>
              {(band) => (
                <FacetChip
                  label={i18n.t("events.severity_label")}
                  value={SEVERITY_LABELS[band()]}
                  remove={i18n.t("events.remove_filter", {
                    filter: i18n.t("events.severity_label"),
                  })}
                  onRemove={() => void narrow({ severity: undefined })}
                />
              )}
            </Show>
          </>
        }
      />

      <div class="flex flex-col gap-4">
        {/* The 36px toolbar row: search, the live toggle, refresh. */}
        <div class="flex flex-row items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={draft()}
              onInput={(e) => typed(e.currentTarget.value)}
              placeholder={i18n.t("events.search_placeholder")}
              aria-label={i18n.t("events.search_label")}
              class="pr-10 pl-9"
            />
            <Kbd class="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </div>

          {/*
            Off by default, and it says so. A list that reorders itself under a
            cursor is a list nobody can read, and the moment somebody is looking
            at one entry is exactly the moment they do not want thirty above it.
          */}
          <Button
            variant={live() ? "secondary" : "outline"}
            size="toolbar"
            aria-pressed={live()}
            title={i18n.t("events.live_hint")}
            onClick={() => setLive((on) => !on)}
          >
            <Radio class={cn("size-4", live() && "animate-pulse text-positive")} />
            {i18n.t("events.live")}
          </Button>

          <RefreshButton />
        </div>

        <div>
          <div class="mb-3 flex h-8 items-center justify-between gap-2 px-1.5">
            <span class="truncate text-body font-medium text-foreground">{measured()}</span>
            <span class="shrink-0 text-caption text-muted-foreground">
              <Show when={live()} fallback={i18n.t("events.events", { count: entries().length })}>
                {i18n.t("events.live_on")}
              </Show>
            </span>
          </div>

          <Show
            when={entries().length > 0}
            fallback={
              <Empty>
                <EmptyMedia>
                  <ScrollText />
                </EmptyMedia>
                <EmptyTitle>
                  {filtered() ? i18n.t("events.no_matches") : i18n.t("events.none")}
                </EmptyTitle>
                <EmptyDescription>
                  {filtered() ? i18n.t("events.widen") : i18n.t("events.none_hint")}
                </EmptyDescription>
              </Empty>
            }
          >
            <ul class="divide-y rounded-md bg-card shadow-sm">
              <For each={entries()}>
                {(entry) => {
                  const id = () => `${entry.projectId}:${entry.entryId}`;
                  return (
                    <EntryRow
                      entry={entry}
                      workspace={slug()}
                      open={open() === id()}
                      onToggle={() => setOpen((current) => (current === id() ? null : id()))}
                    />
                  );
                }}
              </For>
            </ul>

            <Show when={more()}>
              <div class="mt-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => void older()} disabled={loadingOlder()}>
                  <Show when={loadingOlder()} fallback={i18n.t("events.load_older")}>
                    <Spinner class="size-3.5" />
                    {i18n.t("events.loading")}
                  </Show>
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </main>
  );
}

/** One active filter, and a way to take it off. */
function FacetChip(props: { label: string; value: string; remove: string; onRemove: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      class="rounded-md"
      aria-label={props.remove}
      onClick={() => props.onRemove()}
    >
      <span class="text-muted-foreground">{props.label}:</span>
      {props.value}
      <X class="size-3.5 text-muted-foreground" />
    </Button>
  );
}
