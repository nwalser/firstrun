import { DropdownMenu as KDropdownMenu } from "@kobalte/core/dropdown-menu";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export const DropdownMenu = KDropdownMenu;
export const DropdownMenuTrigger = KDropdownMenu.Trigger;

/**
 * The floating surface and its rows are both drawn at the measured popover
 * radius, and the surface carries the menu shadow stack: the 1px ring plus
 * three low-alpha layers on top of it. The stack contains its own hairline, so
 * there is no border on the content.
 */
export function DropdownMenuContent(
  props: ComponentProps<typeof KDropdownMenu.Content> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.Portal>
      <KDropdownMenu.Content
        class={cn(
          "bg-popover text-popover-foreground z-overlay min-w-[10rem] overflow-hidden",
          "rounded-md p-1 shadow-menu",
          // The house overlay gesture, written up in `popover.tsx`: 150ms in
          // and out, the exit mirroring the enter, and nothing animating for a
          // reader who has asked the system for less motion.
          "duration-150",
          "motion-safe:data-[expanded]:animate-in",
          "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
          "motion-safe:data-[closed]:animate-out",
          "data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
          local.class
        )}
        {...rest}
      />
    </KDropdownMenu.Portal>
  );
}

export function DropdownMenuItem(
  props: ComponentProps<typeof KDropdownMenu.Item> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.Item
      class={cn(
        "relative flex cursor-pointer items-center gap-2 select-none",
        // 36px and 6px are the measured popover row, not the button's 32/4.
        "min-h-popover-row rounded-md px-2.5 py-1.5 text-body outline-none",
        "text-popover-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        // The highlight is the accent fill, which is a genuine step off the
        // popover surface in both themes rather than the 1.5% tint it used to
        // be in light. Highlighted is what a hovered item and a keyboard-focused
        // item share in Kobalte, so this is the only hover state there is.
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[highlighted]:[&_svg]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        local.class
      )}
      {...rest}
    />
  );
}

export function DropdownMenuSeparator() {
  return <KDropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />;
}

/** Sentence case in the muted colour. Geist does not shout its section names. */
export function DropdownMenuLabel(props: ComponentProps<"div"> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "px-2.5 py-1.5 text-small font-medium text-muted-foreground",
        local.class
      )}
      {...rest}
    />
  );
}
