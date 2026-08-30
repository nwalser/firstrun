import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { cn } from "../../lib/cn.js";
import { Button, Input, Label, Select, SegmentedControl, Switch, Textarea } from "../ui/index.js";
import {
  AGGREGATE_FNS,
  BUCKET_UNITS,
  ENTRY_COLUMNS,
  MAX_AGGREGATIONS,
  MAX_FILTER_DEPTH,
  MAX_GROUPS,
  MAX_LIMIT,
  OPS_FOR_TYPE,
  VISUALISATIONS,
  discoveredType,
  emptyFilter,
  fieldId,
  fieldType,
  isGroupOp,
  isNumericField,
  operatorArity,
  type AggregateFn,
  type Aggregation,
  type BucketUnit,
  type ComparisonOp,
  type Discovery,
  type EntryColumn,
  type Field,
  type Filter,
  type LogQuery,
  type Scalar,
  type ValueType,
  type Visualisation,
} from "@firstrun/schema/query";
import {
  attributeOptionLabel,
  unsentAttributes,
  unsentNames,
} from "@firstrun/schema/conventions";
import { useI18n } from "../../lib/i18n/index.js";
import { queryLabels } from "../query-labels.js";
import { localTimezone } from "./presets.js";

/**
 * The builder for one saved query.
 *
 * Anything the five parts can express has to be expressible here: a question
 * the product can answer and the customer cannot ask is the failure mode now.
 * So every control below writes into the same AST the compiler reads, and there
 * is no shape a preset can reach that this cannot.
 *
 * It leads with DISCOVERY. Somebody opening this does not necessarily know
 * their own schema: the keys their clients happen to send are a fact about
 * their code that nobody wrote down, so every picker offers what has actually
 * been written in the visible window, with the values that came with it. A key
 * nobody has sent is still typeable, because a filter that matches nothing is a
 * legitimate thing to build, and because discovery is a sample rather than a
 * census.
 */

// ---------------------------------------------------------------------------
// Choosing a field
// ---------------------------------------------------------------------------

/**
 * The separator for a path INTO nested JSON.
 *
 * A dot cannot be it: the OTel semantic conventions are flat dotted names, so
 * `exception.type` is ONE key and splitting on dots would look for an object
 * called `exception` that nothing ever wrote. `>` is excluded from the segment
 * regex, so it can never be part of a key and is unambiguous as a separator.
 */
const PATH_SEPARATOR = " > ";

const parsePath = (text: string): string[] =>
  text
    .split(">")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const CUSTOM = "__custom";

/** The columns that can be read as a number, for a numeric aggregation. */
const NUMERIC_COLUMNS: readonly EntryColumn[] = ["severity", "time", "ingested_at"];

function encodeField(field: Field | null): string {
  return field ? fieldId(field) : "";
}

