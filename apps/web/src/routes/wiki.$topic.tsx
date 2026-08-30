import { Link, createFileRoute } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import FileQuestionMark from "lucide-solid/icons/file-question-mark";
import { Show } from "solid-js";
import {
  Badge,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/index.js";
import {
  buildRenderContext,
  sectionLabel,
  topicBySlug,
  topicSummary,
  topicTitle,
} from "../components/wiki/registry.js";
import { Callout } from "../components/wiki/snippet.js";
import { WikiPage, useWiki } from "../components/wiki/shell.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * One page of the wiki.
 *
 * The page is a function of the reader's chosen source, so it is called again
 * whenever that changes -- which is what lets a snippet three screens down
 * swap in a real ingest key without a reload.
 *
 * An unknown slug is answered here rather than thrown as a route-level
 * not-found: the global 404 would take the reader out of the wiki entirely,
 * and the useful response to a dead link is the contents, still on screen, with
 * a sentence saying which page is missing.
 */
export const Route = createFileRoute("/wiki/$topic")({
  loader: ({ params }) => ({ slug: params.topic }),
  component: WikiTopicPage,
});

function WikiTopicPage() {
  const i18n = useI18n();
  const data = Route.useLoaderData();
  const wiki = useWiki();
  const topic = () => topicBySlug(data().slug);

  return (
    <WikiPage>
      <Show when={topic()} fallback={<NotFound slug={data().slug} />}>
        {(entry) => (
          <>
            {/*
              The title block. The h1 takes the DISPLAY step -- 40px on 48, at
              -0.06em -- which is the measured heading of this design system and
              the one thing that most says "documentation" before a word is
              read. It was two steps down the ladder at 20px, which is a card
              heading, and a page whose title is the same size as the heading
              halfway down it has no title.

              The section above it is the measured section label: sentence case
              at 14/500 in the primary text colour, not an 11px tracked-out
              capital and not a muted caption. Uppercase micro-labels are the
              shadcn dashboard house style; this is a Geist page.
            */}
            <div class="pb-4">
              <div class="flex h-8 items-center text-body font-medium text-foreground">
                {sectionLabel(i18n.t, entry().section)}
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-3">
                <h1 class="text-display">{topicTitle(i18n.t, entry())}</h1>
                <Show when={entry().appliesTo}>
                  {(kind) => (
                    <Badge variant="outline">{i18n.t("wiki.kind_sources", { kind: kind() })}</Badge>
                  )}
                </Show>
              </div>
              {/* The lede reads at the prose step and in the prose colour: it
                  is the first paragraph of the page, not a caption on it. */}
              <p class="mt-4 text-prose text-foreground">{topicSummary(i18n.t, entry())}</p>
            </div>

            {/*
              The reader picked a source of the other kind. The page still
              renders -- they may be reading ahead -- but its snippets carry the
              wrong key, and that is worth one line rather than a silent
              mismatch discovered after a deploy.
            */}
            <Show
              when={
                entry().appliesTo &&
                wiki.source() &&
                wiki.source()!.kind !== entry().appliesTo
              }
            >
              {/*
                One key rather than the three fragments this used to be built
                from. The source name lost its bold with the split: German puts
                the clauses in a different order, and a sentence assembled from
                translated pieces cannot be reordered. The name is a proper noun
                in the middle of the line and still reads as the subject.
              */}
              <Callout variant="warning" class="mb-6">
                {i18n.t("wiki.kind_mismatch", {
                  page: entry().appliesTo ?? "",
                  name: wiki.source()!.name,
                  kind: wiki.source()!.kind,
                })}
              </Callout>
            </Show>

            {/*
              Built here rather than through `wiki.ctxFor`, which only knows how
              to be asked for a web or a desktop page. `appliesTo` is the whole
              `Surface` now, so a Node page asking for its placeholder gets a
              `fr_server_` key instead of being quietly answered with a web one.
              Called inside the JSX so a change of source re-renders the page.
            */}
            {entry().render(
              buildRenderContext({
                source: wiki.source(),
                signedIn: wiki.signedIn,
                publicOrigin: wiki.publicOrigin,
                kind: entry().appliesTo,
              })
            )}
          </>
        )}
      </Show>
    </WikiPage>
  );
}

function NotFound(props: { slug: string }) {
  const i18n = useI18n();
  return (
    <Empty class="mt-4">
      {/* The tile is part of the page empty state, not decoration on it: a
          popover gets a line, a page gets the tile. */}
      <EmptyMedia>
        <FileQuestionMark />
      </EmptyMedia>
      {/* The quotation marks are inside the catalogue entry: German writes „…“
          and a straight pair in a German sentence reads as a typo. */}
      <EmptyTitle>{i18n.t("wiki.no_page_called", { slug: props.slug })}</EmptyTitle>
      <EmptyDescription>{i18n.t("wiki.not_found_hint")}</EmptyDescription>
      {/* `EmptyContent` is what spends the measured 24px between the body and
          the call to action; the link's own margin was half of it. */}
      <EmptyContent>
        <Link
          to="/wiki"
          class="inline-flex items-center gap-1.5 text-body font-medium underline-offset-4 hover:underline"
        >
          {i18n.t("wiki.back_to_overview")}
          <ArrowRight class="size-4" />
        </Link>
      </EmptyContent>
    </Empty>
  );
}
