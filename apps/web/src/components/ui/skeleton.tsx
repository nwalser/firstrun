import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export function Skeleton(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("animate-pulse rounded-md bg-accent", local.class)} {...rest} />;
}
