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
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
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
