import { createContext, splitProps, useContext, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

/**
 * Whether this table is a grid of data or a page of reference.
 *
 * Read by every cell, so the two densities are one component rather than two
 * that drift. Defaulting to the data grid keeps every existing call site as it
 * was.
 */
const ReferenceCtx = createContext(false);

const isReference = () => useContext(ReferenceCtx);

/**
 * The table.
 *
 * Density and figures are the whole look here. The body sits at the 14px/20px
 * application chrome size, rows are short, every rule is a single hairline from
 * the alpha scale, the header is a quiet filled band rather than a heavy line,
 * and numeric cells are set in the mono face -- which is where columns of
 * numbers stop being ragged and start being a column.
 *
 * The row rules are the one place a real `border` is still correct: a ring is
 * drawn on four edges and a row divider is one edge between two siblings.
 *
 * ## `reference` is the documentation density, and it is a different table
 *
 * A dashboard table is a grid of values: one line per cell, a fixed 48px pitch
 * so the eye can run down a column, a hover row because every row is a thing
 * you might open. A reference table in a guide is none of those. Its cells are
 * SENTENCES -- what a field means, when it is set, what happens if it is not --
 * so a fixed row height either clips them or leaves a hand-tuned gap under the
 * short ones, and a hover state on a row that leads nowhere is a promise the
 * table cannot keep.
 *
 * So `reference` swaps the pitch for padding, lets rows take the height their
 * text needs, tops the cells rather than centring them (a two-line cell beside
 * a one-word cell should start on the same line as it), and drops the hover and
 * the raised card. What is left is what a documentation table is: ruled rows,
 * a quiet header band, and text.
 */
export function Table(props: ComponentProps<"table"> & { reference?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "reference"]);
  return (
    <ReferenceCtx.Provider value={local.reference ?? false}>
      <div
        class={cn(
          "relative w-full overflow-x-auto rounded-md",
          // The reference table sits in the page rather than on it: the prose
          // above and below is the surface, and a raised card in the middle of
          // a paragraph run reads as a widget somebody embedded.
          local.reference ? "border border-border" : "bg-card shadow-2xs"
        )}
      >
        <table class={cn("w-full caption-bottom text-body", local.class)} {...rest} />
      </div>
    </ReferenceCtx.Provider>
  );
}

/**
 * The header is separated by a fill plus the same hairline every other row
 * gets, rather than by a doubled rule. A table whose rules are all the same
 * weight reads as a set of rows; one heavy line at the top reads as a box, and
 * this system already has a ring around the table.
 */
export function TableHeader(props: ComponentProps<"thead">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <thead class={cn("[&_tr]:border-b [&_tr]:bg-muted/40", local.class)} {...rest} />
  );
}

export function TableBody(props: ComponentProps<"tbody">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <tbody class={cn("[&_tr:last-child]:border-0", local.class)} {...rest} />
  );
}

export function TableRow(props: ComponentProps<"tr">) {
  const [local, rest] = splitProps(props, ["class"]);
  const reference = isReference();
  return (
    <tr
      class={cn(
        "border-b border-border",
        // 48px is the measured list row. It is a height on the ROW rather than
        // padding on the cell, so a row with a two-line stack in one cell and a
        // single word in the next still keeps the pitch. A reference row has no
        // pitch to keep: it is as tall as its sentences.
        !reference && "h-12 transition-colors hover:bg-muted/50",
        local.class
      )}
      {...rest}
    />
  );
}

/**
 * `numeric` sets the cell in the mono face and right-aligns it.

 * Columns are left-set by default, because that is what the reference's list
 * grids are: only a number earns the right edge, and a role, a sentence or a
 * button pushed to the right reads as a mistake.
 *
 * It is opt-in rather than derived from the column position, because the column
 * after the first is a number in a metrics table and a role, a sentence or a
 * button everywhere else, and there is no way to tell those apart from inside
 * the cell. The mono family utility also brings tabular figures and a slashed
 * zero with it, which is the point: without them a right-aligned column of
 * numbers still does not line up on the decimal.
 */
type NumericProps = { numeric?: boolean };

/**
 * A quiet header, not a legend.
 *
 * Sentence case at the same 14px the body uses, one weight up, in the muted
 * colour. The tracked-out uppercase micro-label it used to be is the shadcn
 * dashboard house style and is not what a Geist table does: the column names
 * are read as words, and shouting them costs both size and legibility.
 */
export function TableHead(props: ComponentProps<"th"> & NumericProps) {
  const [local, rest] = splitProps(props, ["class", "numeric"]);
  const reference = isReference();
  return (
    <th
      class={cn(
        "text-left text-body text-muted-foreground",
        reference
          ? "px-2.5 py-2.5 align-bottom font-normal"
          : "h-12 px-3 align-middle font-medium",
        local.numeric && "text-right tabular-nums",
        local.class
      )}
      {...rest}
    />
  );
}

export function TableCell(props: ComponentProps<"td"> & NumericProps) {
  const [local, rest] = splitProps(props, ["class", "numeric"]);
  const reference = isReference();
  return (
    <td
      class={cn(
        "text-left",
        // No size change with the face: the numeric column has to sit on the
        // same baseline and cap height as the label beside it, and the mono
        // family utility carries the tabular figures and the slashed zero.
        reference
          ? "px-2.5 py-3 align-top leading-normal text-muted-foreground"
          : "px-3 py-0 align-middle",
        local.numeric && "text-right font-mono tabular-nums",
        local.class
      )}
      {...rest}
    />
  );
}
