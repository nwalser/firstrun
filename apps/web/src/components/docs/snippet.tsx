import Info from "lucide-solid/icons/info";
import OctagonAlert from "lucide-solid/icons/octagon-alert";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Show, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { highlight } from "../../lib/highlight.js";
import { CodeBlock } from "../ui/index.js";

/**
 * The language names a block is titled with when the page gave it no filename.
 *
 * Every documentation block gets a bar, and a bar with nothing in it is worse
 * than no bar -- so a snippet that did not say where its code goes is titled
 * with what the code *is*. `bash` reads "Terminal" rather than "Bash" because
 * the reader is not being shown a shell script, they are being told to type
 * something into a terminal.
 *
 * A language with no entry falls through to no title, and the block renders in
 * its bare shape. That is the honest answer for a snippet that is neither a
 * file nor a command.
 */
const LANGUAGE_TITLES: Record<string, string> = {
  bash: "Terminal",
  sh: "Terminal",
  shell: "Terminal",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  json: "JSON",
  html: "HTML",
  csharp: "C#",
  rust: "Rust",
  python: "Python",
  go: "Go",
  toml: "TOML",
  svelte: "Svelte",
  astro: "Astro",
};

/**
 * Something the reader is meant to paste.
 *
 * Wraps `CodeBlock`, which draws the whole documentation block: a bordered card
 * with a titled bar across the top and the copy button in it. This adds the one
 * thing a guide needs on top of that -- the title itself, because "add this to
 * your root layout" is only half an instruction, and a note underneath for why
 * the code is the way it is.
 *
 * It says nothing about placeholders. A snippet that still holds
 * `fr_xxxxxxxxxxxxxxxx` is a fact about the whole page rather than about
 * this block, and repeating it under eight code blocks on one guide turned the
 * warning into wallpaper. The documentation says it once, in the header beside the
 * source picker that fixes it -- see `source-picker.tsx`.
 *
 * ## `note` is read exactly once, and only from inside its paragraph
 *
 * A JSX prop is compiled to a getter, and for a prop holding markup that getter
 * *builds the nodes* -- during hydration it claims the server's nodes, in order,
 * as it goes. So the order the props are read in is the order the DOM is
 * claimed in, and it has to match the order the server wrote.
 *
 * `<Show when={props.note}>` reads it to test it, which builds the note's nodes
 * before the paragraph that is supposed to contain them exists. The server
 * wrote paragraph-then-contents; the browser claims contents-then-paragraph;
 * the paragraph's node is gone by the time it asks for it, and Solid throws a
 * hydration mismatch. The mismatch never says so, because Solid's own error
 * message calls the missing template to print it and gets `undefined` -- what
 * reaches the console is `template2 is not a function`, and what reaches the
 * reader is half the page rendered a second time.
 *
 * So the paragraph is always in the markup and reads the note into itself,
 * hiding when there is nothing in it. Do not put the note behind a `Show`, and
 * do not read `props.note` twice: the second read builds a second copy.
 */
export function Snippet(props: {
  /** What this snippet is for. Rendered above the code, above the filename. */
  title?: string;
  /**
   * The language to colour the code as: a name or alias `lib/highlight.ts`
   * registers (`bash`, `ts`, `tsx`, `js`, `csharp`, `rust`, `python`, `go`,
   * `html`, `toml`, `svelte`, `astro`). Anything else renders plain.
   */
  lang?: string;
  code: string;
  /** Where the code goes, e.g. `app/layout.tsx`. Shown as a header on the block. */
  filename?: string;
  /** Why it is like that. Prose, so a page can emphasise the half that matters. */
  note?: JSX.Element;
  class?: string;
}) {
  /**
   * What the bar says: the filename if the page gave one, the language if not.
   *
   * A string the whole way, which is what makes it safe to read more than once
   * -- and `CodeBlock` reads it both to decide its shape and to draw it.
   */
  const title = () => props.filename?.trim() || (props.lang && LANGUAGE_TITLES[props.lang]) || "";

  return (
    <div class={cn("min-w-0", props.class)}>
      <Show when={props.title}>
        {(heading) => <div class="mb-2 text-body font-medium text-foreground">{heading()}</div>}
      </Show>

      {/*
        Nothing about the type here: the block already draws the code step,
        which is one below the 16px prose around it and is where a mono face
        reads level with a sans rather than shouting over it.

        Highlighted here rather than inside the block, and read inside JSX so
        it re-runs when a substituted key changes. This is the only place in
        the app that pulls the highlighter in, which is what keeps it out of
        every dashboard chunk. An unrecognised `lang`, or none, comes back as
        escaped plain code rather than an error.
      */}
      <CodeBlock
        code={props.code}
        language={props.lang}
        header={title()}
        highlighted={highlight(props.code, props.lang)}
      />

      {/* Always present, empty when there is no note. See the note above. */}
      <p class="mt-3 text-body text-muted-foreground empty:hidden">{props.note}</p>
    </div>
  );
}

