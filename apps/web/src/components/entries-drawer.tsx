import {
  drillRequest,
  type FeedEntry,
  type FeedWindow,
  type Filter,
} from "@firstrun/schema";
import { For, Show, createEffect, createSignal, on } from "solid-js";
import { getEventFeed } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { EntryRow } from "./entry-row.js";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from "./ui/index.js";
import ScrollText from "lucide-solid/icons/scroll-text";

/**
 * The entries behind one card.
 *
 * A board answers "how many"; this answers "which ones", which is the question
 * anybody asks the moment a number looks wrong. Without it a card is a dead
 * end: the count and the rows that produced it lived in two places that could
 * not be got to from one another.
 *
 * It is the SAME filter the card was measured with, sent to the log's own
 * reader and compiled by the query compiler (`compileFilterFragment`), so the
 * rows here cannot select a different set of entries than the number did. That
 * is the whole point, and it is why the filter travels as the filter rather
 * than as a search box somebody has to reconstruct by hand.
 *
 * A drawer over the board rather than a page: the number is the context, and
 * navigating away to check it would lose the arrangement the reader is looking
 * at. Nothing here is saved, shared or turned into a widget -- the log view is
 * bounded, paged and never compiled into a card, and reaching it from a card
 * does not change that.
 */
export function EntriesDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  projectSlug: string;
  /** The card's own window: the board's range, resolved. Pinned, not rolling. */
  window: FeedWindow;
  /** The card's effective filter: the board's frame and the card's own. */
  filter: Filter;
  /** What the card is called, so the drawer names what it is showing rows for. */
  title: string;
}) {
  const i18n = useI18n();

  const [entries, setEntries] = createSignal<FeedEntry[]>([]);
  const [more, setMore] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [opened, setOpened] = createSignal<string | null>(null);

  const request = (before?: FeedEntry) => ({
    ...drillRequest({
      window: props.window,
      project: props.projectSlug,
      filter: props.filter,
    }),
    before: before ? { time: before.time, entryId: before.entryId } : null,
  });

  async function load(before?: FeedEntry) {
    if (loading()) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await getEventFeed({
        data: { workspace: props.workspaceSlug, filter: request(before) },
      });
      if (!page) {
        setFailed(true);
        return;
      }
      setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
      setMore(page.more);
    } catch {
      // A drill-down that cannot load is a drawer that says so. It is a read
      // beside the board, and it may not take the board down with it.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  /*
   * Fetched on open, and again whenever the card being looked at changes.
   *
   * Keyed on the filter and the window rather than on `open` alone: the same
   * drawer serves every card on the board, so opening it on a different card
   * has to replace the rows rather than show the last card's.
   */
  createEffect(
    on(
      () => [props.open, JSON.stringify(props.filter), props.window.from, props.window.to],
      ([isOpen]) => {
        if (!isOpen) return;
        setEntries([]);
        setMore(false);
        setOpened(null);
        void load();
      }
    )
  );

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent class="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          {/*
            The window is stated rather than implied. A page of rows with no
            window on it is the same unfalsifiable number the drawer exists to
            make checkable.
          */}
          <SheetDescription>
            {i18n.t("dashboard.drill_window", {
              window: i18n.dateRange(props.window.from, props.window.to),
            })}
          </SheetDescription>
        </SheetHeader>

        <SheetBody class="px-0">
          <Show
            when={entries().length > 0}
            fallback={
              <Show
                when={!loading()}
                fallback={
                  <div class="flex justify-center py-10">
                    <Spinner />
                  </div>
                }
              >
                <Empty>
                  <EmptyMedia>
                    <ScrollText />
                  </EmptyMedia>
                  <EmptyTitle>
                    {failed() ? i18n.t("dashboard.drill_failed") : i18n.t("dashboard.drill_none")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {failed()
                      ? i18n.t("dashboard.drill_failed_hint")
                      : i18n.t("dashboard.drill_none_hint")}
                  </EmptyDescription>
                </Empty>
              </Show>
            }
          >
            <ul class="divide-y divide-border border-y border-border">
              <For each={entries()}>
                {(entry) => {
                  const key = `${entry.projectId}:${entry.entryId}`;
                  return (
                    <EntryRow
                      entry={entry}
                      workspace={props.workspaceSlug}
                      showProject={false}
                      open={opened() === key}
                      onToggle={() => setOpened((current) => (current === key ? null : key))}
                    />
                  );
                }}
              </For>
            </ul>

            <Show when={more()}>
              <div class="flex justify-center px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading()}
                  onClick={() => void load(entries().at(-1))}
                >
                  {loading() ? i18n.t("events.loading") : i18n.t("events.load_older")}
                </Button>
              </div>
            </Show>
          </Show>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
