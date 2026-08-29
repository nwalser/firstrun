import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/** A tooltip that also opens on keyboard focus, which is the whole reason to use the primitive. */
export function Tooltip(props: {
  label: string;
  placement?: "top" | "right" | "bottom" | "left";
  children: JSX.Element;
  disabled?: boolean;
}) {
  return (
    <KTooltip placement={props.placement ?? "right"} openDelay={400} disabled={props.disabled}>
      <KTooltip.Trigger as="span" class="contents">
        {props.children}
      </KTooltip.Trigger>
      <KTooltip.Portal>
        <KTooltip.Content
          class={cn(
            "z-50 w-fit rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md",
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95"
          )}
        >
          {props.label}
          <KTooltip.Arrow />
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}

export const TooltipRoot = KTooltip;

export function TooltipContent(props: ComponentProps<typeof KTooltip.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTooltip.Content
      class={cn("z-50 w-fit rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground", local.class)}
      {...rest}
    />
  );
}
