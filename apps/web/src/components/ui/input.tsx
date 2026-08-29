import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export function Input(props: ComponentProps<"input">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <input
      class={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow]",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        local.class
      )}
      {...rest}
    />
  );
}

export function Label(props: ComponentProps<"label">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <label
      class={cn("text-sm font-medium leading-none select-none", local.class)}
      {...rest}
    />
  );
}
