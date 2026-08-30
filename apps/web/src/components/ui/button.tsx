import { Button as KButton } from "@kobalte/core/button";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { cva, type VariantProps } from "class-variance-authority";
import { splitProps, type ValidComponent } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * The button, on Kobalte's accessible primitive.
 *
 * `type` is part of the public surface for a reason: Kobalte renders
 * `type="button"` unless told otherwise, so a button inside a form does nothing
 * at all until it is given `type="submit"`. That failure is silent -- the button
 * looks right, the click lands, and the form never submits -- so it is worth
 * naming here rather than rediscovering per form.
 *
 * The look is measured off a real Geist button: 32px tall, 14px at weight 400,
 * 4px radius, 8px of horizontal padding, and one hairline. Four things follow
 * from that and are worth stating, because each is somewhere a port drifts:
 *
 *   - Weight 400, not 500. Geist sets control text at the same weight as body
 *     text and lets the fill carry the emphasis. Bumping it to medium is the
 *     single change that makes a set of buttons stop looking like Geist.
 *   - 4px radius. Six is for surfaces, popover rows and inputs; a button is a
 *     small control and rounds less than the thing it sits inside.
 *   - The edge is a 1px ring drawn as box-shadow, never a border, so it takes
 *     no part in layout and a bordered variant is exactly as tall as a filled
 *     one. An element here carries a shadow class or a border, never both.
 *   - Focus is the two-stop blue: 2px of the page colour, then 2px of blue. It
 *     replaces the resting ring rather than stacking on it.
 *
 * Heights follow Geist's three form sizes, 32 / 36 / 40, with the type steps
 * that go with them (14/14, 14/20, 16/24), so a button lines up with an input
 * and a select without anyone measuring.
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap",
    "rounded-sm font-normal transition-[color,background-color,box-shadow]",
    "outline-none focus-visible:shadow-focus",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // The signature. Not a brand colour: the text extreme of the ramp, with
        // the surface extreme on top. Hover moves it one step toward its own
        // foreground, which lightens on light and darkens on dark -- the same
        // class reading correctly in both themes.
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // Red is a state, so this stays filled. `destructive` is the fill step,
        // measured per theme, and white sits on it in both.
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // The ringed surface button. It takes the RAISED fill rather than the
        // page fill: the reference draws a toolbar's icon buttons on
        // background-100, which is what keeps them reading as objects sitting on
        // the page instead of holes cut into it. The hairline is the shadow, so
        // there is no border here to pair it with.
        outline: [
          "bg-card text-foreground shadow-xs",
          "hover:bg-accent hover:text-accent-foreground",
        ],
        // The same shape with a filled face, for the second action in a pair
        // that both need weight. `secondary` is one step more present than the
        // muted fill precisely so it reads as a control.
        secondary: [
          "bg-secondary text-secondary-foreground shadow-xs",
          "hover:bg-accent hover:text-accent-foreground",
        ],
        // No ring, no fill until you touch it. Carries the toolbar and the icon
        // buttons, which is most of this app.
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
      },
      size: {
        // 36 / 14 / 20, the middle Geist form height. Padding climbs with the
        // height on the 4px space scale; the icon-only cases pull it back in.
        default: "h-control-md px-3 text-control-md has-[>svg]:px-2.5",
        // 32 / 14 / 14, and 8px of padding, which is the button that was
        // actually measured.
        sm: "h-control-sm gap-1.5 px-2 text-control-sm",
        // 40 / 16 / 24.
        lg: "h-control-lg px-4 text-control-lg has-[>svg]:px-3.5",
        icon: "size-control-md text-control-md",
        "icon-sm": "size-control-xs text-control-sm",
        // The toolbar cell. 36px at radius 6 with the measured 10px of padding:
        // the reference states radius 6 for every control in that row, which is
        // one step up from the 4px a standalone Geist button measures.
        toolbar: "h-control-md rounded-md px-2.5 text-control-md has-[>svg]:px-2",
        "toolbar-icon": "size-control-md rounded-md text-control-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

type ButtonProps<T extends ValidComponent = "button"> = PolymorphicProps<T> &
  VariantProps<typeof buttonVariants> & { class?: string; type?: "button" | "submit" | "reset" };

export function Button<T extends ValidComponent = "button">(props: ButtonProps<T>) {
  const [local, rest] = splitProps(props as ButtonProps, ["class", "variant", "size"]);
  return (
    <KButton
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...rest}
    />
  );
}
