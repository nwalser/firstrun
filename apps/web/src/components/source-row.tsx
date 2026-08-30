import { Link } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import BookOpen from "lucide-solid/icons/book-open";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { Show, type JSX } from "solid-js";
import { IngestHistogram, IngestRate, ingestTotal } from "./ingest-histogram.js";
import { buttonVariants } from "./ui/index.js";
import type { WorkspaceSourceSummary } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * One source, as both lists draw it.
 *
 * The workspace's list and a project's are the SAME list at two scopes, so they
 * are the same row: the same 75px shape, the same figure over the same window,
 * the same chart from the same component, the same way in. They used to be two
 * components that merely resembled each other, and they had already drifted --
 * one grew a rate and a month while the other still had an empty column where
 * they belonged.
 *
 * Only two things differ, and both are things the scope genuinely decides:
 * whether the row names the project it reports into (at project scope that is
 * the page you are already on), and what sits in the action cell (a project's
 * list can delete; the workspace's cannot, because deleting belongs where the
 * source belongs).
 */
export function SourceRow(props: {
  workspace: string;
  source: WorkspaceSourceSummary;
  /** Names the project it reports into. Off at project scope. */
  showProject?: boolean;
  /** Extra actions before the chevron. Raised above the row's link already. */
  actions?: JSX.Element;
}) {
  const i18n = useI18n();
  const total = () => ingestTotal(props.source.daily);

  return (
    <li class="relative flex items-center gap-3 p-4 has-[a:hover]:bg-accent">
      {/*
        The stretched link. First in the markup and behind everything, so a
        click on dead space in the row lands on it.

        Stretched rather than wrapped: the row also carries a documentation link
        and, at project scope, a delete. An anchor may not contain a button, and
        inside one anchor copying anything would be a navigation.
      */}
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

      {/*
        The reference splits this row at its own extra-large pane step. We split
        at the medium one: their measuring pane was 2258px wide and ours rarely
        is, so holding a 75px row stacked until 1280px would leave most panes
        showing the tall form of a short row.
      */}
      <div class="pointer-events-none flex min-w-0 items-center gap-4 @md-page/page:w-[calc(25%+48px)]">
        {/* One mark for every source, because there is one kind of source. */}
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

      {/*
        Which product this reports into, and a way into it. The one thing the
        workspace's list has that a project's cannot: at project scope every row
        would say the same word.

        The CELL stays transparent to the pointer and only the link inside it is
        raised. A raised cell swallows every click across its whole width, which
        is most of the row, and the stretched link under it would then only work
        on the gaps between columns.
      */}
      <Show when={props.showProject !== false}>
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
      </Show>

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
        left. Both lists draw the same pair from the same component over the
        same window, so a source's bars can honestly be read against its
        project's. Thirty bars in 140px is a texture; thirty bars in three
        hundred is a shape, and the shape is what the row is here to show.
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

      <div class="relative z-10 ml-auto flex shrink-0 items-center gap-2">
        {/*
          The id travels in the query string, so the documentation opens with
          this source already selected and every snippet on it carries this key.
          An icon, not a panel: the guide is five pages long and belongs where it
          can be read.
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

        {props.actions}

        <ChevronRight class="pointer-events-none size-4 text-muted-foreground" />
      </div>
    </li>
  );
}
