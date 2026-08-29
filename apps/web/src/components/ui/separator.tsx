import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export function Separator(
  props: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }
) {
  const [local, rest] = splitProps(props, ["class", "orientation"]);
  return (
    <div
      role="separator"
      class={cn(
        "bg-border shrink-0",
        (local.orientation ?? "horizontal") === "horizontal" ? "h-px w-full" : "h-full w-px",
        local.class
      )}
      {...rest}
    />
  );
}
