import { Tabs as KTabs } from "@kobalte/core/tabs";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * Tabs, on Kobalte -- which brings roving focus and arrow keys.
 *
 * The underline model, not the segmented pill. The list is a rule across the
 * full width with the triggers sitting on it, and the active tab is marked by a
 * two-pixel bar in the foreground colour plus a jump from the muted text colour
 * to the full one. Two signals, one of which survives being colour-blind and
 * one of which survives a low-contrast screen.
 *
 * The bar is a pseudo-element on the trigger rather than Kobalte's Indicator,
 * because the indicator animates between positions and needs measuring; this
 * needs neither and cannot get out of sync with the selected state.
 *
 * The triggers no longer stretch to fill the list. The one call site already
 * asks for a full-width list aligned to the start, so they now sit at their
 * natural widths against the left edge instead of being spread across it.
 */
export const Tabs = KTabs;

export function TabsList(props: ComponentProps<typeof KTabs.List> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.List
      class={cn(
        "relative inline-flex h-control-md w-fit items-center justify-center gap-4",
        "border-b border-border",
        local.class
      )}
      {...rest}
    />
  );
}

export function TabsTrigger(props: ComponentProps<typeof KTabs.Trigger> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.Trigger
      class={cn(
        "relative inline-flex h-full cursor-pointer items-center justify-center gap-1.5",
        "rounded-sm px-0.5 text-body font-medium whitespace-nowrap",
        "transition-colors text-muted-foreground hover:text-foreground",
        "data-[selected]:text-foreground",
        // The bar sits on the list's own rule, one pixel below the trigger box,
        // so it reads as the rule thickening under the active tab. Square ends:
        // it is a thicker piece of the rule, not a separate pill.
        "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5",
        "after:bg-transparent data-[selected]:after:bg-foreground",
        // The two-stop blue focus ring, from the stylesheet. A monochrome ring
        // utility is not what Geist draws, and the class is real CSS rather
        // than an arbitrary variant that may emit nothing.
        "focus-ring",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        local.class
      )}
      {...rest}
    />
  );
}

export function TabsContent(props: ComponentProps<typeof KTabs.Content> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <KTabs.Content class={cn("flex-1 outline-none", local.class)} {...rest} />;
}
