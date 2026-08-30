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
} from "../components/wiki/registry.js";
import { Callout } from "../components/wiki/snippet.js";
import { PageNav } from "../components/wiki/page-nav.js";
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
              two inches to the left and permanently on screen. The kind is
              either irrelevant -- the reader is reading this page because they
              want this page -- or it is a MISMATCH with the source they have
              picked, and that case gets a sentence below rather than a badge
              above, because a badge cannot say "and the key in these snippets
              is the wrong one".
            */}
            <div class="pb-2">
              <h1 class="text-display">{topicTitle(i18n.t, entry())}</h1>
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

            {/* The way on. Outside the prose, because it is navigation rather
                than part of what the page says. */}
            <PageNav slug={entry().slug} />
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
