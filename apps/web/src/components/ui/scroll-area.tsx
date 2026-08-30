import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A scroll container with a restrained scrollbar.
 *
 * Hand-rolled: Radix's ScrollArea has no Kobalte port, and its value is a
 * custom-rendered scrollbar for browsers that cannot style the native one.
 * Every browser this ships to supports `scrollbar-width` and `scrollbar-color`,
 * so the native scrollbar is styled instead of replaced -- which also keeps
 * momentum scrolling, keyboard scrolling and accessibility working for free.
 */
export function ScrollArea(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "overflow-y-auto overscroll-contain",
        "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
        local.class
      )}
      {...rest}
    />
  );
}
