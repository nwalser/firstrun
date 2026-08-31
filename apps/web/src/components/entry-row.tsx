import {
  severityBand,
  severityText,
  type FeedEntry,
  type SeverityBand,
} from "@firstrun/schema";
import { ATTR, entryIdentity } from "@firstrun/schema/conventions";
import { Link } from "@tanstack/solid-router";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { For, Show, createMemo, type JSX } from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";
import { ROW_INTERACTION } from "./page-header.js";
import { Badge } from "./ui/index.js";

/**
 * One entry, as every surface that shows entries draws it.
 *
 * There is one row for every surface that shows entries, which today is the log
 * page and the single-entry page. A second row component would drift the moment
 * one of them learned to show something the other did not, and the two stamps
 * sitting side by side is the whole reason anybody opens a row.
 *
 * Nothing here fetches. It takes an entry and draws it, so the page can poll
 * and the drawer can page and neither has to care what the other does.
 */

/**
 * How a severity reads at a glance.
 *
 * Four steps of colour over twenty-four numbers, because the bands are what a
 * person filters on and the step inside a band is what a library uses to say
 * "slightly worse than the last one". The exact number is still on the row, in
 * the spec's own short form: `INFO2`, `ERROR`, `FATAL3`.
 */
export const BAND_TONE: Record<SeverityBand, string> = {
  TRACE: "text-muted-foreground",
  DEBUG: "text-muted-foreground",
  INFO: "text-foreground",
  WARN: "text-warning",
  ERROR: "text-negative",
  FATAL: "text-negative",
};

/** How late an entry was, or null when it arrived when it happened. */
export function lateness(entry: FeedEntry): number | null {
  const delay = new Date(entry.ingestedAt).getTime() - new Date(entry.time).getTime();
  // A minute of slack: a request takes time, and clocks disagree by seconds.
  return Number.isFinite(delay) && delay > 60_000 ? delay : null;
}

/**
 * One entry.
 *
 * Closed it is a row; opened it is the whole entry, attributes and all. A
 * drawer would put the entry somewhere other than where the reader is looking,
 * and a separate page would lose the list.
 */
