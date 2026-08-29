import { Switch as KSwitch } from "@kobalte/core/switch";
import { cn } from "../../lib/cn.js";

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
          <KSwitch.Label class="text-sm font-medium select-none">{props.label}</KSwitch.Label>
        )}
        {props.description && (
          <KSwitch.Description class="text-xs text-muted-foreground">
            {props.description}
          </KSwitch.Description>
        )}
      </div>
      <KSwitch.Input class="sr-only" />
      <KSwitch.Control
        class={cn(
          "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
          "bg-input data-[checked]:bg-primary",
          "focus-within:ring-[3px] focus-within:ring-ring/50"
        )}
      >
        <KSwitch.Thumb
          class={cn(
            "pointer-events-none block size-4 rounded-full bg-background shadow transition-transform",
            "translate-x-0.5 data-[checked]:translate-x-[18px]"
          )}
        />
      </KSwitch.Control>
    </KSwitch>
  );
}
