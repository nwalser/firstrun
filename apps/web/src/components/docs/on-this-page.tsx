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
    /**
     * Wait for the two elements this reads, rather than giving up on them.
     *
     * They are found by selector because the page is rendered by a route and
     * the scroller by the shell, and neither is this component's child. On a
     * plain load both are already in the document -- but not on every load: a
     * hot reload, a resumed navigation, or a route whose loader settles a tick
     * late can all run this before the column exists.
     *
     * This used to `return` in that case, which is permanent: no observer gets
     * attached, so nothing ever brings the rail back and the page simply has no
     * contents until it is reloaded by hand. Retrying costs a handful of
     * timers, and stopping after a second is what keeps a page that genuinely
     * has no column from holding a timer open forever.
     */
    let attempts = 0;
    const start = () => {
      const root = document.querySelector<HTMLElement>(props.contentSelector);
      const scroller = document.querySelector<HTMLElement>(props.scrollSelector);
      if (!root || !scroller) {
        if (attempts++ < 20) setTimeout(start, 50);
        return;
      }
      wire(root, scroller);
    };

    const wire = (root: HTMLElement, scroller: HTMLElement) => {

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
    };

    start();
  });

  return (
    <Show when={headings().length > 0}>
      {/*
        The rail sits 24px below the topbar and stays there. Not 48: the page's
        own title starts 72px down, and a contents that begins level with the
        heading it is a contents OF reads as a second column of the page rather
        than as chrome beside it. Measured, and the margin is what puts it there
        before anything scrolls -- padding would move with the box when it
        sticks and drop the list 24px every time.
      */}
      <nav
        aria-label={i18n.t("docs.on_this_page")}
        class={cn("sticky top-6 mt-6 w-60 shrink-0 self-start", props.class)}
      >
        <h2 class="text-body text-muted-foreground/75 m-0 pb-2 font-normal">
          {i18n.t("docs.on_this_page")}
        </h2>

        {/*
          ## The spine is the whole design

          A hairline runs the full height of the list, and the item you are
          currently under draws a BRIGHT segment over it. That is what makes
          this read as a position in a document rather than as a second menu:
          the rule is the page, the lit part is where you are on it, and it
          moves as you scroll.

          Without it -- which is what this was -- the list is a stack of links
          in two greys, and the only thing saying where you are is a font
          weight, which nobody sees. Every measurement was already right and it
          still looked nothing like the reference, because the reference's
          contents is not a list, it is a scrollbar made of words.

          The rule is drawn on the LIST and the marker on the ITEM, both as
          pseudo-elements at `left: 0`, so they occupy no layout and cannot push
          the text off its 16px indent. The marker is inset 4px top and bottom,
          which is what leaves a visible gap between two adjacent lit rows.
        */}
        <ul
          class={cn(
            "relative m-0 max-h-[65vh] list-none overflow-y-auto p-0",
            "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
            "before:bg-border before:absolute before:top-0 before:bottom-0",
            "before:left-0 before:w-px before:content-['']"
          )}
        >
          <For each={headings()}>
            {(heading) => {
              const current = () => active() === heading.id;
              return (
                <li
                  class={cn(
                    // 32px on a 20px line is 6px of padding either side, and
                    // the row is a flex box so the text centres in it whether
                    // or not it wraps.
                    "relative flex h-8 items-center py-1.5 pr-3 text-body transition-colors",
                    // A level-3 heading is a step inside the section above it,
                    // so it takes a second 16px of indent and nothing else --
                    // no smaller type, no marker, no second rule.
                    heading.level === 3 ? "pl-8" : "pl-4",
                    current() && [
                      "font-medium",
                      "after:bg-foreground after:absolute after:top-1 after:bottom-1",
                      "after:left-0 after:w-px after:content-['']",
                    ]
                  )}
                >
                  {/*
                    The colour sits on the anchor rather than on the row. The
                    row is what carries the geometry and the marker; the anchor
                    is the text, and a text colour set on the box it happens to
                    live in is one inherit away from being lost.
                  */}
                  <a
                    href={`#${heading.id}`}
                    class={cn(
                      "focus-ring block min-w-0 truncate transition-colors",
                      current()
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={(event) => {
                      // The page does not scroll; a container inside it does,
                      // and the browser's own fragment navigation scrolls the
                      // window. Doing it here is what makes the anchor land in
                      // the right place, and it also keeps the URL free of a
                      // fragment that means nothing on the next page.
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
              );
            }}
          </For>
        </ul>
      </nav>
    </Show>
  );
}
