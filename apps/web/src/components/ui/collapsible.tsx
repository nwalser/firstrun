import { Collapsible as KCollapsible } from "@kobalte/core/collapsible";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export const Collapsible = KCollapsible;
export const CollapsibleTrigger = KCollapsible.Trigger;

/**
 * The one disclosure in this folder that used to snap.
 *
 * Every other panel here arrives and leaves over the house 150ms and this was a
 * bare re-export, so a section opening in place was the single instant gesture
 * in a product where nothing else is. It runs the height keyframes the
 * animation library ships for exactly this primitive, which read the content
 * height Kobalte measures and writes onto the element for them.
 *
 * The curve for a height collapse was NOT measured against the reference, which
 * records no such gesture at all. 150ms is our own number, taken from the
 * overlays so a reader meets one speed rather than two.
 *
 * Clipping the panel is load-bearing: without it the contents spill out of the
 * shrinking box for the whole of the close, and the panel looks like it is
 * being cut rather than folded.
 */
export function CollapsibleContent(
  props: ComponentProps<typeof KCollapsible.Content> & { class?: string }
) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KCollapsible.Content
      class={cn(
        "overflow-hidden duration-150",
        "motion-safe:data-[expanded]:animate-collapsible-down",
        "motion-safe:data-[closed]:animate-collapsible-up",
        local.class
      )}
      {...rest}
    />
  );
}
