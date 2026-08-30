import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The multi-line input, on input.tsx's rules: same surface, same 1px ring, same
 * two-stop focus, same disabled treatment. The two are meant to be
 * indistinguishable apart from the height, so a change to one belongs in both.
 *
 * `autoResize` is CSS rather than JavaScript. `field-sizing: content` lets the
 * browser grow the box with the text and `maxRows` caps it with a `max-height`
 * in `lh` units, so the height settles in the same layout pass that drew the
 * character. The usual implementation -- set the height to `auto`, read
 * `scrollHeight`, write it back, on every `input` event -- forces a synchronous
 * reflow per keystroke, on the element being typed into. Browsers without
 * `field-sizing` get a fixed-height box that scrolls, which is what a textarea
 * has always done.
 */

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Grow with the content instead of scrolling. */
  autoResize?: boolean;
  /** Ceiling for `autoResize`, in lines. Default 8. */
  maxRows?: number;
}

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["class", "autoResize", "maxRows"]);
  return (
    <textarea
      class={cn(
        "flex min-h-16 w-full min-w-0 rounded-md bg-card px-3 py-2 shadow-xs",
        "text-control-md text-foreground transition-[color,background-color,box-shadow]",
        "outline-none placeholder:text-muted-foreground",
        "focus-visible:shadow-focus",
        "aria-invalid:ring-1 aria-invalid:ring-destructive",
        "disabled:cursor-not-allowed disabled:bg-muted",
        "disabled:text-muted-foreground disabled:placeholder:text-muted-foreground/70",
        local.autoResize && "field-sizing-content resize-none overflow-y-auto",
        local.class
      )}
      // `py-2` top and bottom, so the cap lands on a whole number of lines
      // rather than a line and a sliver of the next one. The ring is a shadow
      // and adds nothing to the box, so there is no border to allow for.
      style={
        local.autoResize
          ? { "max-height": `calc(${local.maxRows ?? 8} * 1lh + 1rem)` }
          : undefined
      }
      {...rest}
    />
  );
}
