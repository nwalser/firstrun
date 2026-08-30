import { Link, createFileRoute } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import FileQuestionMark from "lucide-solid/icons/file-question-mark";
import { Show } from "solid-js";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/index.js";
import {
  buildRenderContext,
  topicBySlug,
  topicSummary,
  topicTitle,
} from "../components/docs/registry.js";
import { Callout } from "../components/docs/snippet.js";
import { PageNav } from "../components/docs/page-nav.js";
import { DocsPage, useDocs } from "../components/docs/shell.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * One page of the documentation.
 *
 * The page is a function of the reader's chosen source, so it is called again
 * whenever that changes -- which is what lets a snippet three screens down
 * swap in a real ingest key without a reload.
 *
 * An unknown slug is answered here rather than thrown as a route-level
 * not-found: the global 404 would take the reader out of the documentation entirely,
 * and the useful response to a dead link is the contents, still on screen, with
 * a sentence saying which page is missing.
 */
export const Route = createFileRoute("/docs/$topic")({
  loader: ({ params }) => ({ slug: params.topic }),
  component: DocsTopicPage,
});

function DocsTopicPage() {
  const i18n = useI18n();
  const data = Route.useLoaderData();
  const documentation = useDocs();
  const topic = () => topicBySlug(data().slug);

  return (
    <DocsPage>
      <Show when={topic()} fallback={<NotFound slug={data().slug} />}>
        {(entry) => (
          <>
            {/*
              The title block, which is a title and nothing else.

              The h1 takes the DISPLAY step -- 40px on 48, at -0.06em -- which
              is the measured heading of this design system and the one thing
              that most says "documentation" before a word is read.

              What used to sit around it is gone. There was a section label
              above ("Install guides") and an applicability badge beside it
              ("server sources"), and the reference has neither: a documentation
              page opens with its name, on its own line, and the first paragraph
              under it is the first paragraph of the page.

              Both were saying something already said better elsewhere. The
              section is the group the current row sits in, in the contents,
              two inches to the left and permanently on screen. The badge said
              which kind of source the page was written for, and there are no
              kinds of source: whatever the reader picked, its key is the right
              one to paste into this page's snippets.
            */}
            <div class="pb-2">
              <h1 class="text-display">{topicTitle(i18n.t, entry())}</h1>
              {/* The lede reads at the prose step and in the prose colour: it
                  is the first paragraph of the page, not a caption on it. */}
              <p class="mt-4 text-prose text-foreground">{topicSummary(i18n.t, entry())}</p>
            </div>

            {/*
              There is no mismatch to warn about any more. A page used to declare
              which kind of source it was written for, and this drew a warning
              when the reader had picked another kind: their key would be pasted
              into snippets meant for something else. A source has no kind now,
              so the reader picked one destination and its key is the right key
              on every page.

              Called inside the JSX so a change of source re-renders the page.
            */}
            {entry().render(
              buildRenderContext({
                source: documentation.source(),
                signedIn: documentation.signedIn,
                publicOrigin: documentation.publicOrigin,
              })
            )}

            {/* The way on. Outside the prose, because it is navigation rather
                than part of what the page says. */}
            <PageNav slug={entry().slug} />
          </>
        )}
      </Show>
    </DocsPage>
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
      <EmptyTitle>{i18n.t("docs.no_page_called", { slug: props.slug })}</EmptyTitle>
      <EmptyDescription>{i18n.t("docs.not_found_hint")}</EmptyDescription>
      {/* `EmptyContent` is what spends the measured 24px between the body and
          the call to action; the link's own margin was half of it. */}
      <EmptyContent>
        {/* An inline word, so it takes the OUTLINE form of the focus ring: a
            box-shadow on an inline box paints around the line box rather than
            around the text, and lands in the wrong place. */}
        <Link
          to="/docs"
          class="focus-outline inline-flex items-center gap-1.5 rounded-sm text-body font-medium underline-offset-4 hover:underline"
        >
          {i18n.t("docs.back_to_overview")}
          <ArrowRight class="size-4" />
        </Link>
      </EmptyContent>
    </Empty>
  );
}
