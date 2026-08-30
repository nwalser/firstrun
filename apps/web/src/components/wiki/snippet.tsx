import Info from "lucide-solid/icons/info";
import OctagonAlert from "lucide-solid/icons/octagon-alert";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Show, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { highlight } from "../../lib/highlight.js";
import { useI18n, type SimpleKey } from "../../lib/i18n/index.js";
import { Alert, AlertDescription, AlertTitle, CodeBlock } from "../ui/index.js";

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
 * `fr_web_xxxxxxxxxxxxxxxx` is a fact about the whole page rather than about
 * this block, and repeating it under eight code blocks on one guide turned the
 * warning into wallpaper. The wiki says it once, in the header beside the
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
 * Three weights, and they mean different things on purpose:
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
 * ## Three signals, not one
 *
 * Colour is the last of them. Each weight carries its own icon shape (round,
 * triangular, octagonal) and always shows a title, so the ladder survives
 * greyscale, a colour-blind reader, and a printed page. That is also why the
 * title falls back to a default rather than being omitted: a bare tinted box
 * says only "aside".
 */

type CalloutVariant = "note" | "warning" | "caution";

/**
 * The default title of each weight, as a key rather than as a word.
 *
 * A record of literal keys, not of translated strings: a `t(...)` evaluated
 * beside `CALLOUT_WEIGHTS` at module scope would be computed once, in whichever
 * language happened to be active when this module was first loaded, and would
 * stay in it after somebody switched. The lookup happens inside `Callout`.
 */
const CALLOUT_TITLE_KEYS: Record<CalloutVariant, SimpleKey> = {
  note: "wiki.callout_note",
  warning: "wiki.callout_warning",
  caution: "wiki.callout_caution",
};

/**
 * Each weight's own surface and mark colour.
 *
 * Not the `Alert` variants: those tint the whole box, body text included, which
 * is what makes them read as loud at any size. Here the wash stays pale, the
 * left rule and the icon carry the weight, and the body is ordinary prose
 * colour so the box is a box and not a highlighter stroke.
 *
 * The middle weight names the theme's warning token rather than reaching for a
 * palette step directly. That token already resolves to the right amber for
 * whichever theme is in play, and naming it is what keeps a callout and a
 * warning number the same colour without either one pinning down which amber
 * that is.
 */
const CALLOUT_WEIGHTS: Record<
  CalloutVariant,
  { box: string; mark: string; title: string }
> = {
  note: {
    // The rule is drawn in the muted text colour rather than the border token,
    // which on a dark ground is faint enough that the box just looks bordered.
    box: "border-border/70 border-l-2 border-l-muted-foreground/40 bg-muted/40",
    mark: "text-muted-foreground",
    title: "text-foreground",
  },
  warning: {
    box: "border-warning/30 border-l-2 border-l-warning/80 bg-warning/10",
    mark: "text-warning",
    title: "text-foreground",
  },
  caution: {
    // Two red tokens, on purpose. `destructive` is the FILL -- the rule down
    // the side and the wash behind the box. `negative` is the readable step,
    // and it is what red TEXT and a red icon take; `destructive` under a body
    // size is the one that goes muddy on a dark ground.
    // Two weights of rule in this file and no third: the left edge is the same
    // 2px here as it is on the two quieter weights, and the colour is what
    // separates them.
    box: "border-destructive/40 border-l-2 border-l-destructive bg-destructive/10",
    mark: "text-negative",
    title: "text-negative",
  },
};

export function Callout(props: {
  variant?: CalloutVariant;
  title?: string;
  children: JSX.Element;
  class?: string;
}) {
  const i18n = useI18n();
  const variant = () => props.variant ?? "note";
  const weight = () => CALLOUT_WEIGHTS[variant()];
  // Safe to default, unlike `note` above: this prop is a string rather than
  // markup, so reading it builds no nodes and cannot claim the server's out of
  // order.
  const title = () => props.title ?? i18n.t(CALLOUT_TITLE_KEYS[variant()]);

  return (
    <Alert
      variant="default"
      // No margin of its own: a callout inside `WikiProse` is a block in the
      // page's flow and takes the page's rhythm, and 6px was on no ladder the
      // wiki uses.
      class={cn("text-prose text-foreground", weight().box, props.class)}
    >
      <Show when={variant() === "note"}>
        <Info class={weight().mark} />
      </Show>
      <Show when={variant() === "warning"}>
        <TriangleAlert class={weight().mark} />
      </Show>
      <Show when={variant() === "caution"}>
        <OctagonAlert class={weight().mark} />
      </Show>
      <AlertTitle class={cn("font-semibold", weight().title)}>{title()}</AlertTitle>
      <AlertDescription class="text-prose text-muted-foreground">
        {props.children}
      </AlertDescription>
    </Alert>
  );
}
