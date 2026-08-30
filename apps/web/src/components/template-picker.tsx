import { DASHBOARD_TEMPLATES, type DashboardTemplate } from "@firstrun/schema";
import { For, Show } from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { RadioCard, RadioGroup } from "./ui/index.js";

/**
 * Picking a starting board.
 *
 * Each card carries a sketch of the layout it will produce, drawn from the
 * template's own widget geometry rather than from a hand-maintained picture:
 * every widget already has real `x/y/w/h`, so the thumbnail cannot drift away
 * from the board it promises. A template you cannot see is a template nobody
 * picks -- and "Website" and "App health" mean nothing until you can tell that
 * one is four tiles over a chart and the other is two big tables.
 */

interface Sketch {
  /** The template's own bounding box, so the thumbnail keeps its proportions. */
  width: number;
  height: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

/**
 * Half the grid gap, taken off every side of every card.
 *
 * A 1280-wide board drawn 64px wide is scaled by about 1:20, which turns the
 * 20px gutter between two cards into one pixel. The handoff board is five
 * separate `funnel_step` cards in a row now rather than one wide `funnel`
 * widget, and at that scale they close ranks into a single bar -- a sketch that
 * shows the opposite of what the board does. Widening every gutter by the same
 * amount keeps the arrangement honest while making the seams survive the
 * scale-down; positions are untouched.
 */
const GUTTER = 10;

/**
 * Built once, at module load, rather than per render.
 *
 * `build()` allocates a whole layout, and the catalogue is static -- redoing it
 * on every keystroke in the name field above would be pure waste.
 */
const SKETCHES: Record<string, Sketch> = {};
for (const template of DASHBOARD_TEMPLATES) {
  const widgets = template.build().widgets;
  SKETCHES[template.key] = {
    width: Math.max(1, ...widgets.map((w) => w.x + w.w)),
    height: Math.max(1, ...widgets.map((w) => w.y + w.h)),
    // Inset rather than shrunk toward a centre: the bounding box above is the
    // real one, so the box a card sits in is still where the board puts it.
    rects: widgets.map((w) => ({
      x: w.x + GUTTER,
      y: w.y + GUTTER,
      w: Math.max(1, w.w - GUTTER * 2),
      h: Math.max(1, w.h - GUTTER * 2),
    })),
  };
}

/**
 * The `style` below is not a stylistic choice.
 *
 * `RadioCard` wraps whatever it is handed as an icon in a span carrying an
 * arbitrary descendant variant that sizes every `svg` under it to 20px. That
 * selector outranks a plain size utility on the element itself -- a class and a
 * type against a single class -- so the sketch would be squeezed into a corner
 * of its own frame. An inline declaration beats both, and cannot be lost to a
 * change in stylesheet order.
 */
const FILL = { width: "100%", height: "100%" } as const;

/** The layout at thumbnail scale: grey blocks where the cards will be. */
export function TemplateSketch(props: { templateKey: string; class?: string }) {
  const sketch = () => SKETCHES[props.templateKey];

  return (
    <div
      class={cn(
        "flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-muted/40 p-[3px]",
        props.class
      )}
      aria-hidden="true"
    >
      <Show when={sketch()} fallback={<EmptyCanvas />}>
        {(s) => (
          <Show when={s().rects.length > 0} fallback={<EmptyCanvas />}>
            <svg
              viewBox={`0 0 ${s().width} ${s().height}`}
              preserveAspectRatio="xMidYMid meet"
              style={FILL}
            >
              <For each={s().rects}>
                {(r) => (
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    rx={14}
                    class="fill-muted-foreground/40"
                  />
                )}
              </For>
            </svg>
          </Show>
        )}
      </Show>
    </div>
  );
}

/**
 * What "Blank" looks like.
 *
 * Drawn deliberately rather than left to render as nothing: a thumbnail that is
 * an empty frame reads as a picture that failed to load, and the one template
 * whose whole point is that it starts empty is exactly the one that must not
 * look broken.
 */
function EmptyCanvas() {
  return (
    <svg viewBox="0 0 64 44" preserveAspectRatio="xMidYMid meet" style={FILL}>
      <rect
        x="2"
        y="2"
        width="60"
        height="40"
        rx="4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-dasharray="5 4"
        class="text-muted-foreground/50"
      />
      <path
        d="M32 15v14M25 22h14"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        class="text-muted-foreground/60"
      />
    </svg>
  );
}

/**
 * What each template is called, by its key.
 *
 * The catalogue in `packages/schema` carries an English `name` and
 * `description`, which is the right place for neither: the schema is the
 * contract and has no business holding display copy. A record of literals here
 * keeps `t` seeing keys from its closed union, and a template whose key is not
 * in this map falls back on the schema's English rather than rendering nothing.
 */
const TEMPLATE_TEXT: Record<string, { name: SimpleKey; hint: SimpleKey }> = {
  overview: { name: "templates.overview", hint: "templates.overview_hint" },
  web: { name: "templates.website", hint: "templates.website_hint" },
  app: { name: "templates.app_health", hint: "templates.app_health_hint" },
  blank: { name: "templates.blank", hint: "templates.blank_hint" },
};

export function TemplatePicker(props: {
  value: string;
  onChange: (key: string) => void;
  class?: string;
}) {
  const i18n = useI18n();

  /*
    Every template, because a source has no kind to narrow them by. The website
    board on a project with only a desktop source draws empty cards, which is a
    truthful answer to "what does this template look like on my data" and a
    cheaper one to recover from than a template the customer cannot find.
  */
  const templates = (): DashboardTemplate[] => DASHBOARD_TEMPLATES;

  return (
    <RadioGroup
      value={props.value}
      onChange={props.onChange}
      class={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", props.class)}
    >
      <For each={templates()}>
        {(template) => {
          // Looked up once per card, but translated inside the prop, which is a
          // getter: the words are still re-read when the language changes.
          const text = TEMPLATE_TEXT[template.key];
          return (
            <RadioCard
              value={template.key}
              label={text ? i18n.t(text.name) : template.name}
              description={text ? i18n.t(text.hint) : template.description}
              icon={<TemplateSketch templateKey={template.key} />}
            />
          );
        }}
      </For>
    </RadioGroup>
  );
}