export function EntryRow(props: {
  entry: FeedEntry;
  /** The workspace the link is built inside. */
  workspace: string;
  open: boolean;
  onToggle: () => void;
  /**
   * Whether the row names its project.
   *
   * Off wherever every row is already known to be the same project, because
   * the column would then be one word repeated fifty times. The opened row
   * still states it, because that is where somebody checks rather than scans.
   */
  showProject?: boolean;
}) {
  const i18n = useI18n();

  const late = () => lateness(props.entry);

  return (
    // `relative`, because the link below is stretched across the whole row.
    <li class="relative">
      <div
        class={cn(
          ROW_INTERACTION,
          "flex w-full items-center gap-3 px-4 py-2.5 text-left",
          // The stretched link is the thing being hovered, so the row has to
          // light up from a hover ON IT rather than on this box.
          "has-[a:hover]:bg-accent has-[a:focus-visible]:bg-accent"
        )}
      >
        {/*
          The whole row opens the entry, and the expander opens it in place.

          A stretched link rather than a wrapper: the row also carries a button,
          and an anchor may not contain one. So the anchor covers the row from
          underneath and the button sits above it. The visible text stays out of
          the anchor entirely, which is also what keeps a mouse selection of a
          client id from turning into a navigation.

          `at` is the entry's own timestamp, and it is what turns the lookup on
          the other side into a primary-key hit rather than a scan. See
          `db/feed.ts`.
        */}
        <Link
          to="/w/$wslug/events/$eid"
          params={{ wslug: props.workspace, eid: props.entry.entryId }}
          search={{ at: props.entry.time, project: props.entry.projectSlug }}
          class="absolute inset-0 z-0 outline-none"
          aria-label={i18n.t("events.open_event", { name: props.entry.name })}
        />

        {/* Client-stamped, which is what everything here sorts on. */}
        <span class="pointer-events-none flex w-[150px] shrink-0 items-baseline gap-2 font-mono text-mono">
          <span class="text-foreground">
            {i18n.date(props.entry.time, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span class="text-muted-foreground">{i18n.shortDate(props.entry.time)}</span>
        </span>

        {/*
          The number, in the spec's own short form, tinted by its band. The
          exact step matters: `INFO2` and `INFO` sort differently and a library
          that emits the second one meant it.
        */}
        <span class="pointer-events-none w-[76px] shrink-0 font-mono text-mono">
          <Show
            when={props.entry.severity}
            fallback={<span class="text-muted-foreground opacity-60">--</span>}
          >
            {(severity) => (
              <span class={BAND_TONE[severityBand(severity())]}>{severityText(severity())}</span>
            )}
          </Show>
        </span>

        <span
          class="pointer-events-none min-w-0 flex-1 truncate text-body"
          title={props.entry.name}
        >
          {props.entry.name}
        </span>

        <Show when={props.showProject !== false}>
          <span class="pointer-events-none hidden w-[22%] min-w-0 shrink-0 truncate text-caption text-muted-foreground @md-page/page:block">
            {props.entry.projectName}
          </span>
        </Show>

        <Show when={late()}>
          {(delay) => (
            <Badge
              variant="estimate"
              class="pointer-events-none hidden shrink-0 @lg-page/page:inline-flex"
            >
              {i18n.t("events.late_by", { delay: i18n.duration(delay()) })}
            </Badge>
          )}
        </Show>

        {/*
          Above the stretched link, so reading an entry in place stays one click
          and does not navigate. This is the only interactive thing in the row
          besides the link itself.
        */}
        <button
          type="button"
          onClick={() => props.onToggle()}
          aria-expanded={props.open}
          aria-label={i18n.t(props.open ? "events.hide_detail" : "events.show_detail")}
          title={i18n.t(props.open ? "events.hide_detail" : "events.show_detail")}
          class={cn(
            "relative z-10 grid size-control-xs shrink-0 place-items-center rounded-md",
            "text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-ring"
          )}
        >
          {/*
            Right at rest, down while open. The resting direction is what every
            other row in the product that leads somewhere points, and this row
            does lead somewhere: a chevron resting downwards said "there is more
            below" on a row whose click opens a page.

            TWO ICONS rather than one rotated by a utility. `rotate-90` on this
            element computes to `0deg` even though the rule is in the stylesheet
            and the element matches it -- an identical synthetic `<svg>` with
            the same class list rotates, this one does not. That is the trap
            CLAUDE.md records about assuming a class name works, and swapping
            the glyph is both immune to it and one fewer thing to explain.
          */}
          <Show when={props.open} fallback={<ChevronRight class="size-4" />}>
            <ChevronDown class="size-4" />
          </Show>
        </button>
      </div>

      <Show when={props.open}>
        <EntryDetail entry={props.entry} />
      </Show>
    </li>
  );
}

/**
 * The whole entry, inside a row that has been opened.
 *
 * The two halves are exported separately as well, because the entry's own page
 * lays the same facts out as cards. One definition of what an entry IS, two
 * arrangements of it: a row that grew its own idea of an entry would drift from
 * the page the moment either learned a new field.
 */
export function EntryDetail(props: { entry: FeedEntry }) {
  const i18n = useI18n();

  return (
    <div class="border-t bg-muted/30 px-4 py-3">
      <EntryFacts entry={props.entry} />
      <div class="mt-3">
        {/* The row states the heading; the entry's own page uses a card title
            for it instead, which is why it is here rather than inside. */}
        <div class="mb-1 text-caption font-medium text-foreground">
          {i18n.t("events.attributes")}
        </div>
        <EntryAttributes entry={props.entry} />
      </div>
    </div>
  );
}

/** The two timestamps, the ids, and the late note when there is one. */
export function EntryFacts(props: { entry: FeedEntry }) {
  const i18n = useI18n();

  const late = () => lateness(props.entry);

  return (
    <>
      <div class="grid gap-x-6 gap-y-1 @lg-page/page:grid-cols-2">
        <Fact label={i18n.t("events.happened")}>
          {i18n.dateTime(props.entry.time)}
          <span class="ml-2 text-muted-foreground">{i18n.relative(props.entry.time)}</span>
        </Fact>
        <Fact label={i18n.t("events.received")}>
          {i18n.dateTime(props.entry.ingestedAt)}
        </Fact>
        <Fact label={i18n.t("events.col_project")}>{props.entry.projectName}</Fact>
        <Show when={entryIdentity(props.entry.attributes)}>
          {(id) => (
            <Fact label={id().key}>
              <span class="font-mono text-mono">{id().value}</span>
            </Fact>
          )}
        </Show>
        <Fact label={i18n.t("events.event_id")}>
          <span class="font-mono text-mono">{props.entry.entryId}</span>
        </Fact>
        <Show when={props.entry.attributes[ATTR.SOURCE_ID]}>
          {(source) => (
            <Fact label={i18n.t("events.source_label")}>
              <span class="font-mono text-mono">{String(source())}</span>
            </Fact>
          )}
        </Show>
      </div>

      {/*
        Stated rather than implied. An entry that arrived a day after it
        happened is the most common cause of a number somebody thinks is wrong,
        and this is the one place the two stamps sit side by side.
      */}
      <Show when={late()}>
        <p class="mt-2 max-w-2xl text-caption text-muted-foreground">
          {i18n.t("events.late_hint")}
        </p>
      </Show>
    </>
  );
}

/** Every attribute the entry carries, sorted by key. */
export function EntryAttributes(props: { entry: FeedEntry }) {
  const i18n = useI18n();

  const attributes = createMemo(() =>
    Object.entries(props.entry.attributes).sort(([a], [b]) => a.localeCompare(b))
  );

  return (
    <>
        <Show
          when={attributes().length > 0}
          fallback={
            <span class="text-caption text-muted-foreground">
              {i18n.t("events.no_attributes")}
            </span>
          }
        >
          <dl class="grid gap-x-4 gap-y-0.5 @md-page/page:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <For each={attributes()}>
              {([key, value]) => (
                <>
                  <dt class="truncate font-mono text-mono text-muted-foreground" title={key}>
                    {key}
                  </dt>
                  <dd class="min-w-0 font-mono text-mono break-words text-foreground">
                    {render(value)}
                  </dd>
                </>
              )}
            </For>
          </dl>
        </Show>
    </>
  );
}

/**
 * An attribute value, as text.
 *
 * A string is printed as it is; anything else goes through JSON, so `null`,
 * `false` and the empty string stay tellable apart. The map is bounded at write
 * time (`packages/schema/src/attributes.ts`), so "print the whole thing" has a
 * known worst case.
 */
function render(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** A label and its value, in the opened row. */
function Fact(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-baseline gap-2 py-0.5 text-caption">
      <span class="w-[110px] shrink-0 text-muted-foreground">{props.label}</span>
      <span class="min-w-0 flex-1 truncate text-foreground">{props.children}</span>
    </div>
  );
}
