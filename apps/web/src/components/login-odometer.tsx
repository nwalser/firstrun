import { Index, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { cn } from "../lib/cn.js";

/**
 * A counter that rolls, digit by digit.
 *
 * Only the positions that actually changed move: 7,016 to 7,017 rolls one
 * column and 7,019 to 7,020 rolls two. That is the whole point of drawing it
 * this way rather than replacing the text, because a number that visibly
 * carries into its next column is a number somebody believes is counting
 * something, and a number that simply becomes a different number is not.
 *
 * ## The two things that are easy to get wrong
 *
 * **The wrap.** A column passing a ten must roll FORWARD onto a second zero
 * rather than spinning backwards through eight glyphs. The strip therefore
 * holds twenty glyphs, 0 to 9 twice: a wrap from 9 to 0 rolls to index 10,
 * which is the same glyph in the second run, and the strip is then reset to
 * index 0 with the transition suppressed for exactly one frame. A strip that is
 * removed mid-transition never fires its `transitionend` and is left showing
 * the duplicate, which is the identical glyph, so the failure is invisible.
 *
 * **Identity.** The digits are rendered RIGHT TO LEFT into a reversed row, so
 * position zero is always the units and a number that gains a digit appends a
 * new position rather than shifting every existing one along. Keyed from the
 * left instead, 999 becoming 1,004 would roll every column at once because each
 * position would suddenly be showing a different digit.
 */

/** 0 to 9 twice. The second run is what a wrap rolls forward onto. */
const GLYPHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function OdoDigit(props: { digit: number; isNew: boolean }) {
  const [index, setIndex] = createSignal(props.digit);
  const [snap, setSnap] = createSignal(false);
  let frame = 0;

  // The previous digit is tracked by the effect rather than by a signal,
  // because it is not something anything renders: it exists only to decide
  // which way this column has to travel.
  createEffect<number>((previous) => {
    const next = props.digit;
    if (next === previous) return previous;
    // Values here only ever climb, so a digit that went DOWN went past a ten.
    // Rolling to `10 + next` lands on the same glyph one full turn forward.
    setIndex(next < previous ? 10 + next : next);
    return next;
  }, props.digit);

  const onTransitionEnd = () => {
    if (index() < 10) return;
    // Suppress the transition, land on the real index, and give it back one
    // frame later. This is the only requestAnimationFrame in the preview.
    setSnap(true);
    setIndex(index() - 10);
    frame = requestAnimationFrame(() => setSnap(false));
  };

  // Guarded, because this runs on the SERVER too.
  //
  // Solid tears the render tree down after SSR and calls every `onCleanup` it
  // finds, and `cancelAnimationFrame` does not exist in Node. Unguarded, this
  // one line threw during cleanup and took the whole dev server process down
  // with it, which reads as the page being broken rather than as one missing
  // global. `frame` is only ever set by a transition that a browser ran, so on
  // the server it is still zero and nothing is called.
  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame);
  });

  return (
    <span class={cn("fr-odo", props.isNew && "fr-odo-new")}>
      <span
        class="fr-odo-strip"
        data-fr-snap={snap() ? "" : undefined}
        style={{ "--fr-d": String(index()) }}
        onTransitionEnd={onTransitionEnd}
      >
        <Index each={GLYPHS}>
          {(glyph) => <span class="block h-8 text-center">{glyph()}</span>}
        </Index>
      </span>
    </span>
  );
}

/**
 * The whole number.
 *
 * `format` is passed in rather than imported so the group separator is the
 * reader's own: a German page reads 105.412 and an English one 105,412, and the
 * separator is drawn as an ordinary glyph between two rolling windows.
 */
export function Odometer(props: {
  value: number;
  format: (value: number) => string;
  class?: string;
}) {
  const tokens = createMemo(() =>
    // Reversed, so index zero is the units column. The row is drawn back to
    // front to put it on the right again.
    [...props.format(props.value)].reverse().map((ch) => ({
      ch,
      digit: ch >= "0" && ch <= "9" ? Number(ch) : null,
    }))
  );

  /**
   * How many positions existed on the first render.
   *
   * Anything beyond this is a column the number grew into, and only those get
   * the entrance animation. Without the check every digit would fade in at once
   * the moment motion turns on, which is the one thing the preview's stylesheet
   * exists to prevent.
   */
  const initialCount = tokens().length;

  return (
    <span class={cn("inline-flex flex-row-reverse items-start tabular-nums", props.class)}>
      <Index each={tokens()}>
        {(token, i) => (
          <Show
            when={token().digit !== null}
            fallback={<span class="inline-block">{token().ch}</span>}
          >
            <OdoDigit digit={token().digit ?? 0} isNew={i >= initialCount} />
          </Show>
        )}
      </Index>
    </span>
  );
}
