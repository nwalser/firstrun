import { Link, createFileRoute } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import BookOpen from "lucide-solid/icons/book-open";
import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ROW_INTERACTION } from "../components/page-header.js";
import {
  Badge,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { DocsPage, DocsProse, useDocs } from "../components/docs/shell.js";
import {
  sectionLabel,
  sectionedTopics,
  topicSummary,
  topicTitle,
} from "../components/docs/registry.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * The front page of the documentation.
 *
 * The first thing a signed-out reader sees, so it leads with what firstrun is
 * for rather than with a list of links. The surfaces are drawn because the
 * argument is about their shape: one backend, one project, every surface
 * reporting side by side instead of one tool per platform.
 */
export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
});

/** The five surfaces, in the order `SURFACES` declares them. */
const SURFACES = ["web", "desktop", "mobile", "server", "other"];

function DocsIndex() {
  const i18n = useI18n();
  const documentation = useDocs();
  const groups = () => sectionedTopics();

  return (
    <DocsPage>
      {/* The same title step every topic page takes. An overview set smaller
          than the pages it introduces reads as a sub-page of them. */}
      <h1 class="text-display">firstrun documentation</h1>

      {/* The lede is prose and takes the prose treatment: 16px on a 27px line,
          at full contrast, with the measure coming from the column. It was
          14px muted, which is the size of a caption. */}
      <DocsProse class="mt-6">
        {/*
          Split around the emphasis, which is part of the sentence rather than
          decoration on it. A placeholder cannot carry markup, so the choice was
          two keys or no emphasis; both halves here are whole clauses, so German
          word order survives the seam. Same shape three paragraphs down, around
          the call written in code.
        */}
        <p>
          {i18n.t("docs.index_lede_before")}{" "}
          <strong>{i18n.t("docs.index_lede_strong")}</strong>{" "}
          {i18n.t("docs.index_lede_after")}
        </p>

        {/* The surfaces, as the shape of the argument rather than decoration.
            `Badge` rather than a chip spelled out here: the page already draws
            one eleven lines down, and two chips that differ by a pixel of
            padding is how a set of labels stops reading as a set. */}
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={SURFACES}>{(surface) => <Badge variant="outline">{surface}</Badge>}</For>
        </div>

        <p>
          {i18n.t("docs.index_events_before")} <code>track("download_clicked")</code>{" "}
          {i18n.t("docs.index_events_after")}
        </p>

        <p>
          <Show
            when={documentation.sources().length > 0}
            fallback={<>{i18n.t("docs.index_sign_in_hint")}</>}
          >
            {i18n.t("docs.index_pick_source")}
          </Show>
        </p>
      </DocsProse>

      <Show
        when={groups().length > 0}
        fallback={
          <Empty class="mt-8">
            {/* The tile is part of the page empty state, not decoration on it:
                a popover gets a line, a page gets the tile. */}
            <EmptyMedia>
              <BookOpen />
            </EmptyMedia>
            <EmptyTitle>{i18n.t("docs.no_pages")}</EmptyTitle>
            <EmptyDescription>
              {i18n.t("docs.no_pages_hint")}
              <code class="mx-1 font-mono text-body">src/components/docs/topics/</code>.
            </EmptyDescription>
          </Empty>
        }
      >
        <div class="mt-12 flex flex-col gap-10">
          <For each={groups()}>
            {(group) => (
              <section>
                {/* The measured label above a card list: 14/500 in the primary
                    text colour, in a 32px row with 6px of horizontal padding.
                    Sentence case, and no tracked-out uppercase micro-label --
                    that is the shadcn dashboard house style and not what this
                    design system does. */}
                <h2 class="flex h-8 items-center px-1.5 text-body font-medium text-foreground">
                  {sectionLabel(i18n.t, group.section)}
                </h2>
                {/* The raised surface: the ring AND the 1px lift under it, at
                    the 6px surface radius. A border here would be a second
                    hairline, and the ring alone is for a boundary rather than
                    for a surface. */}
                <ul class="mt-3 flex flex-col divide-y rounded-md bg-card shadow-sm">
                  <For each={group.topics}>
                    {(topic) => (
                      <li class="first:rounded-t-md last:rounded-b-md">
                        <Link
                          to="/docs/$topic"
                          params={{ topic: topic.slug }}
                          class={cn(
                            ROW_INTERACTION,
                            "group flex items-start gap-3 rounded-[inherit] p-4"
                          )}
                        >
                          <Show when={topic.icon}>
                            {(icon) => (
                              <span class="mt-0.5 text-muted-foreground">
                                <Dynamic component={icon()} class="size-4" />
                              </span>
                            )}
                          </Show>
                          <span class="min-w-0 flex-1">
                            <span class="flex flex-wrap items-center gap-2">
                              <span class="text-prose font-medium text-foreground">
                                {topicTitle(i18n.t, topic)}
                              </span>
                              <Show when={topic.appliesTo}>
                                {(kind) => <Badge variant="outline">{kind()}</Badge>}
                              </Show>
                            </span>
                            <span class="mt-1 block text-body text-muted-foreground">
                              {topicSummary(i18n.t, topic)}
                            </span>
                          </span>
                          {/* The same nudge the project rows and the board rows
                              make, rather than a third idiom for "there is a
                              way in here": always present in the muted tone,
                              stepping right on hover. Revealed from nothing it
                              was also invisible to anyone arriving by keyboard,
                              since only the pointer ever produced it. */}
                          <ArrowRight class="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </Show>
    </DocsPage>
  );
}
