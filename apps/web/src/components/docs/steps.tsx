import { Show, createContext, useContext, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";
import { Badge } from "../ui/index.js";

/**
 * A numbered procedure with a spine down the side.
 *
 * The numbers are assigned here rather than written by the page, because a
 * hand-numbered list is a list somebody renumbers wrong the first time a step
 * is inserted in the middle.
 *
 * **Each step builds its own row.** `Steps` is a container and a counter and
 * nothing else. The obvious alternative -- resolve the children with Solid's
 * `children()` helper and wrap each one in a numbered row -- renders correctly
 * on the server and then breaks on arrival in the browser, because it inverts
 * the order the DOM is built in. The server writes row, then step content; the
 * helper forces every step's content into existence *before* the first row
 * exists, so hydration claims the server's nodes in the wrong order, and what
 * the reader gets is a second copy of the procedure with the first two steps
 * emptied out. Nothing in the console says so. Do not reintroduce `children()`
 * here: a component that wraps its children in markup cannot resolve them
 * first.
 *
 * A list by role rather than by tag on purpose: a page's prose styling reaches
 * its descendants by element selector, and a real `<ol>` here would come out
 * decimal-marked and indented a second time by rules meant for ordinary lists.
 */

/**
 * Hands each step its number.
 *
 * A counter rather than an index because `Steps` no longer holds the children
 * as an array. Steps are created in document order -- on the server and in the
 * browser alike -- so counting them as they are created gives the same numbers
 * in both places, which is the property hydration needs.
 */
const StepNumber = createContext<() => number>();

export function Steps(props: { children: JSX.Element; class?: string }) {
  let count = 0;
  const next = () => ++count;

  return (
    <div role="list" class={cn("flex flex-col", props.class)}>
      <StepNumber.Provider value={next}>{props.children}</StepNumber.Provider>
    </div>
  );
}

/**
 * One step: a title, and a body that can be anything.
 *
 * The body is a column with its own spacing so a step reads the same whether it
 * holds one sentence, a paragraph and a snippet, or a warning -- a page should
 * not have to think about the gap between a note and the code under it.
 */
export function Step(props: { title: string; children: JSX.Element; optional?: boolean }) {
  const i18n = useI18n();
  const next = useContext(StepNumber);
  // Read once, as the step is created. A step outside a `<Steps>` still renders;
  // it simply has no number to show.
  const number = next?.();

  return (
    <div
      role="listitem"
      // The marker column is the 28px chip size, named rather than spelled: it
      // is the same token the marker itself is sized with, so the two cannot
      // drift apart.
      class="group relative grid grid-cols-[var(--control-xs)_minmax(0,1fr)] gap-x-3.5 pb-7 last:pb-0"
    >
      {/*
        The spine. Drawn from under the marker to the bottom of the row, which
        is exactly the gap before the next marker -- so it reads as one line
        rather than a dash beside each step. The last row has no gap under it
        and no next marker to reach, so it has no spine.
      */}
      <span
        aria-hidden="true"
        class="absolute top-8 bottom-0 left-[0.875rem] w-px -translate-x-1/2 bg-border group-last:hidden"
      />

      {/* Not hidden from assistive tech: with a role-list the number is the only
          thing that says which step this is.

          The edge is the hairline ring, drawn as a box-shadow, not a border: it
          is outside the box, so the marker stays exactly 28px and lines up with
          the spine under it either way. Never pair the two. */}
      <span class="ring-hairline relative z-10 flex size-control-xs items-center justify-center rounded-full bg-card text-body font-semibold tabular-nums">
        {number}
      </span>

      <div class="min-w-0">
        <div class="flex min-h-7 flex-wrap items-center gap-2">
          <h3 class="text-h3">{props.title}</h3>
          <Show when={props.optional}>
            <Badge variant="outline">{i18n.t("docs.optional")}</Badge>
          </Show>
        </div>
        {/* Body text matches `DocsProse`: a step is prose that happens to be
            numbered, and the reader should not change size OR colour crossing
            into one. Same tokens, for that reason. No measure is set here --
            the column the step sits in is already the measure. */}
        <div class="mt-3 flex flex-col gap-4 text-prose text-foreground">
          {props.children}
        </div>
      </div>
    </div>
  );
}
