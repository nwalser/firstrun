import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The shadcn class helper: conditional classes, then Tailwind conflict
 * resolution so a caller's horizontal padding beats a component's default
 * instead of depending on stylesheet order.
 *
 * The extension is not optional decoration. tailwind-merge classifies a class
 * it does not recognise by running the stock validators in order, and the
 * colour group's validator accepts anything. The design system's font sizes are
 * named rather than t-shirt-sized, so out of the box every one of them lands in
 * the TEXT COLOUR group -- and a component that states a size and a colour in
 * the same call silently loses the size, because the two now look like the same
 * property to the merger and the later one wins. Nothing errors; the text is
 * just the wrong size, in one component, forever.
 *
 * Naming them under `theme.text` moves them into the font-size group, where
 * they conflict with each other and with the stock sizes, and stop conflicting
 * with colours. `theme.spacing` does the same for the control-height rhythm, so
 * a caller passing an explicit height still overrides a component's default.
 *
 * Both lists mirror `styles.css` and have to be kept in step with it: a token
 * added there and forgotten here does not error, it just merges wrongly.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "h1",
        "h2",
        "h3",
        "lead",
        "prose",
        "body",
        // Both 13px steps. They were missing, which is exactly the failure the
        // note above describes: every `text-label-13` written beside a colour
        // in one `cn()` call lost its size and rendered at the inherited 14px,
        // in silence, across the sidebar headings, the widget chrome and the
        // explore builder.
        "label-13",
        "copy-13",
        "small",
        "caption",
        "mono",
        "code",
        "control-sm",
        "control-md",
        "control-lg",
      ],
      spacing: ["control-xs", "control-sm", "control-md", "control-lg", "popover-row"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
