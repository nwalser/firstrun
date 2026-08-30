import Check from "lucide-solid/icons/check";
import Copy from "lucide-solid/icons/copy";
import { Show, createSignal } from "solid-js";
import { cn } from "../lib/cn.js";
import { Button, toast } from "./ui/index.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * A source key, inline, with the copy button that makes it useful.
 *
 * A source key is public by necessity and authorises nothing, so it is shown
 * rather than masked: the reader is here to compare it against what they pasted
 * into a deploy, and a value behind a "reveal" is one more click before they
 * can. It is still copied from the string rather than from the DOM, so a key
 * truncated on a narrow pane pastes whole.
 *
 * Shared, because both source lists draw it -- the project's and the
 * workspace's -- and a key that copied whole on one page and truncated on the
 * other would be the kind of bug nobody reports and everybody works around.
 */
export function IngestKeyCell(props: { value: string; class?: string }) {
  const i18n = useI18n();
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard is not worth a dialog: the key is on screen and can
      // be selected by hand.
      toast.error(i18n.t("sources.clipboard_failed"));
    }
  }

  return (
    <div class={cn("flex min-w-0 items-center gap-1", props.class)}>
      <span class="truncate font-mono text-mono text-muted-foreground" title={props.value}>
        {props.value}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={copy}
        aria-label={copied() ? i18n.t("common.copied") : i18n.t("sources.copy_key")}
        title={copied() ? i18n.t("common.copied") : i18n.t("sources.copy_key")}
      >
        <Show when={copied()} fallback={<Copy class="size-3.5" />}>
          <Check class="size-3.5 text-positive" />
        </Show>
      </Button>
    </div>
  );
}
