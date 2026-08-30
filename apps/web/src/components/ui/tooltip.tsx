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
            "bg-popover text-popover-foreground z-overlay w-fit rounded-md px-2 py-1",
            "text-caption font-medium shadow-tooltip",
            // The house overlay gesture, written up in `popover.tsx`. This one
            // used to arrive and then vanish: it had the enter half and no exit
            // at all, so the same 400ms hover that faded it in dropped it in a
            // single frame the moment the pointer left.
            "duration-150",
            "motion-safe:data-[expanded]:animate-in",
            "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
            "motion-safe:data-[closed]:animate-out",
            "data-[closed]:fade-out-0 data-[closed]:zoom-out-95"
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

/**
 * The same surface as `Tooltip`, for a caller that needs to build the trigger
 * itself.
 *
 * It carries its own portal and its own motion, which it did not before: it was
 * the one floating surface in this folder that neither portalled nor animated,
 * so the composable half of the tooltip behaved differently from the
 * convenience half of the same component. Portalled matters more than it looks
 * -- the layer ladder puts the sidebar above the topbar, and a tooltip left
 * inside the shell's subtree is a tooltip that can be clipped by the column it
 * was raised from.
 */
export function TooltipContent(props: ComponentProps<typeof KTooltip.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTooltip.Portal>
      <KTooltip.Content
        class={cn(
          "bg-popover text-popover-foreground z-overlay w-fit rounded-md px-2 py-1",
          "text-caption font-medium shadow-tooltip",
          "duration-150",
          "motion-safe:data-[expanded]:animate-in",
          "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
          "motion-safe:data-[closed]:animate-out",
          "data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
          local.class
        )}
        {...rest}
      />
    </KTooltip.Portal>
  );
}
