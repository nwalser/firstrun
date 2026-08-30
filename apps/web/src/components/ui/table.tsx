import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "../../lib/cn.js";

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
 */
export function Table(props: ComponentProps<"table">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div class="relative w-full overflow-x-auto rounded-md bg-card shadow-2xs">
      <table
        class={cn("w-full caption-bottom text-body", local.class)}
        {...rest}
      />
    </div>
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
    <thead
      class={cn("[&_tr]:border-b [&_tr]:bg-muted/40", local.class)}
      {...rest}
    />
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
  return (
    <tr
      class={cn(
        // 48px is the measured list row. It is a height on the ROW rather than
        // padding on the cell, so a row with a two-line stack in one cell and a
        // single word in the next still keeps the pitch.
        "h-12 border-b border-border transition-colors hover:bg-muted/50",
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
  return (
    <th
      class={cn(
        "h-12 px-3 text-left align-middle",
        "text-body font-medium text-muted-foreground",
        local.numeric && "text-right tabular-nums",
        local.class
      )}
      {...rest}
    />
  );
}

export function TableCell(props: ComponentProps<"td"> & NumericProps) {
  const [local, rest] = splitProps(props, ["class", "numeric"]);
  return (
    <td
      class={cn(
        "px-3 py-0 text-left align-middle",
        // No size change with the face: the numeric column has to sit on the
        // same baseline and cap height as the label beside it, and the mono
        // family utility carries the tabular figures and the slashed zero.
        local.numeric && "text-right font-mono tabular-nums",
        local.class
      )}
      {...rest}
    />
  );
}
