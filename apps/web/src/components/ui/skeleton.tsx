import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The muted fill, not the accent one: accent is the hover step and a page full
 * of skeletons in it reads as a page where everything is hovered.
 */
export function Skeleton(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("animate-pulse rounded-md bg-muted", local.class)} {...rest} />;
}
