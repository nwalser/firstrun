import { useRouter } from "@tanstack/solid-router";
import RotateCw from "lucide-solid/icons/rotate-cw";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { cn } from "../lib/cn.js";
import { Button } from "./ui/index.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Re-read what this page is showing.
 *
 * Every page here is drawn from a loader, and a loader runs on navigation. That
 * is right for a page you arrive at and wrong for a page you leave open: a
 * dashboard, a source list or a log is a window onto something that is still
 * happening, and the only way to see the next minute of it used to be a browser
 * reload -- which throws away the sidebar, the scroll position and every filter
 * held in a signal.
 *
 * `router.invalidate()` re-runs the loaders of the routes currently matched and
 * nothing else. The component tree stays mounted, so filters, sorts and open
 * menus survive; only the data changes underneath them.
 *
 * It says when it last succeeded, because a refresh button with no timestamp
 * beside it answers "did that do anything" with silence. The stamp is relative
 * and re-renders on a timer, so "2 minutes ago" does not sit there claiming to
 * be current.
 *
 * It does NOT poll. A page that refetches on its own without being asked is a
 * page that moves under somebody's cursor, and the one view where a live tail
 * is worth that (the event log) turns it on deliberately and says so.
 */
export function RefreshButton(props: {
  /** Shown beside the icon on a wide toolbar. Icon only when absent. */
  withLabel?: boolean;
  /** Extra work to do alongside the loader, for state a loader does not own. */
  onRefresh?: () => void | Promise<void>;
  class?: string;
}) {
  const i18n = useI18n();
  const router = useRouter();

  const [busy, setBusy] = createSignal(false);
  const [at, setAt] = createSignal<Date | null>(null);
  // A signal nothing reads for its value: it exists so the relative stamp below
  // re-renders on a timer rather than freezing at the wording it was first
  // drawn with.
  const [, setTick] = createSignal(0);

  onMount(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    onCleanup(() => clearInterval(timer));
  });

  async function refresh() {
    if (busy()) return;
    setBusy(true);
    try {
      await Promise.all([router.invalidate(), props.onRefresh?.()]);
      setAt(new Date());
    } finally {
      // Whatever happened, the button goes back to being pressable. A failed
      // refresh leaves the previous stamp standing, which is the truth: that is
      // still when this data is from.
      setBusy(false);
    }
  }

  return (
    <div class={cn("flex min-w-0 shrink-0 items-center gap-2", props.class)}>
      <Show when={at()}>
        {(stamp) => (
          <span class="hidden truncate text-caption text-muted-foreground @md-page/page:inline">
            {i18n.t("common.updated_when", { when: i18n.relative(stamp()) })}
          </span>
        )}
      </Show>
      <Button
        variant="outline"
        size={props.withLabel ? "toolbar" : "toolbar-icon"}
        onClick={() => void refresh()}
        disabled={busy()}
        aria-label={i18n.t("common.refresh")}
        title={i18n.t("common.refresh")}
      >
        {/* `animate-spin` only while in flight, so the control says what it is
            doing without a second element appearing beside it. */}
        <RotateCw class={cn("size-4", busy() && "animate-spin")} />
        <Show when={props.withLabel}>{i18n.t("common.refresh")}</Show>
      </Button>
    </div>
  );
}