/**
 * An aside that is not part of the flow of the page.
 *
 * One hairline box, no fill, 14px of muted text with a glyph beside it. That is
 * the measured documentation note, and it is deliberately quieter than the
 * tinted, titled, left-ruled panel this used to be: a guide has several of
 * these on a page, and a box that competes with the code block under it is a
 * box the reader learns to jump over.
 *
 * Three weights, and they still mean different things:
 *
 * - `note` is context. Nothing breaks if the reader skips it.
 * - `warning` is a mistake that costs an afternoon, and that the reader will
 *   find out about: something errors, or visibly does the wrong thing.
 * - `caution` is the only red one, and it is reserved for the failures this
 *   product is built around: the ones that are **silent**. The tag posts, the
 *   server answers, nothing reads the answer, and the dashboard stays empty or,
 *   worse, fills with numbers that are wrong and look fine.
 *
 * ## Why red is rationed
 *
 * A page with several red boxes on it has no red box. The reader learns the
 * colour means "an aside" rather than "stop", and then the one that meant stop
 * is the one they skim. So `caution` gets red, and everything below it does
 * not, no matter how much a page would like the emphasis.
 *
 * ## The icon carries the weight, not the fill
 *
 * Colour is the last signal, and with the fills gone it is nearly the only one
 * left -- so each weight keeps its own icon SHAPE (round, triangular,
 * octagonal). That is what survives greyscale, a colour-blind reader and a
 * printed page, and it is why the title is now optional rather than mandatory:
 * the shape says which weight this is without spending a line on the word.
 */

type CalloutVariant = "note" | "warning" | "caution";


/**
 * Each weight's edge and mark colour, and nothing else.
 *
 * No fill and no left rule. Both were how this told its three weights apart
 * before, and both are what made a note read as loud beside the code it was
 * explaining. The border tint and the glyph carry the whole distinction now.
 *
 * The middle weight names the theme's warning token rather than reaching for a
 * palette step directly. That token already resolves to the right amber for
 * whichever theme is in play, and naming it is what keeps a callout and a
 * warning number the same colour without either one pinning down which amber
 * that is.
 */
const CALLOUT_WEIGHTS: Record<CalloutVariant, { box: string; mark: string }> = {
  // The hairline every other surface in this system is edged with. On a note
  // that is the whole decoration: an aside is a paragraph somebody drew a box
  // round, not a highlighted one.
  note: { box: "border-border", mark: "text-muted-foreground" },
  warning: { box: "border-warning/40", mark: "text-warning" },
  // `negative` rather than `destructive`: the fill step goes muddy under a body
  // size on a dark ground, and this is text and a 14px glyph, not a fill.
  caution: { box: "border-destructive/50", mark: "text-negative" },
};

export function Callout(props: {
  variant?: CalloutVariant;
  /**
   * An optional lead-in, in a word or two.
   *
   * Not defaulted, and usually absent. A box that always says "Note" above the
   * note spends a line telling the reader what the border already told them.
   */
  title?: string;
  children: JSX.Element;
  class?: string;
}) {
  const variant = () => props.variant ?? "note";
  const weight = () => CALLOUT_WEIGHTS[variant()];

  return (
    <div
      // No margin of its own: a callout inside `DocsProse` is a block in the
      // page's flow and takes the page's rhythm.
      class={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-1.5",
        weight().box,
        props.class
      )}
    >
      {/*
        A 24px line box so a one-line note is 36px tall and the glyph sits on
        the text's own centre line rather than on the box's, which is what
        keeps it level once the note wraps to three lines.
      */}
      <span class={cn("flex h-6 shrink-0 items-center", weight().mark)}>
        <Show when={variant() === "note"}>
          <Info class="size-3.5" />
        </Show>
        <Show when={variant() === "warning"}>
          <TriangleAlert class="size-3.5" />
        </Show>
        <Show when={variant() === "caution"}>
          <OctagonAlert class="size-3.5" />
        </Show>
      </span>

      <div class="min-w-0 flex-1 text-body leading-6 text-muted-foreground">
        {/* A string, so reading it to test it builds no nodes and cannot claim
            the server's DOM out of order -- unlike `children`, which is read
            exactly once, below, and never behind a `Show`. */}
        <Show when={props.title}>
          {(lead) => <span class="font-medium text-foreground">{lead()}. </span>}
        </Show>
        {props.children}
      </div>
    </div>
  );
}
