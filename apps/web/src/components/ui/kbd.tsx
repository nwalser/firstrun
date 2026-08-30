import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A keyboard key.
 *
 * Mono, small, and ringed: a key is a technical token like an id or a hash, so
 * it belongs to the mono face, and the mono face carries the slashed zero and
 * the tabular figures that make one legible. The edge is the 1px ring drawn as
 * a box-shadow, the same hairline every other surface uses, so there is no
 * border on it. Four-pixel radius, because at this size it is a small control
 * rather than a surface.
 */
export function Kbd(props: ComponentProps<"kbd">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <kbd
      class={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1",
        "rounded-sm bg-muted px-1.5 shadow-xs",
        "font-mono text-mono font-medium text-muted-foreground select-none",
        local.class
      )}
      {...rest}
    />
  );
}
