import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import { createSignal, Show } from "solid-js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";
import { Button } from "./button.js";

/**
 * A copyable snippet.
 *
 * Every install instruction in this product is something the reader is meant to
 * paste, so the copy button is part of the component rather than a thing each
 * page remembers to add.
 *
 * The block is a quiet fill inside a hairline, and the mono face here is
 * ligature-free with a slashed zero by design: a key or a hash has to render as
 * the characters it is made of, and the reader is going to compare it by eye.
 *
 * ## Two shapes, and `header` is what picks between them
 *
 * Bare, it is a single rounded box: what a settings page wants beside an ingest
 * key. Given a `header` it becomes the documentation block -- a bordered card
 * with a titled bar across the top, the copy button living in that bar rather
 * than floating over the code, and the code itself on the raised surface
 * underneath. A docs reader is scanning a page of these looking for the one
 * that says `next.config.js`, so the label is chrome that earns its 48px; a
 * reader who is copying one key does not need a bar that says "code".
 *
 * `header` is a **string**, deliberately, and not markup. A JSX prop is
 * compiled to a getter that builds its nodes when it is read, so testing one to
 * decide what to render claims the server's DOM out of order and hydration
 * fails somewhere else entirely -- the long version of that story is in
 * `documentation/snippet.tsx`. A string can be read as many times as it likes.
 *
 * ## The code is padded, not the box
 *
 * Horizontal padding sits on the `code` element and the vertical padding on the
 * `pre`, so scrolling a long line to the right does not leave the text jammed
 * against the edge of the box: the padding scrolls with the content, the way it
 * does in an editor.
 *
 * ## Colour arrives as markup, from the caller
 *
 * `highlighted` is HTML, produced by `lib/highlight.ts` during render. It is a
 * prop rather than something this component computes because this component is
 * shared: the documentation uses it, and so do the login page and three settings pages,
 * and a static import of the highlighter here would put 30KB of grammars in a
 * chunk the dashboard loads to show a source key. The documentation's `Snippet` is the
 * only caller that passes it.
 *
 * Setting it as HTML is safe for exactly one reason, stated in full in
 * `lib/highlight.ts`: every snippet in this product is authored in this
 * repository. The moment a snippet could come from a customer, this prop has to
 * go.
 */
export function CodeBlock(props: {
  code: string;
  class?: string;
  /** Advisory. Recorded on the element; nothing here parses it. */
  language?: string;
  /** Pre-highlighted markup for `code`. Plain text is rendered without it. */
  highlighted?: string;
  /**
   * A filename, or what to call this block. Plain text only.
   *
   * Its presence is what switches the component into the documentation shape,
   * so passing an empty string is the same as passing nothing.
   */
  header?: string;
}) {
  const i18n = useI18n();
  const [copied, setCopied] = createSignal(false);
  const titled = () => !!props.header;

  async function copy() {
    try {
      // `props.code`, deliberately: not the highlighted markup, and not the
      // rendered text read back out of the DOM. The reader has to get the bytes
      // the page was written with, and a snippet that pastes with spans in it,
      // or with a soft-wrapped line rejoined, is the classic way highlighting
      // breaks a docs page.
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the snippet is on screen regardless.
    }
  }

  const copyButton = (floating: boolean) => (
    <Button
      variant={floating ? "outline" : "ghost"}
      size="icon-sm"
      aria-label={i18n.t("ui.copy_to_clipboard")}
      class={cn(
        // Floating over the code, it is invisible until the reader is actually
        // in the block, and always visible to a keyboard: an affordance nobody
        // can tab to is not one. In a header bar it is simply always there,
        // because the bar is already drawn and nothing is being covered up.
        floating
          ? "absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          : "text-muted-foreground hover:text-foreground size-control-sm shrink-0"
      )}
      onClick={copy}
    >
      <Show when={copied()} fallback={<Copy class="size-3.5" />}>
        <Check class="size-3.5 text-positive" />
      </Show>
    </Button>
  );

  return (
    <div
      class={cn(
        "group relative",
        // The documentation shape is one bordered object with a divided head,
        // so the border lives out here and the boxes inside it draw none: two
        // adjacent 1px edges is the seam that made the old filename bar look
        // like two stacked cards.
        titled() && "overflow-hidden rounded-md border border-border",
        props.class
      )}
    >
      <Show when={props.header}>
        <div class="border-border bg-background flex h-12 items-center gap-2 border-b pr-2 pl-4">
          <span class="text-muted-foreground min-w-0 flex-1 truncate text-[0.8125rem] leading-4">
            {props.header}
          </span>
          {copyButton(false)}
        </div>
      </Show>

      {/*
        Bare, the fill is `muted` at 40% -- the surface the five syntax colours
        were measured against -- and the edge is the ring rather than a border,
        because a border there inset the snippet by a pixel and doubled up
        against anything the caller wrapped it in. Inside the titled card the
        fill is the raised surface and there is no edge at all: the card around
        it already has one.
      */}
      <pre
        class={cn(
          "font-mono text-code text-foreground overflow-x-auto",
          titled()
            ? "bg-card py-5 [&>code]:block [&>code]:px-5"
            : "bg-muted/40 rounded-md p-3 shadow-2xs"
        )}
      >
        <Show
          when={props.highlighted}
          fallback={
            <code class="hljs" data-language={props.language}>
              {props.code}
            </code>
          }
        >
          {(markup) => <code class="hljs" data-language={props.language} innerHTML={markup()} />}
        </Show>
      </pre>

      <Show when={!titled()}>{copyButton(true)}</Show>
    </div>
  );
}
