import type { DateRange } from "@firstrun/schema";
import { Link } from "@tanstack/solid-router";
import BookOpen from "lucide-solid/icons/book-open";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { runQueryFn } from "../../lib/api.js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../lib/i18n/index.js";
import { buttonVariants, Spinner } from "../ui/index.js";
import { VisualisationBody } from "../widgets.js";
import { QueryBuilder } from "./builder.js";
import {
  queryKey,
  type Discovery,
  type LogQuery,
  type QueryResult,
  type Visualisation,
} from "@firstrun/schema/query";

/**
 * The query builder with its answer beside it.
 *
 * The point of putting the two together is that nobody can hold an AST in their
 * head: a filter is right when the number under it looks right, and that is a
 * loop somebody runs a dozen times to build one card. So every edit re-runs the
 * query, debounced, and the answer is drawn by the SAME components a card on a
 * board uses. What you tune here is what you get there.
 */

/** Long enough to swallow a keystroke, short enough to feel like a preview. */
const PREVIEW_DEBOUNCE_MS = 350;

export function QueryPreview(props: {
  workspace: string;
  project: string;
  query: LogQuery;
  viz: Visualisation;
  range: DateRange;
}) {
  const i18n = useI18n();
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);

  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  /**
   * Every answer is stamped with the key of the query that asked for it, and a
   * late reply whose key is no longer the current one is dropped.
   *
   * Without that, a slow query started three edits ago lands after a fast one
   * started since and paints the wrong number under the right filter. The key
   * is derived from the query rather than a counter, so two edits that cancel
   * each other out do not produce a stale flash either.
   */
  let wanted = "";

  createEffect(() => {
    const query = props.query;
    const range = props.range;
    const key = queryKey(query);
    wanted = key;

    clearTimeout(timer);
    setRunning(true);
    timer = setTimeout(async () => {
      const answer = await runQueryFn({
        data: { workspace: props.workspace, project: props.project, query, range },
      });
      if (wanted !== key) return;
      setRunning(false);
      if (answer.ok) {
        setResult(answer.result);
        setError(null);
      } else {
        setError(answer.error);
      }
    }, PREVIEW_DEBOUNCE_MS);
  });

  return (
    <div class="flex min-h-0 flex-col gap-2">
      <div class="flex items-center justify-between gap-2 text-caption text-muted-foreground">
        <Show when={result()} fallback={<span>{i18n.t("explore.running")}</span>}>
          {(answer) => (
            <span class="truncate">
              {i18n.dateRange(answer().from, answer().to)} ·{" "}
              {i18n.t("explore.rows", { count: answer().rows.length })}
            </span>
          )}
        </Show>
        <Show when={running()}>
          <Spinner class="size-3.5" />
        </Show>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {message()}
          </div>
        )}
      </Show>

      {/* An application surface: 6px of radius and the hairline as a ring, not
          a border. Pairing the two would draw two edges a pixel apart. */}
      <div class={cn("min-h-[14rem] rounded-md p-3 shadow-2xs", error() && "opacity-50")}>
        <Show when={result()}>
          {(answer) => (
            <VisualisationBody viz={props.viz} query={props.query} rows={answer().rows} />
          )}
        </Show>
      </div>
    </div>
  );
}

/**
 * What to look at before anything has arrived.
 *
 * A blank builder asks somebody to name a key their own code has never sent. A
 * project with no entries in the window is far more likely to be a project
 * whose client is not installed, or installed and not reporting, than one whose
 * query is wrong, so the empty state answers that question instead.
 */
export function NothingSentYet(props: { sourceId?: string | null; class?: string }) {
  const i18n = useI18n();
  return (
    <div class={cn("rounded-md bg-muted/20 p-4 shadow-2xs", props.class)}>
      <div class="flex items-center gap-2 text-sm font-medium">
        <BookOpen class="size-4 text-muted-foreground" />
        {i18n.t("explore.nothing_title")}
      </div>
      <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {i18n.t("explore.nothing_body")}
      </p>
      <Link
        to="/wiki/$topic"
        params={{ topic: "log-entries" }}
        search={props.sourceId ? { source: props.sourceId } : {}}
        class={cn(buttonVariants({ size: "sm" }), "mt-3.5")}
      >
        {i18n.t("explore.nothing_cta")}
      </Link>
      <p class="mt-2 text-xs text-muted-foreground">{i18n.t("explore.nothing_widen")}</p>
    </div>
  );
}

/**
 * The whole thing: build a query, watch it answer.
 *
 * `discovery` is what this project has actually written, and it is what makes
 * this usable by somebody who does not know their own schema. When it is empty
 * the builder is replaced rather than merely annotated: a form nobody can fill
 * in is worse than an instruction.
 */
export function ExplorePanel(props: {
  workspace: string;
  project: string;
  range: DateRange;
  discovery: Discovery;
  query: LogQuery;
  /**
   * What the preview actually runs: the card's query with the board's frame and
   * permanent filter folded in, exactly as the card itself will run it.
   *
   * Separate from `query` because the BUILDER edits the card's own query and
   * must not be shown the board's conditions as if they were the card's. The
   * preview without this ignored the board's test-mode frame, so a drawer open
   * over a production board would count test entries and disagree with the card
   * two inches behind it. Defaults to `query` for a caller with no board.
   */
  previewQuery?: LogQuery;
  viz: Visualisation;
  disabled?: boolean;
  /** Preselects this source in the install guide the empty state links to. */
  sourceId?: string | null;
  onChange: (next: { query: LogQuery; viz: Visualisation }) => void;
}) {
  const nothing = () =>
    props.discovery.names.length === 0 && props.discovery.attributes.length === 0;

  return (
    <div class="flex flex-col gap-5">
      <Show when={nothing()}>
        <NothingSentYet sourceId={props.sourceId} />
      </Show>

      <QueryPreview
        workspace={props.workspace}
        project={props.project}
        query={props.previewQuery ?? props.query}
        viz={props.viz}
        range={props.range}
      />

      <QueryBuilder
        query={props.query}
        viz={props.viz}
        discovery={props.discovery}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </div>
  );
}
