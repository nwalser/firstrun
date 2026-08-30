import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A small, square-ish chip with a hairline. 4px of radius, not a pill: a pill
 * reads as a status light, and most of these are labels.
 *
 * `secondary` and `estimate` carry a real border rather than a transparent one,
 * so a tinted chip has an edge instead of dissolving into whatever surface it
 * sits on. The filled variants keep the transparent border purely so every
 * variant is the same height.
 */
export const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap",
    "rounded-sm border px-1.5 py-0.5 text-caption font-medium",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-border bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        // Repointed off the estimate token, which the design system now
        // documents as unused. The variant name stays: it is public surface.
        estimate: "border-warning/50 bg-warning/15 text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge(
  props: ComponentProps<"span"> & VariantProps<typeof badgeVariants>
) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <span
      class={cn(badgeVariants({ variant: local.variant }), local.class)}
      {...rest}
    />
  );
}
