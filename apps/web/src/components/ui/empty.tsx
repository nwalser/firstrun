import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The empty state.
 *
 * One component so that "there is nothing here yet" looks the same everywhere,
 * instead of four call sites each inventing their own box.
 *
 * The geometry is the reference's page empty state: full content width, 6px
 * radius, one hairline, 32px of padding above and below and 16 at the sides,
 * everything centred on both axes, and 24px between the text block and the
 * actions under it. Inside the text block a 60px tile sits 12px above a
 * 20/600 title, which sits 8px above a 14/400 line that stops at about 474px so
 * it stays two or three readable lines rather than one wide one.
 *
 * A page gets this. A POPOVER gets one line of muted text and no tile at all,
 * which is a different and much lighter thing: do not reach for this inside one.
 *
 * The parts own their own spacing rather than the container owning a `gap`,
 * because the API is flat -- a call site writes media, title, description and
 * actions as siblings, and any of the four may be missing.
 *
 * The edge is a real border rather than the box-shadow ring every other surface
 * uses. It carries no shadow, so nothing doubles.
 */
export function Empty(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex min-w-0 flex-col items-center justify-center",
        "rounded-md border border-border px-4 py-8 text-center",
        local.class
      )}
      {...rest}
    />
  );
}

/** The 60px tile. 12px above the title, and a 24px glyph inside it. */
export function EmptyMedia(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "mb-3 flex size-15 items-center justify-center rounded-xl",
        "bg-muted text-muted-foreground [&_svg]:size-6",
        local.class
      )}
      {...rest}
    />
  );
}

export function EmptyTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("text-h3 text-foreground", local.class)} {...rest} />;
}

export function EmptyDescription(props: ComponentProps<"p">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <p
      class={cn("mt-2 max-w-[474px] text-body text-muted-foreground", local.class)}
      {...rest}
    />
  );
}

/**
 * What to do about it.
 *
 * 24px below the text, and capped at the reference's 820px options column: the
 * actions are a block of their own, not a third line of the paragraph.
 */
export function EmptyContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("mt-6 flex w-full max-w-[820px] items-center justify-center gap-3", local.class)}
      {...rest}
    />
  );
}
