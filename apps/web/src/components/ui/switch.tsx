import { Switch as KSwitch } from "@kobalte/core/switch";
import { cn } from "../../lib/cn.js";

/**
 * The toggle, on Kobalte's switch.
 *
 * The off track is the secondary step, which is an opaque control fill rather
 * than a tint: an off switch is still a control and still has to be findable.
 * On is the primary fill, the text extreme of the ramp, so the two states are
 * as far apart as this palette goes. The track carries the same 1px ring as
 * every other control, drawn as a box-shadow, which is what holds the off state
 * against a card whose fill is only two percent away from it.
 *
 * The thumb is the raised surface in both states and carries a ring of its own.
 * The ring is what makes it work in all four combinations: without it a
 * near-black thumb on a #1f1f1f dark off-track is a hole rather than a knob.
 *
 * `KSwitch.Input` is the real focusable element and it is the peer of the
 * control, so focus is read across the sibling. It cannot be a `focus-within`
 * on the control, which is what was here before: the input is not inside the
 * control, so that selector never matched and the switch had no visible focus
 * at all.
 */
export function Switch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  class?: string;
}) {
  return (
    <KSwitch
      checked={props.checked}
      onChange={props.onChange}
      class={cn("flex items-center justify-between gap-4", props.class)}
    >
      <div class="flex flex-col gap-0.5">
        {props.label && (
          <KSwitch.Label class="text-body leading-none font-medium select-none">
            {props.label}
          </KSwitch.Label>
        )}
        {props.description && (
          <KSwitch.Description class="text-caption text-muted-foreground">
            {props.description}
          </KSwitch.Description>
        )}
      </div>
      <KSwitch.Input class="peer sr-only" />
      <KSwitch.Control
        class={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
          "bg-secondary shadow-xs transition-[background-color,box-shadow]",
          "data-[checked]:bg-primary data-[checked]:hover:bg-primary/90",
          "peer-focus-visible:shadow-focus",
          "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
        )}
      >
        <KSwitch.Thumb
          class={cn(
            "pointer-events-none block size-4 rounded-full bg-card shadow-xs",
            "translate-x-0.5 transition-transform data-[checked]:translate-x-[18px]"
          )}
        />
      </KSwitch.Control>
    </KSwitch>
  );
}
