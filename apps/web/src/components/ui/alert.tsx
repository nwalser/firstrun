import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A flat panel with a hairline, at the 6px surface radius. The state variants
 * tint the fill and the edge and colour the icon; they do not add elevation,
 * because nothing in this system announces itself by floating.
 *
 * This is one of the few places a real `border` is still right rather than the
 * ring: each variant tints its own edge, and a tinted edge is a colour utility,
 * which a box-shadow ring has nowhere to accept. It carries a border and no
 * shadow, so the two never double up.
 *
 * The destructive variant is on `negative`, not `destructive`. `destructive` is
 * the button FILL and in dark it is the 800 step, which is a fill colour under
 * white; `negative` is the 900 step, which is the one that can be read as a
 * word on a card.
 */
export const alertVariants = cva(
  [
    "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1",
    "rounded-md border border-border px-4 py-3 text-body",
    "has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3",
    "[&>svg]:size-4 [&>svg]:translate-y-0.5",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-negative/50 bg-negative/10 text-negative [&>svg]:text-negative",
        // The warning token, not the estimate one: estimate is documented as
        // unused now, and this variant was never about an estimate anyway.
        warning: "border-warning/50 bg-warning/10 text-warning [&>svg]:text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Alert(
  props: ComponentProps<"div"> & VariantProps<typeof alertVariants>
) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <div
      role="alert"
      class={cn(alertVariants({ variant: local.variant }), local.class)}
      {...rest}
    />
  );
}

export function AlertTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("col-start-2 min-h-4 font-semibold", local.class)} {...rest} />;
}

/**
 * No opacity knock-back. Dimming the description was how the old version
 * separated it from the title; the title is semibold and that is enough, and
 * the 10% it cost was coming straight off text that has to be read.
 */
export function AlertDescription(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("col-start-2 text-small [&_p]:leading-relaxed", local.class)}
      {...rest}
    />
  );
}
