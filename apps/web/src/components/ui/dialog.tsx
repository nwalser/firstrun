import { Dialog as KDialog } from "@kobalte/core/dialog";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/** The centred modal. The side drawer is sheet.tsx; both wrap the same primitive. */
export const Dialog = KDialog;
export const DialogTrigger = KDialog.Trigger;
export const DialogClose = KDialog.CloseButton;

export function DialogContent(props: ComponentProps<typeof KDialog.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <KDialog.Portal>
      <KDialog.Overlay
        class={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
          "data-[expanded]:animate-in data-[expanded]:fade-in-0",
          "data-[closed]:animate-out data-[closed]:fade-out-0"
        )}
      />
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <KDialog.Content
          class={cn(
            "bg-background w-full max-w-lg rounded-xl border shadow-lg outline-none",
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
            "data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
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

export function DialogTitle(props: ComponentProps<typeof KDialog.Title> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDialog.Title class={cn("text-base font-semibold", local.class)} {...rest} />;
}

export function DialogDescription(
  props: ComponentProps<typeof KDialog.Description> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KDialog.Description class={cn("text-sm text-muted-foreground", local.class)} {...rest} />;
}

export function DialogBody(props: { class?: string; children?: JSX.Element }) {
  return <div class={cn("px-5 py-4", props.class)}>{props.children}</div>;
}

export function DialogFooter(props: { class?: string; children?: JSX.Element }) {
  return (
    <div class={cn("flex items-center justify-end gap-2 border-t px-5 py-4", props.class)}>
      {props.children}
    </div>
  );
}
