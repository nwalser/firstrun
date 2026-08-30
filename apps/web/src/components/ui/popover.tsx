import { Popover as KPopover } from "@kobalte/core/popover";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * shadcn's popover, on Kobalte's primitive.
 *
 * Positioning -- `placement`, `gutter`, `flip`, `fitViewport` -- belongs on the
 * root and not on the content, because Kobalte builds the popper around the
 * whole subtree. Passing `placement` to `PopoverContent` is silently ignored,
 * which is worth knowing before spending an afternoon on a popover that will
 * not move.
 *
 * `PopoverTrigger` renders Kobalte's button, so it is `type="button"` unless
 * told otherwise -- the same reasoning written up in `button.tsx`. A
 * `PopoverTrigger as={Button}` sitting inside a form therefore opens the
 * popover rather than submitting the form, which is the behaviour you want and
 * the one you would otherwise have to remember to ask for.
 */

export const Popover = KPopover;
export const PopoverTrigger = KPopover.Trigger;
export const PopoverAnchor = KPopover.Anchor;
export const PopoverClose = KPopover.CloseButton;
export const PopoverTitle = KPopover.Title;
export const PopoverDescription = KPopover.Description;

export function PopoverContent(props: ComponentProps<typeof KPopover.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KPopover.Portal>
      <KPopover.Content
        class={cn(
          "bg-popover text-popover-foreground z-50 overflow-hidden",
          // The menu stack. It already contains its 1px ring, so no border.
          "rounded-md p-3 shadow-menu outline-none",
          "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
          "data-[closed]:animate-out data-[closed]:fade-out-0",
          local.class
        )}
        {...rest}
      />
    </KPopover.Portal>
  );
}
