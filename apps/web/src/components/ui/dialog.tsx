import { Dialog as KDialog } from "@kobalte/core/dialog";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/** The centred modal. The side drawer is sheet.tsx; both wrap the same primitive. */
export const Dialog = KDialog;
export const DialogTrigger = KDialog.Trigger;
export const DialogClose = KDialog.CloseButton;

/**
 * The panel sits on the popover surface, which is the same raised surface a
 * card uses, and carries the modal shadow stack: the 1px ring plus three very
 * low-alpha layers on top of it. That stack already contains its hairline, so
 * there is no border here.
 *
 * The scrim is there to push the page back, not to black it out.
 */
export function DialogContent(props: ComponentProps<typeof KDialog.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KDialog.Portal>
      {/*
        The house scrim: black at 40%, one pixel of blur, 60% in dark. The same
        three numbers the sidebar's phone drawer and the find palette draw, so
        every dim in the product is one dim.

        It sits at the SCRIM step of the ladder in `styles.css` and not at the
        overlay step. The two steps exist to answer exactly this: a scrim is
        under the thing it is dimming for and over everything else, and a scrim
        sharing a number with its own panel makes the ordering depend on which
        one the portal happened to append last.
      */}
      <KDialog.Overlay
        class={cn(
          "fixed inset-0 z-scrim bg-black/40 backdrop-blur-[1px] dark:bg-black/60",
          // The house overlay gesture, written up in `popover.tsx`.
          "duration-150",
          "motion-safe:data-[expanded]:animate-in data-[expanded]:fade-in-0",
          "motion-safe:data-[closed]:animate-out data-[closed]:fade-out-0"
        )}
      />
      <div class="fixed inset-0 z-overlay flex items-center justify-center p-4">
        <KDialog.Content
          class={cn(
            "bg-popover text-popover-foreground w-full max-w-lg rounded-md",
            "shadow-modal outline-none",
            "duration-150",
            "motion-safe:data-[expanded]:animate-in",
            "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
            "motion-safe:data-[closed]:animate-out",
            "data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
            local.class
          )}
          {...rest}
        >
          {local.children}
        </KDialog.Content>
      </div>
    </KDialog.Portal>
  );
}

export function DialogHeader(props: { class?: string; children?: JSX.Element }) {
  return <div class={cn("flex flex-col gap-1 px-5 pt-5", props.class)}>{props.children}</div>;
}

/**
 * The measured 16px/24px/600 step at -0.02em. A modal title is the one piece of
 * chrome that steps above 14px, and the negative tracking at that size is the
 * single most recognisable property of the Geist look.
 */
export function DialogTitle(props: ComponentProps<typeof KDialog.Title> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDialog.Title class={cn("text-lead", local.class)} {...rest} />;
}

export function DialogDescription(
  props: ComponentProps<typeof KDialog.Description> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDialog.Description class={cn("text-body text-muted-foreground", local.class)} {...rest} />
  );
}

export function DialogBody(props: { class?: string; children?: JSX.Element }) {
  return <div class={cn("px-5 py-4", props.class)}>{props.children}</div>;
}

export function DialogFooter(props: { class?: string; children?: JSX.Element }) {
  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-4",
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
