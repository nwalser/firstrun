import { Popover as KPopover } from "@kobalte/core/popover";
import { createSignal, onCleanup, splitProps, type ComponentProps } from "solid-js";
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
 * The panel is hidden until the popper has placed it -- see `PopoverContent`.
 * Without that it paints one frame in the top-left corner of the window and
 * then jumps to its trigger.
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

  /**
   * Whether the popper has actually put this panel where it goes.
   *
   * It opens at the top-left corner of the window. Kobalte renders the
   * positioner at `top: 0; left: 0` and applies the real offset as a transform
   * only once `computePosition` resolves, which is a promise -- so there is at
   * least one painted frame in which a fully built panel is sitting in the
   * corner of the screen before it jumps to its trigger. On a small menu that
   * reads as a flicker. On a 384px panel it reads as broken, which is what it
   * was reported as.
   *
   * So the panel is hidden until the transform lands. `visibility` rather than
   * `display`, because the panel has to be laid out for the popper to measure
   * it -- hiding it any harder is what would make the placement wrong instead
   * of merely visible.
   *
   * Polled on a timer rather than an animation frame: a frame callback does not
   * run in a tab that is not compositing, and a popover opened in a background
   * tab would then never become visible at all. The counter is the backstop --
   * if the transform never arrives (a positioner with nothing to anchor to),
   * the panel is shown anyway rather than being silently invisible.
   */
  const [placed, setPlaced] = createSignal(false);

  const waitForPlacement = (el: HTMLElement) => {
    let tries = 0;
    const check = () => {
      const positioner = el.parentElement;
      if (!positioner || positioner.style.transform || tries++ >= 10) setPlaced(true);
      else setTimeout(check, 0);
    };
    check();
    onCleanup(() => setPlaced(false));
  };

  return (
    <KPopover.Portal>
      <KPopover.Content
        ref={waitForPlacement}
        data-placed={placed() ? "" : undefined}
        class={cn(
          "bg-popover text-popover-foreground z-overlay overflow-hidden",
          // The menu stack. It already contains its 1px ring, so no border.
          "rounded-md p-3 shadow-menu outline-none",
          "invisible data-[placed]:visible",
          "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
          "data-[closed]:animate-out data-[closed]:fade-out-0",
          local.class
        )}
        {...rest}
      />
    </KPopover.Portal>
  );
}
