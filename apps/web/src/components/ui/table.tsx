import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

export function Table(props: ComponentProps<"table">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class="relative w-full overflow-x-auto">
      <table class={cn("w-full caption-bottom text-sm", local.class)} {...rest} />
    </div>
  );
}

export function TableHeader(props: ComponentProps<"thead">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <thead class={cn("[&_tr]:border-b", local.class)} {...rest} />;
}

export function TableBody(props: ComponentProps<"tbody">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <tbody class={cn("[&_tr:last-child]:border-0", local.class)} {...rest} />;
}

export function TableRow(props: ComponentProps<"tr">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <tr class={cn("border-b transition-colors hover:bg-muted/40", local.class)} {...rest} />
  );
}

export function TableHead(props: ComponentProps<"th">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <th
      class={cn(
        "h-9 px-3 text-right align-middle text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground first:text-left",
        local.class
      )}
      {...rest}
    />
  );
}

export function TableCell(props: ComponentProps<"td">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <td class={cn("px-3 py-2 text-right align-middle first:text-left", local.class)} {...rest} />;
}
