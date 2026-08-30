import { Toaster as SonnerToaster, toast } from "solid-sonner";

/**
 * Toasts, via solid-sonner -- the Solid build of what shadcn uses.
 *
 * Styled from the same tokens as everything else rather than sonner's defaults,
 * so a toast looks like it belongs to this product and not to a library. A
 * toast is genuinely floating, so it takes the menu stack: the 1px ring plus
 * three low-alpha layers on top of it. The stack contains its own hairline, so
 * there is no border, and the state variants say what they are in the text
 * colour instead of tinting an edge that no longer exists.
 */
/*
  Onto the layer ladder.

  Sonner ships its own stacking number and that number is nine digits long. It
  is not a step of anything: it is a bid to sit above whatever else a page might
  have, and it leaves the one surface in the product whose height nobody chose
  winning every ordering argument. The ladder in `styles.css` has three named
  steps and a toast is a portalled overlay, so it takes the overlay step like
  the rest of them.

  An inline style rather than a class, because sonner injects its stylesheet
  UNLAYERED, and an unlayered rule beats every layered utility we could write
  against it whatever the specificity. That is also why the classes below win
  some arguments and lose others, which is a separate thing worth a pass.

  THE CONSEQUENCE, written down because it is a real one: at the same step as a
  modal, ordering falls to document order, so a dialog portalled after this
  mounts ABOVE a toast rather than under it. That is the honest reading of a
  three-step ladder. If a toast fired from inside a modal has to stay legible
  over it, the ladder needs a fourth step and this line needs to name it, rather
  than keeping a nine-digit number that outranks everything by accident.
*/
const TOASTER_LAYER = { "z-index": "var(--z-index-toast)" };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      style={TOASTER_LAYER}
      toastOptions={{
        classes: {
          toast:
            "group flex items-center gap-3 rounded-md bg-popover text-popover-foreground shadow-menu px-4 py-3 text-body",
          title: "font-medium text-popover-foreground",
          description: "text-small text-muted-foreground",
          actionButton:
            "bg-primary text-primary-foreground rounded-sm px-2 py-1 text-small font-medium",
          cancelButton:
            "bg-secondary text-secondary-foreground rounded-sm px-2 py-1 text-small font-medium",
          error: "text-negative",
          success: "text-positive",
        },
      }}
    />
  );
}

export { toast };
