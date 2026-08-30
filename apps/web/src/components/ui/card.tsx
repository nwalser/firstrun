import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The card.
 *
 * The raised surface, at 6px, separated by a 1px ring drawn as a box-shadow.
 * This is `material-small` in the reference: the ring AND the 1px lift under
 * it, which is `--shadow-sm` here. The ring on its own (`--shadow-2xs`) is for
 * something that is a boundary rather than a surface, a table container being
 * the case in point.
 *
 * The ring is the whole separation mechanism. The fill barely differs from the
 * page in either theme: 2% in light, 4% in dark against a page that is pure
 * black. In dark this will look far flatter than a card usually does, and that
 * is the measured value, not an omission. Because the ring is a shadow it takes
 * no part in layout, so it must never be paired with a border: two hairlines
 * and a one-pixel shift.
 */
export function Card(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "bg-card text-card-foreground flex flex-col rounded-md shadow-sm",
        local.class
      )}
      {...rest}
    />
  );
}

export function CardHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex items-start justify-between gap-2 px-4 pt-4 pb-3",
        local.class
      )}
      {...rest}
    />
  );
}

/**
 * A title, not a legend.
 *
 * Sentence case at the application chrome size, semibold, in the full
 * foreground colour. 14px is the Geist UI step; the tracked-out uppercase
 * micro-label this used to be reads as a caption for the card rather than as
 * the name of the thing, and 12px reads as a footnote next to it.
 */
export function CardTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("text-body font-semibold text-foreground", local.class)}
      {...rest}
    />
  );
}

export function CardDescription(props: ComponentProps<"p">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <p class={cn("text-body text-muted-foreground", local.class)} {...rest} />
  );
}

export function CardContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("px-4 pb-4", local.class)} {...rest} />;
}

export function CardFooter(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class={cn("flex items-center gap-2 px-4 pb-4", local.class)} {...rest} />
  );
}
