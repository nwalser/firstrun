import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive [&>svg]:text-destructive",
        warning: "border-estimate/40 bg-estimate/10 text-estimate [&>svg]:text-estimate",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Alert(props: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return <div role="alert" class={cn(alertVariants({ variant: local.variant }), local.class)} {...rest} />;
}

export function AlertTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class={cn("col-start-2 min-h-4 font-medium tracking-tight", local.class)} {...rest} />
  );
}

export function AlertDescription(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class={cn("col-start-2 text-sm opacity-90 [&_p]:leading-relaxed", local.class)} {...rest} />
  );
}
