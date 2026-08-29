import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export function Card(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm",
        local.class
      )}
      {...rest}
    />
  );
}

export function CardHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "flex items-start justify-between gap-2 px-5 pt-4 pb-3",
        local.class
      )}
      {...rest}
    />
  );
}

export function CardTitle(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        local.class
      )}
      {...rest}
    />
  );
}

export function CardDescription(props: ComponentProps<"p">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <p class={cn("text-sm text-muted-foreground", local.class)} {...rest} />;
}

export function CardContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("px-5 pb-5", local.class)} {...rest} />;
}

export function CardFooter(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center px-5 pb-5", local.class)} {...rest} />;
}
