import { Breadcrumbs } from "@kobalte/core/breadcrumbs";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/** shadcn's breadcrumb, on Kobalte -- which supplies the nav landmark and aria-current. */
export function Breadcrumb(props: ComponentProps<typeof Breadcrumbs> & { class?: string }) {
  return <Breadcrumbs {...props} />;
}

export function BreadcrumbList(props: ComponentProps<"ol">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <ol
      class={cn(
        "flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground",
        local.class
      )}
      {...rest}
    />
  );
}

export function BreadcrumbItem(props: ComponentProps<"li">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <li class={cn("inline-flex items-center gap-1.5", local.class)} {...rest} />;
}

export function BreadcrumbLink(props: ComponentProps<"a">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <a class={cn("transition-colors hover:text-foreground", local.class)} {...rest} />;
}

export function BreadcrumbPage(props: ComponentProps<"span">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <span aria-current="page" class={cn("font-normal text-foreground", local.class)} {...rest} />
  );
}

export function BreadcrumbSeparator(props: ComponentProps<"li">) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <li role="presentation" aria-hidden="true" class={cn("[&>svg]:size-3.5", local.class)} {...rest}>
      {local.children ?? <Breadcrumbs.Separator />}
    </li>
  );
}
