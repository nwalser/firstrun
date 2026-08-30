import { Show, onCleanup, onMount, type JSX } from "solid-js";
import { Badge } from "./ui/index.js";

/**
 * What a clickable row or tile does when you touch it, decided once.
 *
 * Every list in the product used to spell its own: the project list faded to
 * the accent fill, the documentation's topic list faded to half of it, the boards card
 * did nothing at all, and none of them drew a focus ring, so a keyboard reader
 * got whatever the browser felt like. Four lists, four answers to the same
 * question.
 *
 * The three parts, and why each is the one it is:
 *
 *   - `transition-colors`, which is the row convention (the sidebar rows, the
 *     tabs and the table rows already use it) rather than the control
 *     convention in `ui/button.tsx`. A control transitions its box-shadow too,
 *     because its ring is part of its resting look. A row's box-shadow is only
 *     ever the FOCUS ring, and a focus ring that fades in is a focus ring that
 *     arrives after the keypress.
 *   - `hover:bg-accent`, the accent step at full strength. It is
 *     `gray-alpha-200`, so it composites over whatever the row sits on and a
 *     divided card list does not need a second fill for its hairlines.
 *   - `focus-ring`, the two-stop blue from `styles.css`. It replaces the
 *     outline rather than sitting beside it, which is why `outline-none` is
 *     part of the same string and not something a call site has to remember.
 *
 * This lives here, next to the heading block, because this file is already the
 * one place a page's shared furniture is decided instead of re-guessed per
 * route. It belongs on something a reader can actually activate: a row that is
 * only a container for its own buttons must NOT take it, or the whole row
 * lights up for a target that is 32px wide.
 */
export const ROW_INTERACTION = "outline-none transition-colors hover:bg-accent focus-ring";

/**
 * Tell the chrome whether this page's own heading is on screen.
 *
 * The topbar breadcrumb shows its icon and slash only once the `h1` has
 * scrolled away, so that a page does not state its title twice at rest. An
 * attribute on the document element rather than a context, because the two ends
 * of this live in different subtrees and a context would make every page that
 * wants a heading depend on being inside the shell. The rule that reads it is
 * in `styles.css`.
 */
function trackTitleVisibility(heading: HTMLElement) {
  const root = document.documentElement;
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) root.dataset.routeTitleVisible = "";
      else delete root.dataset.routeTitleVisible;
    },
    // Zero threshold against the shell's scroll container's own root: the
    // heading counts as visible until the last pixel of it has gone.
    { threshold: 0 }
  );
  observer.observe(heading);
  onCleanup(() => {
    observer.disconnect();
    delete root.dataset.routeTitleVisible;
  });
}

/**
 * The heading block every page shares, so vertical rhythm is decided once
 * rather than re-guessed per route.
 *
 * The geometry is the reference's list-page heading: a 32px title row carrying
 * the `h1` and the right-aligned actions, then a 32px filter row, in a `gap-4`
 * column with 16px of padding above and below. The title steps to 24/600 at
 * -0.04em, which is `text-heading-24` in their vocabulary and `--text-h2` in
 * ours: the same measured value, already carrying its weight and tracking, so
 * no `font-semibold` or `tracking-*` utility belongs beside it.
 */
export function PageHeader(props: {
  title: string;
  /** Prose, so a page can emphasise the half of a sentence that matters. */
  description?: JSX.Element;
  badge?: string;
  actions?: JSX.Element;
  /** The filter row. Chips at 32px, `Add filter` first. */
  filters?: JSX.Element;
}) {
  let heading: HTMLHeadingElement | undefined;
  onMount(() => {
    if (heading) trackTitleVisibility(heading);
  });

  return (
    <div class="flex flex-none flex-col gap-4 pt-4 pb-4">
      <div class="flex flex-col gap-1">
        <div class="flex h-8 items-center justify-between gap-4 leading-8">
          <div class="flex min-w-0 items-center gap-2">
            <h1 ref={heading} class="truncate text-h2">
              {props.title}
            </h1>
            <Show when={props.badge}>{(badge) => <Badge variant="outline">{badge()}</Badge>}</Show>
          </div>
          {/*
            Always in the markup, empty when there is nothing to put in it, and
            out of the layout when it is empty. Same rule as `description` and
            `filters` below.

            `when={props.actions}` would read the prop to test it, and reading a
            markup prop BUILDS its nodes -- before the row meant to contain them
            exists. During hydration that claims the server's nodes out of order
            and Solid throws a hydration mismatch whose own error path cannot
            print itself: the console says `template2 is not a function` and the
            page renders twice. Reading it again to render it builds a second
            copy. Same rule as `components/docs/snippet.tsx`.
          */}
          <div class="flex shrink-0 items-center gap-2 empty:hidden">{props.actions}</div>
        </div>

        <p class="max-w-2xl text-body text-muted-foreground empty:hidden">{props.description}</p>
      </div>

      <div class="flex h-8 flex-wrap items-center gap-2 empty:hidden">{props.filters}</div>
    </div>
  );
}
