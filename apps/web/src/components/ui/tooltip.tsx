import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A tooltip that also opens on keyboard focus, which is the whole reason to use
 * the primitive.
 *
 * A flat surface, not an inverted one. Geist publishes a tooltip shadow whose
 * first layer is the same 1px hairline every other surface gets, and a hairline
 * only means anything on a surface that belongs to the same ramp as the page.
 * An inverted chip is the shadcn default and reads as a foreign object here.
 *
 * The stack already contains its ring, so there is no border.
 */
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
            "bg-popover text-popover-foreground z-50 w-fit rounded-md px-2 py-1",
            "text-caption font-medium shadow-tooltip",
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
      class={cn(
        "bg-popover text-popover-foreground z-50 w-fit rounded-md px-2 py-1",
        "text-caption font-medium shadow-tooltip",
        local.class
      )}
      {...rest}
    />
  );
}
