import { Select as KSelect } from "@kobalte/core/select";
import { For, Show, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * A styled select, on Kobalte's listbox primitive.
 *
 * A native `<select>` cannot be styled to match the rest of this, and a
 * hand-rolled dropdown gets keyboard navigation, typeahead and focus return
 * wrong in ways nobody notices until someone uses a keyboard.
 */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  class?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const selected = () => props.options.find((o) => o.value === props.value) ?? null;

  return (
    <KSelect<SelectOption<T>>
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      disabled={props.disabled}
      placeholder={props.placeholder ?? "Select…"}
      itemComponent={(itemProps) => (
        <KSelect.Item
          item={itemProps.item}
          class={cn(
            "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none",
            "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
            "data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          )}
        >
          <KSelect.ItemLabel>{itemProps.item.rawValue.label}</KSelect.ItemLabel>
          <KSelect.ItemIndicator class="absolute right-2 flex size-3.5 items-center justify-center">
            <CheckIcon />
          </KSelect.ItemIndicator>
        </KSelect.Item>
      )}
    >
      <KSelect.Trigger
        aria-label={props["aria-label"]}
        class={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
          props.class
        )}
      >
        <KSelect.Value<SelectOption<T>> class="truncate">
          {(state) => state.selectedOption()?.label}
        </KSelect.Value>
        <KSelect.Icon class="opacity-60">
          <ChevronIcon />
        </KSelect.Icon>
      </KSelect.Trigger>

      <KSelect.Portal>
        <KSelect.Content
          class={cn(
            "bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-hidden rounded-md border shadow-md",
            "data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95",
            "data-[closed]:animate-out data-[closed]:fade-out-0"
          )}
        >
          <KSelect.Listbox class="max-h-64 overflow-y-auto p-1" />
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
}

/** A small segmented control, for choices short enough to show all at once. */
export function SegmentedControl<T extends string | number>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <div class={cn("bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5", props.class)}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(option.value)}
            aria-pressed={props.value === option.value}
            class={cn(
              "cursor-pointer rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              props.value === option.value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export { Show };
