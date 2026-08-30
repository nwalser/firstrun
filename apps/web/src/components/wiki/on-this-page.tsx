import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";

/**
 * The contents of the page you are on, down the right-hand side.
 *
 * A guide is a page somebody arrives in the middle of -- from a search result,
 * from a link a colleague sent, from the sidebar -- and the first question is
 * always "what else is on here". The left rail answers which page; this answers
 * what is in it, and highlights where the reader currently is.
 *
 * ## It reads the DOM rather than a table of headings
 *
 * Pages are Solid components, not markdown, so there is no front matter to
 * collect headings from. The alternatives were making every page declare its
 * own outline -- seventeen files that go stale the first time somebody renames
 * a heading and forgets -- or reading the headings that were actually rendered.
 * The rendered page cannot disagree with itself, so that is what this does.
 *
 * Ids are assigned here too, for the same reason: a page writes an ordinary
 * `<h2>`, and this gives it the anchor. Setting an attribute on a node that is
 * already in the document is invisible to hydration; it changes no structure
 * and claims no template.
 *
 * ## Nothing on the server, by construction
 *
 * The list starts empty and fills in `onMount`, which never runs during SSR, so
 * the server's HTML and the browser's first render are identical -- the same
 * discipline `createSelectedSource` follows, and for the same reason. An empty
 * list renders nothing at all rather than an empty heading.
 *
 * A `MutationObserver` re-reads the outline when the page changes underneath
 * it: a different topic, or the same topic re-rendered because the reader
 * picked a different source.
 */

export interface Heading {
  id: string;
  text: string;
  /** 2 or 3. Level 3 is indented under the level 2 above it. */
  level: number;
}

/** `Two ways to do it` -> `two-ways-to-do-it`. */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

/**
 * The headings on the page, in document order, with anchors guaranteed.
 *
 * An id that is already on the element wins: a page that names its own anchor
 * has said something the slug cannot, and the link somebody bookmarked points
 * at that name. Duplicates get a numeric suffix, because two headings called
 * "Notes" would otherwise both scroll to the first one.
 */
function readHeadings(root: HTMLElement): Heading[] {
  const seen = new Set<string>();
  const out: Heading[] = [];

  for (const el of root.querySelectorAll<HTMLElement>("h2, h3")) {
    const text = el.textContent?.trim();
    if (!text) continue;

    let id = el.id;
    if (!id) {
      const base = slugify(text);
      id = base;
      for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
      el.id = id;
    }
    if (seen.has(id)) continue;
    seen.add(id);

    // Enough room under the top of the scroll container that a heading jumped
    // to does not land flush against the edge.
    el.style.scrollMarginTop = "1.5rem";
    out.push({ id, text, level: el.tagName === "H3" ? 3 : 2 });
  }

  return out;
}

export function OnThisPage(props: {
  /** A selector for the element holding the page. Read once, on mount. */
  contentSelector: string;
  /** The element that scrolls. Headings are measured against its top edge. */
  scrollSelector: string;
  class?: string;
}) {
  const i18n = useI18n();
  const [headings, setHeadings] = createSignal<Heading[]>([]);
  const [active, setActive] = createSignal<string | null>(null);

  onMount(() => {
    const root = document.querySelector<HTMLElement>(props.contentSelector);
    const scroller = document.querySelector<HTMLElement>(props.scrollSelector);
    if (!root || !scroller) return;

    /**
     * Which heading the reader is under.
     *
     * The last one whose top has passed a line a little below the top of the
     * scrollport -- not the topmost *visible* one, which flickers between two
     * headings whenever a short section is entirely on screen. Before the first
     * heading reaches that line, the first heading is still the answer: nobody
     * reading the introduction wants an empty rail.
     */
    const mark = () => {
      const list = headings();
      if (list.length === 0) return;
      const line = scroller.getBoundingClientRect().top + 96;
      let current = list[0]!.id;
      for (const heading of list) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= line) current = heading.id;
      }
      setActive(current);
    };

    // Coalesced: a re-render fires many mutations, and the outline only needs
    // reading once at the end of them.
    //
    // A timer rather than an animation frame, deliberately. A frame callback
    // does not run in a tab that is not compositing -- a background tab, or a
    // window nobody is looking at -- so a page opened in the background would
    // finish loading with an empty rail and keep it until the reader came back
    // and moved something. A timeout fires either way.
    let queued: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (queued) return;
      queued = setTimeout(() => {
        queued = null;
        setHeadings(readHeadings(root));
        mark();
      }, 0);
    };

    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    scroller.addEventListener("scroll", mark, { passive: true });

    onCleanup(() => {
      observer.disconnect();
      scroller.removeEventListener("scroll", mark);
      if (queued) clearTimeout(queued);
    });
  });

  return (
    <Show when={headings().length > 0}>
      <nav
        aria-label={i18n.t("wiki.on_this_page")}
        class={cn(
          "sticky top-12 w-60 shrink-0 self-start pt-12 pb-12",
          "[scrollbar-width:thin] max-h-[calc(100dvh-8rem)] overflow-y-auto",
          props.class
        )}
      >
        <p class="text-body text-muted-foreground mb-3">{i18n.t("wiki.on_this_page")}</p>
        <ul class="flex flex-col gap-3">
          <For each={headings()}>
            {(heading) => (
              <li class={cn(heading.level === 3 && "pl-3")}>
                <a
                  href={`#${heading.id}`}
                  class={cn(
                    "focus-ring block rounded-sm text-body transition-colors",
                    active() === heading.id
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={(event) => {
                    // The page does not scroll; a container inside it does, and
                    // the browser's own fragment navigation scrolls the window.
                    // Doing it here is what makes the anchor land in the right
                    // place, and it also keeps the URL free of a fragment that
                    // means nothing on the next page.
                    event.preventDefault();
                    document
                      .getElementById(heading.id)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActive(heading.id);
                  }}
                >
                  {heading.text}
                </a>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </Show>
  );
}
