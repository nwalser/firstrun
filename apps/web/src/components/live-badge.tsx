import { Show } from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * That a surface is measuring itself, said once, in the toolbar.
 *
 * There is no refresh button anywhere in this product. A board is a window onto
 * something still happening, and a number you have to ask for is a number
 * somebody forgets to ask for, so every surface that shows one re-reads itself
 * on a timer. What belongs in the chrome is the fact that it does, not a
 * control to make it.
 *
 * A statement rather than a control, which is why it is a caption and not a
 * button: there is nothing to press and nothing to decide. The dot is the whole
 * of it at a glance and the exact age is on the `title`, because "updated 40
 * seconds ago" printed in a toolbar is a number that changes every half minute
 * in the corner of somebody's eye.
 *
 * It goes quiet when the surface has deliberately stopped listening -- a board
 * being arranged, a save in flight -- because a live dot pulsing over something
 * that is not refetching is the one thing this badge must not say.
 *
 * In its own module so it can be used from a page that has no query builder on
 * it. Imported out of `dashboard.tsx` it would drag the explore panel, the
 * filter editor and the whole builder into that page's client bundle.
 */
export function LiveBadge(props: { at: Date; now: Date; paused: boolean }) {
  const i18n = useI18n();
  return (
    <span
      class={cn(
        "flex h-control-md shrink-0 items-center gap-1.5 px-1",
        "text-label-13 text-muted-foreground"
      )}
      title={
        props.paused
          ? i18n.t("dashboard.live_paused")
          : i18n.t("dashboard.live_title", { when: i18n.relative(props.at, props.now) })
      }
    >
      <span class="relative flex size-1.5 shrink-0">
        {/* The halo pulses, not the dot: a dot that changes size is a dot that
            moves the word beside it every two seconds. */}
        <Show when={!props.paused}>
          <span
            aria-hidden="true"
            class="absolute inline-flex h-full w-full rounded-full bg-positive opacity-75 motion-safe:animate-ping"
          />
        </Show>
        <span
          aria-hidden="true"
          class={cn(
            "relative inline-flex size-1.5 rounded-full",
            props.paused ? "bg-muted-foreground" : "bg-positive"
          )}
        />
      </span>
      {i18n.t("dashboard.live")}
    </span>
  );
}

/**
 * How often a live surface re-reads itself.
 *
 * Thirty seconds: fast enough that a board left on a wall is current, slow
 * enough that one open all afternoon is a couple of hundred measurements rather
 * than tens of thousands. Stated here rather than per page so two live surfaces
 * cannot drift into two different ideas of what "live" means.
 */
export const LIVE_INTERVAL_MS = 30_000;
