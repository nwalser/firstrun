import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[11px] font-medium w-fit whitespace-nowrap shrink-0 gap-1",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-muted-foreground",
        estimate: "border-estimate/30 text-estimate bg-estimate/10",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge(props: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return <span class={cn(badgeVariants({ variant: local.variant }), local.class)} {...rest} />;
}
