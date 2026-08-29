import { DropdownMenu as KDropdownMenu } from "@kobalte/core/dropdown-menu";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export const DropdownMenu = KDropdownMenu;
export const DropdownMenuTrigger = KDropdownMenu.Trigger;

export function DropdownMenuContent(
  props: ComponentProps<typeof KDropdownMenu.Content> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KDropdownMenu.Portal>
      <KDropdownMenu.Content
        class={cn(
          "bg-popover text-popover-foreground z-50 min-w-[10rem] overflow-hidden rounded-md border p-1 shadow-md",
          "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
          "data-[closed]:animate-out data-[closed]:fade-out-0",
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
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
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

export function DropdownMenuLabel(props: ComponentProps<"div"> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class={cn("px-2 py-1.5 text-xs text-muted-foreground", local.class)} {...rest} />
  );
}
