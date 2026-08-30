import { Dialog } from "@kobalte/core/dialog";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A side drawer, on Kobalte's dialog primitive.
 *
 * Kobalte handles the parts that are tedious and easy to get subtly wrong:
 * focus trapping, restoring focus to whatever opened it, scroll locking, escape
 * and outside-click dismissal, and the aria wiring between title, description
 * and the dialog itself.
 *
 * Square, not rounded: the drawer is flush with three edges of the viewport, so
 * the only corners it has are the ones against the page and rounding those
 * would leave two slivers of scrim in the corners.
 *
 * It keeps a real `border` on the one edge that faces the page, and takes the
 * lift WITHOUT a ring for the same reason: three of the four sides of a ring
 * would be drawn off-screen, so the ring buys nothing and the border is the
 * only hairline anyone can see. `shadow-lift-md` exists for exactly this, a
 * thing that already has its own edge.
 */

export const Sheet = Dialog;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.CloseButton;

export function SheetContent(
  props: ComponentProps<typeof Dialog.Content> & { class?: string; side?: "right" | "left" }
) {
  const [local, rest] = splitProps(props, ["class", "children", "side"]);
  const side = () => local.side ?? "right";

  return (
    <Dialog.Portal>
      {/* The house scrim at the scrim step of the ladder. See `dialog.tsx`. */}
      <Dialog.Overlay
        class={cn(
          "fixed inset-0 z-scrim bg-black/40 backdrop-blur-[1px] dark:bg-black/60",
          "duration-150",
          "motion-safe:data-[expanded]:animate-in data-[expanded]:fade-in-0",
          "motion-safe:data-[closed]:animate-out data-[closed]:fade-out-0"
        )}
      />
      <Dialog.Content
        class={cn(
          "bg-popover text-popover-foreground fixed z-overlay flex h-full w-full flex-col gap-0",
          "border-l border-border shadow-lift-md outline-none",
          "top-0 sm:max-w-sm",
          side() === "right" ? "right-0" : "left-0 border-l-0 border-r border-border",
          //
          // A drawer SLIDES where a modal zooms, because it comes from an edge
          // and the edge is the point. What it does not get is its own clock:
          // this used to open over 200ms and close over 150, which is one
          // gesture keeping two times and reads as the drawer being heavier to
          // open than to shut. It runs at the house 150 in both directions now,
          // in step with its own scrim, which was already at 150 and therefore
          // finished a frame and a half before the panel it belongs to.
          "duration-150",
          "motion-safe:data-[expanded]:animate-in motion-safe:data-[closed]:animate-out",
          side() === "right"
            ? "data-[expanded]:slide-in-from-right data-[closed]:slide-out-to-right"
            : "data-[expanded]:slide-in-from-left data-[closed]:slide-out-to-left",
          local.class
        )}
        {...rest}
      >
        {local.children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader(props: { class?: string; children?: JSX.Element }) {
  return (
    <div class={cn("flex flex-col gap-1 border-b border-border px-4 py-4", props.class)}>
      {props.children}
    </div>
  );
}

export function SheetTitle(props: ComponentProps<typeof Dialog.Title> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  // 16/24/600 at -0.02em, matching DialogTitle. See the note there.
  // Application chrome is 14px. 16px is marketing prose, and a panel header
  // set at the marketing size is the single loudest thing on a dashboard.
  return <Dialog.Title class={cn("text-body font-medium tracking-snug", local.class)} {...rest} />;
}

export function SheetDescription(
  props: ComponentProps<typeof Dialog.Description> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <Dialog.Description class={cn("text-body text-muted-foreground", local.class)} {...rest} />
  );
}

export function SheetBody(props: { class?: string; children?: JSX.Element }) {
  return <div class={cn("flex-1 overflow-y-auto px-4 py-4", props.class)}>{props.children}</div>;
}

export function SheetFooter(props: { class?: string; children?: JSX.Element }) {
  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 border-t border-border px-4 py-4",
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
