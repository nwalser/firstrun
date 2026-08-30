import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The single-line field.
 *
 * 36px tall, 14px/20px, 6px radius: the middle Geist form height, and 6 rather
 * than 4 because an input is one of the surfaces (with cards, popovers and
 * popover rows) rather than one of the small controls.
 *
 * The fill is the raised surface, not transparency. Geist draws a field at
 * `background-100` -- white on light, #0a0a0a on dark -- so a field sitting on
 * the page lifts very slightly out of it and a field sitting on a card is flat
 * against it. Either way the 1px ring is what actually bounds the control, and
 * that ring is a box-shadow, so it never takes part in layout and there is no
 * border here to double it with.
 *
 * The placeholder is the secondary text step and not a whisper: it is the only
 * thing in an empty field, and an unreadable placeholder is an unlabelled one.
 *
 * Disabled is a filled field, not a faded one. Dimming alone stops reading as
 * "disabled" once the text tokens have real contrast -- at that point a
 * half-opacity field looks like an ordinary field in a quiet corner. Filling it
 * with the muted surface and taking the text down to the secondary tone says it
 * twice.
 */
export function Input(props: ComponentProps<"input">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <input
      class={cn(
        "flex h-control-md w-full min-w-0 rounded-md bg-card px-3 shadow-xs",
        "text-control-md text-foreground transition-[color,background-color,box-shadow]",
        "outline-none placeholder:text-muted-foreground",
        "focus-visible:shadow-focus",
        // The invalid ring composes in front of the hairline rather than
        // replacing it, so the control keeps its edge while it is wrong.
        "aria-invalid:ring-1 aria-invalid:ring-destructive",
        "disabled:cursor-not-allowed disabled:bg-muted",
        "disabled:text-muted-foreground disabled:placeholder:text-muted-foreground/70",
        // A file input draws its own button; without this the browser's default
        // sits at its own font size in the middle of a 36px control.
        "file:mr-3 file:h-full file:border-0 file:bg-transparent file:text-control-sm",
        local.class
      )}
      {...rest}
    />
  );
}

/** 14px medium, tight leading so it sits flush above the control it names. */
export function Label(props: ComponentProps<"label">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <label
      class={cn("text-body leading-none font-medium select-none", local.class)}
      {...rest}
    />
  );
}
