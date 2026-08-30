import type { Surface } from "@firstrun/schema/surface";
import Box from "lucide-solid/icons/box";
import Globe from "lucide-solid/icons/globe";
import Monitor from "lucide-solid/icons/monitor";
import Server from "lucide-solid/icons/server";
import Smartphone from "lucide-solid/icons/smartphone";
import { Dynamic } from "solid-js/web";
import { cn } from "../lib/cn.js";

/**
 * One icon per surface. The list of surfaces is closed, so the record is total.
 *
 * Shared by both source lists. A surface drawn as a globe on one page and a box
 * on the other is a thing a reader has to learn twice.
 */
const SURFACE_ICON: Record<Surface, (props: { class?: string }) => ReturnType<typeof Globe>> = {
  web: Globe,
  desktop: Monitor,
  mobile: Smartphone,
  server: Server,
  other: Box,
};

/** The 36px tile a source row leads with. */
export function SurfaceIcon(props: { kind: Surface; class?: string }) {
  return (
    <div
      class={cn(
        "grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground",
        props.class
      )}
    >
      {/*
        `?? Box` even though the record is total: `kind` comes off a row that
        came out of the database, and a value written before a surface was
        removed from the enum would otherwise render nothing at all.
      */}
      <Dynamic component={SURFACE_ICON[props.kind] ?? Box} class="size-4" />
    </div>
  );
}
