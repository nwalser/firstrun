import { For, Show, onCleanup, onMount, type JSX } from "solid-js";
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
 * A label that is always as wide as the widest label it could hold.
 *
 * For a control whose text IS its value: the window chip, the group-by
 * dropdown, anything whose caption changes when you use it. Without this, every
 * such control resizes as you operate it and shoves whatever sits after it
 * along the row, so the toolbar twitches under the pointer and the thing you
 * were about to click has moved. A filter chip APPEARING is a real change in
 * the toolbar and should move things; the same chip merely saying something
 * else is not.
 *
 * Every option is rendered into the same grid cell, all but one of them
 * `invisible` -- hidden, but still taking part in layout, which `hidden` would
 * not. The cell is therefore as wide as the longest option and the visible
 * label sits on top of the others.
 *
 * Measured rather than declared, which is the point: this app runs in German as
 * well as English, and German is reliably the longer of the two. Any
 * hand-written `min-w-*` would be right in one language and wrong in the other,
 * and would be wrong again in the next language somebody adds.
 */
export function SteadyLabel(props: { options: readonly string[]; children: JSX.Element }) {
  return (
    <span class="grid">
      <For each={props.options}>
        {(option) => (
          <span class="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
            {option}
          </span>
        )}
      </For>
      <span class="col-start-1 row-start-1 whitespace-nowrap">{props.children}</span>
    </span>
  );
}

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

      {/*
        A scroller, not a wrapper.

        The reference's filter row is a fixed 32px band, and `flex-wrap` inside a
        fixed height is a contradiction: the second line has nowhere to go, so at
        a narrow pane the last chip rendered 40px down, outside its own container
        and on top of the first card. It only showed up below about 400px, which
        is why it survived this long.

        Chips do not shrink either. A chip squeezed to half its text is not a
        smaller chip, it is an unreadable one, so the row scrolls sideways and
        every chip keeps the width its own words need.
      */}
      <div
        class={[
          "flex h-8 items-center gap-2 overflow-x-auto overflow-y-hidden empty:hidden",
          "[&>*]:shrink-0",
          // The row is 32px tall. A scrollbar inside it would eat a third of the
          // chips, and the row is swipeable on the devices that lack one.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        ].join(" ")}
      >
        {props.filters}
      </div>
    </div>
  );
}
