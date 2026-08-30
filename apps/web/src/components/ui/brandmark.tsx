import type { ComponentProps } from "solid-js";

/**
 * The firstrun mark.
 *
 * The same three shapes as `public/favicon.svg` and as the mark in the site's
 * nav, so a browser tab, the sidebar and firstrun.app are showing one object
 * rather than three things that resemble each other. The plate is not drawn
 * here: the icon file needs an opaque square because it is composited onto
 * whatever colour the browser chrome happens to be, and inside the app the
 * mark sits on the page.
 *
 * `--brand` and `--muted-foreground` are named directly rather than through a
 * utility. This is a logo, so its colours are fixed by the mark rather than by
 * the surface it lands on, and the only thing a caller sets is the size.
 *
 * The viewBox is the icon's own 64-unit box cropped to the shapes, so a caller
 * states a height and the width follows.
 */
export function Brandmark(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="11 22 42 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="18" cy="32" r="7" fill="var(--muted-foreground)" />
      <rect x="24" y="29" width="14" height="6" rx="3" fill="var(--brand)" />
      <circle cx="44" cy="32" r="9" fill="var(--brand)" />
    </svg>
  );
}
