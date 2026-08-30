import { Image } from "@kobalte/core/image";
import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * shadcn's avatar, on Kobalte's image primitive.
 *
 * The primitive earns its place by handling the load lifecycle: the fallback
 * shows while the image is loading and stays if it fails, so a broken avatar URL
 * is initials rather than a torn image icon.
 *
 * The hairline is a ring on the frame rather than a border, so a light avatar
 * on a light surface still has an edge without the image being inset by a pixel
 * inside it. `overflow-hidden` clips the image, not the shadow.
 */
export function Avatar(props: ComponentProps<typeof Image> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <Image
      class={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full shadow-2xs",
        local.class
      )}
      {...rest}
    />
  );
}

export function AvatarImage(props: ComponentProps<typeof Image.Img> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return <Image.Img class={cn("aspect-square size-full object-cover", local.class)} {...rest} />;
}

export function AvatarFallback(props: ComponentProps<typeof Image.Fallback> & { class?: string }) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <Image.Fallback
      class={cn(
        "bg-muted text-foreground flex size-full items-center justify-center rounded-full",
        "text-caption font-medium",
        local.class
      )}
      {...rest}
    />
  );
}

/** First letters of a name or slug, for when there is no image. */
export function initials(value: string): string {
  const parts = value.trim().split(/[\s\-_]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