export function FieldPicker(props: {
  value: Field | null;
  onChange: (field: Field) => void;
  discovery: Discovery;
  /** Only offer what a numeric aggregation can read. */
  numeric?: boolean;
  /** Offer the unique key. Meaningless for a numeric aggregation. */
  allowUnique?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const [custom, setCustom] = createSignal("");
  const [typing, setTyping] = createSignal(false);

  const attributes = () =>
    props.discovery.attributes.filter(
      (attr) => !props.numeric || discoveredType(attr) === "number"
    );

  /*
   * Three kinds of thing in one list, so the list says which is which.
   *
   * A promoted column, a path this project has actually written, and a path
   * out of the conventions it has not written yet are answered by the picker
   * identically -- that is rule 2 -- but they are not the same thing to
   * whoever is choosing. Unheaded, the run from `severity` through
   * `browser.name` through a suggestion nobody has ever sent reads as one
   * arbitrary list, and the difference that matters most (this key has data,
   * that one does not) is the one the flat list hides.
   */
  const options = createMemo(() => {
    const columns = i18n.t("explore.field_group_columns");
    const out: Array<{ value: string; label: string; group?: string }> = [];
    for (const column of ENTRY_COLUMNS) {
      if (props.numeric && !NUMERIC_COLUMNS.includes(column)) continue;
      out.push({ value: `c:${column}`, label: labels.column(column), group: columns });
    }
    // With the columns rather than under a heading of its own: a heading over
    // one row promises a set, and a unique is built out of the promoted
    // columns it sits beside.
    if (props.allowUnique && !props.numeric) {
      out.push({ value: "u:", label: i18n.t("explore.field_unique_option"), group: columns });
    }
    for (const attr of attributes()) {
      out.push({
        value: `a:${attr.key}:${props.numeric ? "number" : "text"}`,
        label: attributeOptionLabel(attr.key),
        group: i18n.t("explore.field_group_attributes"),
      });
    }

    /*
     * Then the conventions this project has not written yet.
     *
     * Discovery leads, because what a project actually sends is the truth about
     * it. But discovery is empty on the day somebody installs the SDK, and an
     * empty picker on that day teaches nothing: the vocabulary we suggest is
     * written down in `conventions.ts` and was reaching nobody. These are
     * suggestions in the same list, and choosing one builds an ordinary filter
     * that matches nothing until the client starts sending it.
     *
     * Not offered to a numeric aggregation: whether a key holds numbers is
     * something only the data can say, and a percentile over a key nobody has
     * sent is a column of nulls presented as a measurement.
     */
    if (!props.numeric) {
      const seen = props.discovery.attributes.map((a) => a.key);
      for (const suggestion of unsentAttributes(seen)) {
        out.push({
          value: `a:${suggestion.key}:text`,
          label: attributeOptionLabel(suggestion.key),
          group: i18n.t("explore.field_group_suggested"),
        });
      }
    }

    // A field the picker has never seen is still a field. Discovery is a
    // sample, and a key nobody sent in the window is a filter that matches
    // nothing rather than an error.
    out.push({ value: CUSTOM, label: i18n.t("explore.field_custom") });
    return out;
  });

  /**
   * The value the select shows.
   *
   * A field whose key is not in the discovered list still has to select
   * something, so it falls through to the custom row with its own path typed
   * in: the alternative is a picker that silently forgets what the card said.
   */
  const selected = createMemo(() => {
    const id = encodeField(props.value);
    if (typing()) return CUSTOM;
    return options().some((o) => o.value === id) ? id : props.value ? CUSTOM : "";
  });

  const currentPath = () =>
    props.value?.kind === "attribute" ? props.value.path.join(PATH_SEPARATOR) : "";

  function choose(value: string) {
    if (value === CUSTOM) {
      setCustom(currentPath());
      setTyping(true);
      return;
    }
    setTyping(false);
    if (value === "u:") return props.onChange({ kind: "unique" });
    if (value.startsWith("c:")) {
      return props.onChange({ kind: "column", column: value.slice(2) as EntryColumn });
    }
    const rest = value.slice(2);
    const cut = rest.lastIndexOf(":");
    const key = rest.slice(0, cut);
    props.onChange({
      kind: "attribute",
      path: [key],
      ...(props.numeric ? { as: "number" as const } : {}),
    });
  }

  function commitCustom() {
    const path = parsePath(custom());
    if (path.length === 0) return;
    setTyping(false);
    props.onChange({
      kind: "attribute",
      path,
      ...(props.numeric ? { as: "number" as const } : {}),
    });
  }

  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <Select
        value={selected()}
        options={options()}
        onChange={choose}
        disabled={props.disabled}
        placeholder={props.placeholder ?? i18n.t("explore.field_placeholder")}
        aria-label={i18n.t("explore.field_label")}
      />
      <Show when={typing() || (props.value?.kind === "attribute" && selected() === CUSTOM)}>
        <div class="flex items-center gap-2">
          <Input
            value={typing() ? custom() : currentPath()}
            placeholder={`exception.type${PATH_SEPARATOR}0`}
            disabled={props.disabled}
            onFocus={() => {
              if (!typing()) {
                setCustom(currentPath());
                setTyping(true);
              }
            }}
            onInput={(e) => setCustom(e.currentTarget.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCustom();
              }
            }}
          />
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** The values this key was actually seen holding, for the input to offer. */
function samplesFor(discovery: Discovery, field: Field | null): string[] {
  if (!field) return [];
  if (field.kind === "column" && field.column === "name") {
    // What the project sends, then the names we suggest it could. A project
    // with no entries yet gets the conventional list rather than an empty
    // datalist, which is the one moment somebody is deciding what to call
    // things.
    const sent = discovery.names.map((n) => n.name);
    const suggested = unsentNames(sent).map((n) => n.name);
    return [...sent, ...suggested].slice(0, 16);
  }
  if (field.kind !== "attribute" || field.path.length !== 1) return [];
  return discovery.attributes.find((a) => a.key === field.path[0])?.samples ?? [];
}

const coerce = (text: string, type: ValueType): Scalar => {
  if (type === "number" || type === "severity") {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (type === "boolean") return text === "true";
  return text;
};

function ValueInput(props: {
  op: ComparisonOp;
  field: Field | null;
  value: Scalar | undefined;
  values: Scalar[] | undefined;
  onValue: (value: Scalar) => void;
  onValues: (values: Scalar[]) => void;
  discovery: Discovery;
  disabled?: boolean;
}) {
  const i18n = useI18n();
  const type = () => (props.field ? fieldType(props.field) : "text");
  const arity = () => operatorArity(props.op);
  const samples = () => samplesFor(props.discovery, props.field);

  return (
    <Show when={arity() !== "none"}>
      <div class="flex min-w-0 flex-col gap-1.5">
        <Show
          when={arity() === "many"}
          fallback={
            <Input
              value={props.value === null || props.value === undefined ? "" : String(props.value)}
              placeholder={i18n.t("explore.value_placeholder")}
              disabled={props.disabled}
              onInput={(e) => props.onValue(coerce(e.currentTarget.value, type()))}
            />
          }
        >
          <Textarea
            autoResize
            maxRows={6}
            placeholder={i18n.t("explore.values_placeholder")}
            disabled={props.disabled}
            value={(props.values ?? []).map((v) => (v === null ? "" : String(v))).join("\n")}
            onInput={(e) =>
              props.onValues(
                e.currentTarget.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0)
                  .map((line) => coerce(line, type()))
              )
            }
          />
        </Show>

        {/*
          What this key was actually seen holding. A person who does not know
          their own vocabulary can click one instead of guessing at it, which is
          the entire point of discovering attributes rather than declaring them.
        */}
        <Show when={samples().length > 0}>
          <div class="flex flex-wrap gap-1">
            <For each={samples().slice(0, 8)}>
              {(sample) => (
                <button
                  type="button"
                  disabled={props.disabled}
                  // Transitioned like every other control in this drawer: the
                  // input these sit under, the select beside it and the buttons
                  // below all ease their colours, so a chip that snaps is the
                  // one thing in the row that behaves differently.
                  class={cn(
                    "max-w-[12rem] truncate rounded-md bg-muted px-1.5 py-0.5",
                    "text-label-13 text-muted-foreground transition-colors",
                    "hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  )}
                  title={sample}
                  onClick={() =>
                    arity() === "many"
                      ? props.onValues([...(props.values ?? []), coerce(sample, type())])
                      : props.onValue(coerce(sample, type()))
                  }
                >
                  {sample}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// The filter tree
// ---------------------------------------------------------------------------

const leafField = (filter: Filter): Field | null =>
  "field" in filter ? filter.field : null;

/** A leaf keeps its field and its operator when either changes, where it can. */
function retarget(filter: Filter, field: Field): Filter {
  const ops = OPS_FOR_TYPE[fieldType(field)];
  const op = "op" in filter && ops.includes(filter.op as ComparisonOp)
    ? (filter.op as ComparisonOp)
    : (ops[0] as ComparisonOp);
  return withOp({ ...filter, field } as Filter, op);
}

/**
 * The same condition under a different operator.
 *
 * The value is carried across where the new operator can hold it, because
 * changing "is" to "is one of" and losing what you had typed is the kind of
 * small betrayal that makes people build the filter somewhere else.
 */
function withOp(filter: Filter, op: ComparisonOp): Filter {
  const field = leafField(filter) ?? { kind: "column" as const, column: "name" as const };
  const one = "value" in filter ? filter.value : undefined;
  const many = "values" in filter ? filter.values : undefined;
  const first = many?.[0];

  switch (operatorArity(op)) {
    case "none":
      return { op: op as "exists" | "not_exists", field };
    case "many":
      return {
        op: op as "in" | "not_in",
        field,
        values: many ?? (one === undefined ? [] : [one]),
      };
    default: {
      const value = one ?? first ?? "";
      if (op === "lt" || op === "lte" || op === "gt" || op === "gte") {
        return { op, field, value: typeof value === "number" ? value : String(value ?? "") };
      }
      if (op === "contains" || op === "starts_with" || op === "ends_with") {
        return { op, field, value: String(value ?? "") };
      }
      return { op: op as "eq" | "ne", field, value: value ?? null };
    }
  }
}

const newCondition = (): Filter => ({
  op: "eq",
  field: { kind: "column", column: "name" },
  value: "",
});

function FilterNode(props: {
  filter: Filter;
  depth: number;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: Filter) => void;
  onRemove?: () => void;
}) {
  return (
    <Show
      when={isGroupOp(props.filter.op) ? (props.filter as Extract<Filter, { op: "and" }>) : null}
      fallback={
        <FilterCondition
          filter={props.filter}
          discovery={props.discovery}
          disabled={props.disabled}
          onChange={props.onChange}
          onRemove={props.onRemove}
        />
      }
    >
      {(group) => (
        <FilterGroup
          group={group()}
          depth={props.depth}
          discovery={props.discovery}
          disabled={props.disabled}
          onChange={props.onChange}
          onRemove={props.onRemove}
        />
      )}
    </Show>
  );
}

function FilterGroup(props: {
  group: { op: "and" | "or"; filters: Filter[] };
  depth: number;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: Filter) => void;
  onRemove?: () => void;
}) {
  const i18n = useI18n();
  const children = () => props.group.filters;

  const replace = (index: number, next: Filter) =>
    props.onChange({
      ...props.group,
      filters: children().map((child, i) => (i === index ? next : child)),
    });

  const remove = (index: number) =>
    props.onChange({ ...props.group, filters: children().filter((_, i) => i !== index) });

  const append = (child: Filter) =>
    props.onChange({ ...props.group, filters: [...children(), child] });

  return (
    <div
      class={cn(
        "flex min-w-0 flex-col gap-2",
        props.depth > 0 && "rounded-md border border-dashed p-2"
      )}
    >
      <div class="flex items-center gap-2">
        <SegmentedControl
          value={props.group.op}
          disabled={props.disabled}
          options={[
            { value: "and", label: i18n.t("explore.all_of") },
            { value: "or", label: i18n.t("explore.any_of") },
          ]}
          onChange={(op) => props.onChange({ ...props.group, op })}
        />
        <span class="text-caption text-muted-foreground">
          {children().length === 0
            ? props.group.op === "and"
              ? i18n.t("explore.no_constraint")
              : i18n.t("explore.matches_nothing")
            : i18n.t("explore.conditions", { count: children().length })}
        </span>
        <div class="flex-1" />
        <Show when={props.onRemove}>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            aria-label={i18n.t("explore.remove_group")}
            onClick={() => props.onRemove?.()}
          >
            <X />
          </Button>
        </Show>
      </div>

      <For each={children()}>
        {(child, index) => (
          <FilterNode
            filter={child}
            depth={props.depth + 1}
            discovery={props.discovery}
            disabled={props.disabled}
            onChange={(next) => replace(index(), next)}
            onRemove={() => remove(index())}
          />
        )}
      </For>

      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={props.disabled}
          onClick={() => append(newCondition())}
        >
          <Plus />
          {i18n.t("explore.add_condition")}
        </Button>
        <Show when={props.depth + 1 < MAX_FILTER_DEPTH - 1}>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.disabled}
            onClick={() => append(emptyFilter())}
          >
            <Plus />
            {i18n.t("explore.add_group")}
          </Button>
        </Show>
      </div>
    </div>
  );
}

function FilterCondition(props: {
  filter: Filter;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: Filter) => void;
  onRemove?: () => void;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const field = () => leafField(props.filter);
  const type = (): ValueType => (field() ? fieldType(field()!) : "text");
  const ops = () =>
    OPS_FOR_TYPE[type()].map((op) => ({ value: op, label: labels.operator(op) }));

  return (
    <div class="flex min-w-0 items-start gap-2 rounded-md bg-muted/40 p-2">
      <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,1fr)]">
        <FieldPicker
          value={field()}
          discovery={props.discovery}
          disabled={props.disabled}
          onChange={(next) => props.onChange(retarget(props.filter, next))}
        />
        <Select
          value={props.filter.op as ComparisonOp}
          options={ops()}
          disabled={props.disabled}
          onChange={(op) => props.onChange(withOp(props.filter, op))}
          aria-label={i18n.t("explore.operator_label")}
        />
        <ValueInput
          op={props.filter.op as ComparisonOp}
          field={field()}
          value={"value" in props.filter ? props.filter.value : undefined}
          values={"values" in props.filter ? props.filter.values : undefined}
          discovery={props.discovery}
          disabled={props.disabled}
          onValue={(value) =>
            props.onChange({ ...(props.filter as { op: "eq" }), value } as Filter)
          }
          onValues={(values) =>
            props.onChange({ ...(props.filter as { op: "in" }), values } as Filter)
          }
        />
      </div>
      <Show when={props.onRemove}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          aria-label={i18n.t("explore.remove_condition")}
          onClick={() => props.onRemove?.()}
        >
          <X />
        </Button>
      </Show>
    </div>
  );
}

/** The root is always a group, so there is always somewhere to add the first row. */
export function FilterEditor(props: {
  filter: Filter | undefined;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: Filter) => void;
}) {
  const root = (): Filter => {
    const current = props.filter;
    if (!current) return emptyFilter();
    return isGroupOp(current.op) ? current : { op: "and", filters: [current] };
  };

  return (
    <FilterNode
      filter={root()}
      depth={0}
      discovery={props.discovery}
      disabled={props.disabled}
      onChange={props.onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

function Section(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col gap-0.5">
        <Label>{props.label}</Label>
        <Show when={props.hint}>
          <span class="text-caption text-muted-foreground">{props.hint}</span>
        </Show>
      </div>
      {props.children}
    </div>
  );
}

const NO_BUCKET = "none";

/** The aggregations that read a field, and the one that does not. */
const needsField = (fn: AggregateFn) => fn !== "count";

function AggregationRow(props: {
  aggregation: Aggregation;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: Aggregation) => void;
  onRemove?: () => void;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  const fnOptions = () =>
    AGGREGATE_FNS.map((fn) => ({ value: fn, label: labels.aggregateFn(fn) }));
  const numeric = () => {
    const fn = props.aggregation.fn;
    return fn === "sum" || fn === "avg" || fn === "min" || fn === "max" || fn === "percentile";
  };
  const field = (): Field | null =>
    "field" in props.aggregation ? props.aggregation.field : null;

  /**
   * Changing the function keeps the field where the new function can read it.
   *
   * A numeric aggregation needs the attribute read as a number, so the switch
   * from "count of distinct" to "average" rewrites the reading rather than
   * refusing: a leaf that turns out to hold text yields null and is skipped,
   * which is the honest answer for a row that measured nothing.
   */
  function changeFn(fn: AggregateFn) {
    if (fn === "count") return props.onChange({ fn });
    const current = field();
    const asNumber =
      fn === "count_distinct"
        ? current
        : current && current.kind === "attribute"
          ? { ...current, as: "number" as const }
          : current;
    const chosen: Field = asNumber ??
      (fn === "count_distinct"
        ? { kind: "unique" }
        : { kind: "column", column: "severity" });
    if (fn === "percentile") return props.onChange({ fn, field: chosen, p: 0.95 });
    if (fn === "count_distinct") return props.onChange({ fn, field: chosen });
    props.onChange({ fn, field: chosen });
  }

  return (
    <div class="flex min-w-0 items-start gap-2">
      <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
        <Select
          value={props.aggregation.fn}
          options={fnOptions()}
          disabled={props.disabled}
          onChange={changeFn}
          aria-label={i18n.t("explore.aggregation_label")}
        />
        <Show when={needsField(props.aggregation.fn)}>
          <FieldPicker
            value={field()}
            discovery={props.discovery}
            disabled={props.disabled}
            numeric={numeric()}
            allowUnique={props.aggregation.fn === "count_distinct"}
            onChange={(next) => {
              const agg = props.aggregation;
              if (agg.fn === "percentile") props.onChange({ ...agg, field: next });
              else if ("field" in agg) props.onChange({ ...agg, field: next });
            }}
          />
        </Show>
        <Show when={props.aggregation.fn === "percentile"}>
          <div class="flex items-center gap-2">
            <Label class="shrink-0 text-caption text-muted-foreground">
              {i18n.t("explore.percentile")}
            </Label>
            <Input
              type="number"
              min="1"
              max="99"
              disabled={props.disabled}
              value={Math.round(
                (props.aggregation.fn === "percentile" ? props.aggregation.p : 0.95) * 100
              )}
              onInput={(e) => {
                const agg = props.aggregation;
                if (agg.fn !== "percentile") return;
                const n = Number(e.currentTarget.value);
                if (!Number.isFinite(n)) return;
                props.onChange({ ...agg, p: Math.min(99, Math.max(1, n)) / 100 });
              }}
            />
          </div>
        </Show>
      </div>
      <Show when={props.onRemove}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          aria-label={i18n.t("explore.remove_measure")}
          onClick={() => props.onRemove?.()}
        >
          <X />
        </Button>
      </Show>
    </div>
  );
}

export function QueryBuilder(props: {
  query: LogQuery;
  viz: Visualisation;
  discovery: Discovery;
  disabled?: boolean;
  onChange: (next: { query: LogQuery; viz: Visualisation }) => void;
}) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);

  const patch = (changes: Partial<LogQuery>) =>
    props.onChange({ query: { ...props.query, ...changes }, viz: props.viz });

  const groups = () => props.query.groupBy ?? [];
  const problem = () => labels.vizProblem(props.viz, props.query);

  /**
   * A limit exists so a group by on a high-cardinality path is bounded, and a
   * query with no group by returns one row whatever the limit says. Showing the
   * control anyway would be a knob that does nothing.
   */
  const limitApplies = () => groups().length > 0;

  return (
    <div class="flex flex-col gap-5">
      <Section label={i18n.t("explore.section_viz")}>
        <div class="flex flex-col gap-1.5">
          <Select
            value={props.viz}
            options={VISUALISATIONS.map((v) => ({ value: v, label: labels.visualisation(v) }))}
            disabled={props.disabled}
            onChange={(viz) => props.onChange({ query: props.query, viz })}
            aria-label={i18n.t("explore.viz_label")}
          />
          {/*
            A chart type that cannot honestly draw this query says why rather
            than being greyed out. The difference between a disabled control and
            a broken one is a sentence.
          */}
          <Show when={problem()}>
            <span class="text-caption text-warning">{problem()}</span>
          </Show>
        </div>
      </Section>

      <Section
        label={i18n.t("explore.section_measure")}
        hint={i18n.t("explore.section_measure_hint")}
      >
        <div class="flex flex-col gap-2">
          <For each={props.query.aggregations}>
            {(aggregation, index) => (
              <AggregationRow
                aggregation={aggregation}
                discovery={props.discovery}
                disabled={props.disabled}
                onChange={(next) =>
                  patch({
                    aggregations: props.query.aggregations.map((a, i) =>
                      i === index() ? next : a
                    ),
                  })
                }
                onRemove={
                  props.query.aggregations.length > 1
                    ? () =>
                        patch({
                          aggregations: props.query.aggregations.filter((_, i) => i !== index()),
                        })
                    : undefined
                }
              />
            )}
          </For>
          <Show when={props.query.aggregations.length < MAX_AGGREGATIONS}>
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.disabled}
                onClick={() =>
                  patch({ aggregations: [...props.query.aggregations, { fn: "count" }] })
                }
              >
                <Plus />
                {i18n.t("explore.add_measure")}
              </Button>
            </div>
          </Show>
        </div>
      </Section>

      <Section label={i18n.t("explore.filter")} hint={i18n.t("explore.section_filter_hint")}>
        <FilterEditor
          filter={props.query.filter}
          discovery={props.discovery}
          disabled={props.disabled}
          onChange={(filter) => patch({ filter })}
        />
      </Section>

      <Section
        label={i18n.t("explore.group_by")}
        hint={i18n.t("explore.section_group_hint")}
      >
        <div class="flex flex-col gap-2">
          <For each={groups()}>
            {(field, index) => (
              <div class="flex min-w-0 items-start gap-2">
                <div class="min-w-0 flex-1">
                  <FieldPicker
                    value={field}
                    discovery={props.discovery}
                    disabled={props.disabled}
                    allowUnique
                    onChange={(next) =>
                      patch({ groupBy: groups().map((f, i) => (i === index() ? next : f)) })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.disabled}
                  aria-label={i18n.t("explore.remove_group")}
                  onClick={() =>
                    patch({
                      groupBy: groups().filter((_, i) => i !== index()),
                      // An order pointing at a group that no longer exists is
                      // the compiler's error, so it goes with the group.
                      orderBy: (props.query.orderBy ?? []).filter(
                        (o) => !("group" in o.key) || o.key.group < groups().length - 1
                      ),
                    })
                  }
                >
                  <X />
                </Button>
              </div>
            )}
          </For>
          <Show when={groups().length < MAX_GROUPS}>
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.disabled}
                onClick={() =>
                  patch({
                    groupBy: [...groups(), { kind: "column", column: "name" }],
                    orderBy:
                      props.query.orderBy ?? [{ key: { aggregate: 0 }, direction: "desc" }],
                    withTotal: true,
                    // A filled series cannot also be grouped or totalled, and
                    // this sets both. The switch below stops being offered at
                    // the same moment, so leaving the flag on left a query
                    // nobody could turn off and the compiler refused for the
                    // whole board.
                    fill: false,
                  })
                }
              >
                <Plus />
                {i18n.t("explore.add_group")}
              </Button>
            </div>
          </Show>
        </div>
      </Section>

      <Section
        label={i18n.t("explore.time_bucket")}
        hint={i18n.t("explore.section_bucket_hint")}
      >
        <div class="flex flex-col gap-2">
          <Select
            value={props.query.bucket?.unit ?? NO_BUCKET}
            options={[
              { value: NO_BUCKET, label: i18n.t("explore.bucket_none") },
              ...BUCKET_UNITS.map((unit) => ({ value: unit, label: labels.bucket(unit) })),
            ]}
            disabled={props.disabled}
            aria-label={i18n.t("explore.time_bucket")}
            onChange={(unit) =>
              unit === NO_BUCKET
                ? patch({ bucket: undefined, fill: false })
                : patch({
                    bucket: {
                      unit: unit as BucketUnit,
                      timezone: props.query.bucket?.timezone ?? localTimezone(),
                    },
                  })
            }
          />
          <Show when={props.query.bucket}>
            {(bucket) => (
              <>
                <span class="text-caption text-muted-foreground">
                  {i18n.t("explore.bucket_timezone", { zone: bucket().timezone })}
                </span>
                <Show when={groups().length === 0 && !props.query.withTotal}>
                  <Switch
                    checked={props.query.fill ?? false}
                    label={i18n.t("explore.fill_label")}
                    description={i18n.t("explore.fill_hint")}
                    onChange={(fill) => patch({ fill })}
                  />
                </Show>
              </>
            )}
          </Show>
        </div>
      </Section>

      <Show when={limitApplies()}>
        <Section label={i18n.t("explore.limit")} hint={i18n.t("explore.section_limit_hint")}>
          <Input
            type="number"
            min="1"
            max={MAX_LIMIT}
            disabled={props.disabled}
            value={props.query.limit ?? 10}
            onInput={(e) => {
              const n = Number(e.currentTarget.value);
              if (!Number.isInteger(n) || n < 1) return;
              patch({ limit: Math.min(MAX_LIMIT, n) });
            }}
          />
        </Section>
      </Show>
    </div>
  );
}

/**
 * How a query reads as one line, for a card header or a preset row.
 *
 * One key with the whole sentence in it. This used to be built by joining three
 * English fragments ("entries", " by ", " per day"), which is exactly the shape
 * that cannot be translated: German puts the parts in a different order and a
 * joined string has no order to give it.
 */
export function QuerySummary(props: { query: LogQuery }) {
  const i18n = useI18n();
  const labels = queryLabels(i18n);
  return (
    <span class="truncate text-caption text-muted-foreground">
      {labels.describe(props.query)}
    </span>
  );
}

/** Whether a field can carry a numeric aggregation, for a picker's own guard. */
export const acceptsNumericAggregate = isNumericField;
