import { Tabs as KTabs } from "@kobalte/core/tabs";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/** shadcn's tabs, on Kobalte -- which brings roving focus and arrow keys. */
export const Tabs = KTabs;

export function TabsList(props: ComponentProps<typeof KTabs.List> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <KTabs.List
      class={cn(
        "relative inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
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
        "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors",
        "text-muted-foreground data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-xs",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
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
