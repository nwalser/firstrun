import {
  children,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  Show,
  splitProps,
  useContext,
  type ComponentProps,
  type JSX,
} from "solid-js";
import { cn } from "../../lib/cn.js";
import { Label } from "./input.js";

/**
 * The form row: a label, one control, an optional description, an optional
 * error. Every route rebuilt this by hand, which meant every route decided for
 * itself whether the label actually pointed at the control, and mostly it did
 * not.
 *
 * There are two ways to write one, and both are supported on purpose:
 *
 *   <Field label="Name" description="…" error={error()}><Input /></Field>
 *
 *   <Field>
 *     <FieldLabel for="name">Name</FieldLabel>
 *     <Input id="name" />
 *     <FieldDescription>…</FieldDescription>
 *   </Field>
 *
 * The first wires itself; the second is for rows that need something in
 * between. What the wiring actually does, spelled out here rather than left to
 * be discovered: `Field` resolves its children with Solid's `children()` helper
 * and, when they resolve to exactly one element, gives it an `id` and sets
 * `aria-describedby`, `aria-invalid` and `aria-required`. An id the element
 * already carries is adopted rather than overwritten, and `props.id` beats
 * both. Children that resolve to anything else -- several elements, or a
 * control that renders through a portal, and Kobalte's `<Select>` is both --
 * are left alone, because guessing which of several elements is "the control"
 * is how a label ends up labelling a wrapper div. Those rows call `useField()`,
 * or just pass matching `for` and `id` as the second form above does.
 */

export interface FieldContextValue {
  /** Id of the control, which is what the label points at. */
  id: () => string;
  descriptionId: () => string;
  errorId: () => string;
  /** Ready to spread as `aria-describedby`, or undefined when there is nothing to say. */
  describedBy: () => string | undefined;
  invalid: () => boolean;
  required: () => boolean;
}

const FieldContext = createContext<FieldContextValue>();

/** Undefined outside a `<Field>`. Every sub-component here tolerates that. */
export function useField(): FieldContextValue | undefined {
  return useContext(FieldContext);
}

export interface FieldProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Anything truthy marks the field invalid and renders below the control. */
  error?: JSX.Element;
  required?: boolean;
  /** Overrides the generated id. */
  id?: string;
  class?: string;
  children?: JSX.Element;
}

export function Field(props: FieldProps) {
  const generated = createUniqueId();
  const [adopted, setAdopted] = createSignal<string>();
  const id = () => props.id ?? adopted() ?? generated;
  const descriptionId = () => `${id()}-description`;
  const errorId = () => `${id()}-error`;
  const required = () => Boolean(props.required);
  /*
    Presence is asked of the KEY, never of the value.

    `label`, `description` and `error` hold markup, and reading a markup prop
    *builds its nodes*. Doing that to answer a question -- is there an error? --
    builds a copy nobody renders, and during hydration that copy claims the
    server's nodes from wherever the question was asked rather than from where
    the content belongs. `in` answers the same question without invoking the
    getter. See the note above the return for what the render side does.
  */
  const invalid = () => "error" in props;
  const describedBy = () => {
    const ids: string[] = [];
    if ("description" in props) ids.push(descriptionId());
    if ("error" in props) ids.push(errorId());
    return ids.length > 0 ? ids.join(" ") : undefined;
  };

  const control = children(() => props.children);

  createEffect(() => {
    const resolved = control.toArray();
    const el = resolved.length === 1 ? resolved[0] : undefined;
    if (!(el instanceof HTMLElement)) return;

    if (props.id) el.id = props.id;
    else if (el.id && el.id !== id()) setAdopted(el.id);
    else el.id = id();

    setOrRemove(el, "aria-describedby", describedBy());
    setOrRemove(el, "aria-invalid", invalid() ? "true" : undefined);
    setOrRemove(el, "aria-required", required() ? "true" : undefined);
  });

  return (
    <FieldContext.Provider
      value={{ id, descriptionId, errorId, describedBy, invalid, required }}
    >
      {/*
        All three rows are always in the markup, and empty when their prop was
        not passed. `empty:hidden` is what keeps an unused row out of the
        layout, gap included, so this looks identical to the conditional
        version it replaces.

        They cannot be conditional. `<Show when={props.description}>` reads the
        prop to test it, and that BUILDS the description's nodes -- before the
        paragraph meant to contain them exists. During hydration the browser
        then claims the server's nodes in an order the server did not write
        them in, Solid throws a hydration mismatch, and its own error path
        cannot print itself: what reaches the console is
        `template2 is not a function` and what reaches the reader is the whole
        page rendered a second time. Reading the prop twice (once to test, once
        to render) builds a second copy on top of that. Each one is read here
        exactly once, in the element that holds it. Same rule as
        `components/docs/snippet.tsx`.
      */}
      <div class={cn("flex flex-col gap-2", props.class)}>
        <FieldLabel class="empty:hidden">{props.label}</FieldLabel>
        {control()}
        <FieldDescription class="empty:hidden">{props.description}</FieldDescription>
        <FieldError class="empty:hidden">{props.error}</FieldError>
      </div>
    </FieldContext.Provider>
  );
}

/** Stacks form rows. The gap is bigger than the one inside a row, on purpose. */
export function FieldGroup(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col gap-4", local.class)} {...rest} />;
}

export function FieldLabel(props: ComponentProps<"label"> & { required?: boolean }) {
  const field = useField();
  const [local, rest] = splitProps(props, ["class", "children", "required"]);
  return (
    <Label for={field?.id()} class={local.class} {...rest}>
      {local.children}
      <Show when={local.required ?? field?.required()}>
        {/* The control carries `aria-required`; this is only for the eye.
            `negative` rather than `destructive`: the latter is the button fill,
            which is not the step that stays readable as text. */}
        <span aria-hidden="true" class="text-negative">
          {" *"}
        </span>
      </Show>
    </Label>
  );
}

export function FieldDescription(props: ComponentProps<"p">) {
  const field = useField();
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <p
      id={field?.descriptionId()}
      class={cn("text-caption text-muted-foreground", local.class)}
      {...rest}
    />
  );
}

export function FieldError(props: ComponentProps<"p">) {
  const field = useField();
  const [local, rest] = splitProps(props, ["class"]);
  return <p id={field?.errorId()} class={cn("text-caption text-negative", local.class)} {...rest} />;
}

function setOrRemove(el: HTMLElement, name: string, value: string | undefined) {
  if (value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value);
}
