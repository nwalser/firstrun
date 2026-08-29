import { Toaster as SonnerToaster, toast } from "solid-sonner";

/**
 * Toasts, via solid-sonner -- the Solid build of what shadcn uses.
 *
 * Styled from the same tokens as everything else rather than sonner's defaults,
 * so a toast looks like it belongs to this product and not to a library.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classes: {
          toast:
            "group flex items-center gap-3 rounded-lg border bg-popover text-popover-foreground shadow-lg p-4 text-sm",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground rounded-md px-2 py-1 text-xs",
          cancelButton: "bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs",
          error: "border-destructive/40 text-destructive",
          success: "border-positive/40",
        },
      }}
    />
  );
}

export { toast };
