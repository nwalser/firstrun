import { Link } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import BookOpen from "lucide-solid/icons/book-open";
import { cn } from "../lib/cn.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { buttonVariants } from "./ui/index.js";

/**
 * The way into the install guides, which now live in the documentation.
 *
 * This file used to be the guide itself, duplicated onto two pages behind the
 * app's login. That was the wrong home for it twice over: the person deciding
 * whether to adopt firstrun cannot read anything behind a session, and a guide
 * that only exists on the page that created a source is a guide nobody can
 * link a colleague to. They are all under `/documentation` now, public, one per client.
 *
 * What stays here is the handoff. The reader is on a page that already knows
 * which source they mean, so the link carries that source's id as `?source=`
 * and the documentation adopts it on arrival -- the `/documentation` layout route validates the
 * parameter and `DocsShell` applies it. A link that dropped it would land
 * somebody on a generic page and ask them to pick, out of a list, the thing
 * they were already looking at.
 */

/**
 * Where the install link lands, now that a source has no type.
 *
 * The documentation index, not a page. This used to pick one: web went to the
 * script tag, desktop to Tauri, server to Node. It could only do that because a
 * source carried a surface, and it was already the weakest thing that value
 * bought -- a customer whose "web" source was a Chrome extension, or whose
 * "other" source was a Rust daemon, was sent to the wrong snippet with total
 * confidence.
 *
 * We do not know what a source is any more, and that is the honest position: it
 * is whatever the customer points at the key. So the reader picks their own
 * client from the index, arriving with their source already selected, and every
 * snippet on whichever page they choose carries their real key.
 *
 * TWO LINKS, NOT ONE. The second goes straight to the HTTP API, because the
 * reader who does not want a dependency is exactly the reader who will not find
 * that page by browsing a list of SDKs, and it is the one page that answers
 * "how do I send this myself" outright.
 *
 * A row of links and a heading, and nothing else. It carried a paragraph of
 * summary and a footnote under the button, both of which explained what the
 * button plainly does, on a page whose subject is a source and not its
 * documentation.
 */

export function InstallGuideLink(props: {
  /** Preselected in the documentation, so every snippet arrives carrying this key. */
  sourceId: string;
  class?: string;
}) {
  const i18n = useI18n();

  return (
    // An application surface, so radius 6 and the shadow ring rather than the
    // 8px marketing radius over a real border. `styles.css` states the contract:
    // an element carrying one of the shadow-ring values does not also carry a
    // border, or the two hairlines double up.
    <div class={cn("rounded-md bg-muted/20 p-4 shadow-2xs", props.class)}>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="flex items-center gap-2 text-body font-medium">
          <BookOpen class="size-4 text-muted-foreground" />
          {i18n.t("sources.install_title")}
        </span>

        {/*
          The id travels in the query string on both, so a link survives being
          pasted to a colleague: the documentation reads it on arrival and
          remembers it from there. Nothing is written to storage here -- a click
          that never becomes a navigation should not change what the
          documentation shows next time.
        */}
        <Link
          to="/docs"
          search={{ source: props.sourceId }}
          class={cn(buttonVariants({ size: "sm" }), "ml-auto")}
        >
          {i18n.t("sources.open_guide")}
          <ArrowRight class="size-4" />
        </Link>

        <Link
          to="/docs/$topic"
          params={{ topic: "http-api" }}
          search={{ source: props.sourceId }}
          class={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {i18n.t("sources.open_api")}
        </Link>
      </div>
    </div>
  );
}
