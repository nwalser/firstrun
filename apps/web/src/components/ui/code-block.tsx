import { CheckIcon, CopyIcon } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { cn } from "../../lib/cn.js";
import { Button } from "./button.js";

/**
 * A copyable snippet.
 *
 * Every install instruction in this product is something the reader is meant to
 * paste, so the copy button is part of the component rather than a thing each
 * page remembers to add.
 */
export function CodeBlock(props: { code: string; class?: string; language?: string }) {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the snippet is on screen regardless.
    }
  }

  return (
    <div class={cn("group relative", props.class)}>
      <pre class="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
        <code>{props.code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy to clipboard"
        class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={copy}
      >
        <Show when={copied()} fallback={<CopyIcon class="size-3.5" />}>
          <CheckIcon class="size-3.5 text-positive" />
        </Show>
      </Button>
    </div>
  );
}
