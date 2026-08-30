import { Link } from "@tanstack/solid-router";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { Show } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";
import { sectionedTopics, topicTitle, type DocsTopic } from "./registry.js";

/**
 * The way on, at the end of a page.
 *
 * A guide read to the bottom has answered its own question and left the reader
 * with the next one, and the contents is 287px away on the other side of the
 * screen -- or, below `md`, behind a button. Naming the next page in the flow
 * is what turns a set of pages into a manual you can read straight through, and
 * it is the one piece of navigation that costs the reader no decision.
 *
 * ## The order is the contents' order, and there is only one of those
 *
 * Both are `sectionedTopics()` flattened, so the sequence here and the sequence
 * in the column cannot disagree: "next" is literally the row under this one.
 * Sections are crossed rather than stopped at -- the last install guide leads
 * into the first concept page, because that is what reading on means.
 *
 * The pair is not filtered by the picked source. Nothing in the documentation is any
 * more; see `sectionedTopics`.
 */

function neighbours(slug: string): { previous: DocsTopic | null; next: DocsTopic | null } {
  const flat = sectionedTopics().flatMap((group) => group.topics);
  const index = flat.findIndex((topic) => topic.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? (flat[index - 1] ?? null) : null,
    next: index < flat.length - 1 ? (flat[index + 1] ?? null) : null,
  };
}

export function PageNav(props: { slug: string; class?: string }) {
  const i18n = useI18n();
  const pair = () => neighbours(props.slug);

  return (
    <Show when={pair().previous || pair().next}>
      <nav
        aria-label={i18n.t("docs.topics")}
        // The rule is the page ending, so it takes the full column and a lot of
        // space above it: this is the first thing below the last sentence, and
        // a link pinned to the end of a paragraph reads as part of it.
        class={cn("mt-16 flex items-start justify-between gap-6 border-t pt-6", props.class)}
      >
        {/* Always both cells, even when one is empty, so a page at either end
            of the documentation does not pull its one link into the middle. */}
        <div class="min-w-0 flex-1">
          <Show when={pair().previous}>
            {(topic) => (
              <NavLink
                slug={topic().slug}
                label={i18n.t("docs.previous")}
                title={topicTitle(i18n.t, topic())}
                direction="previous"
              />
            )}
          </Show>
        </div>

        <div class="flex min-w-0 flex-1 justify-end">
          <Show when={pair().next}>
            {(topic) => (
              <NavLink
                slug={topic().slug}
                label={i18n.t("docs.next")}
                title={topicTitle(i18n.t, topic())}
                direction="next"
              />
            )}
          </Show>
        </div>
      </nav>
    </Show>
  );
}

/**
 * One half of the pair.
 *
 * The label is chrome and the title is the link: 12px muted over the page's own
 * name at the prose step. The chevron sits on the outside edge -- left of a
 * previous, right of a next -- so the two read as pointing away from the page
 * rather than at each other.
 */
function NavLink(props: {
  slug: string;
  label: string;
  title: string;
  direction: "previous" | "next";
}) {
  const forward = () => props.direction === "next";

  return (
    <Link
      to="/docs/$topic"
      params={{ topic: props.slug }}
      class={cn(
        "focus-ring group flex min-w-0 items-center gap-2 rounded-md py-1",
        forward() && "flex-row-reverse text-right"
      )}
    >
      <span class="text-muted-foreground shrink-0 transition-colors group-hover:text-foreground">
        <Show when={forward()} fallback={<ChevronLeft class="size-4" />}>
          <ChevronRight class="size-4" />
        </Show>
      </span>
      <span class="min-w-0">
        <span class="text-small text-muted-foreground block">{props.label}</span>
        <span class="text-prose text-foreground block truncate font-medium">{props.title}</span>
      </span>
    </Link>
  );
}
