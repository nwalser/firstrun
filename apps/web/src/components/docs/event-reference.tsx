import { Link } from "@tanstack/solid-router";
import { For, type JSX } from "solid-js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/index.js";
import type { DocsTopic } from "./registry.js";
import { DocsProse } from "./shell.js";

/**
 * One premade event, one page, one shape.
 *
 * Fourteen pages that answer the same four questions have to answer them in the
 * same order and at the same density, or the reader has to re-learn the layout
 * on every one. So a page declares what it knows and this builds it: the facts
 * block, the attribute table, what the event deliberately never carries, the
 * questions it answers, and where to go next. A page cannot accidentally omit
 * the severity or put the attributes last.
 *
 * ## It lives here rather than in `topics/`
 *
 * `registry.ts` discovers pages with `import.meta.glob("./topics/*.tsx")`, so a
 * module in this directory is a helper and not a page. That matters: a file in
 * `topics/` exporting no `topics` array is silently skipped, and a shared
 * component that ended up there would be a page nobody could find and a helper
 * nobody could see was being scanned.
 *
 * ## Types only from `registry.ts`
 *
 * The event pages import `eventTopic` from here as a value, and registry.ts
 * eagerly imports those pages while it is still initialising. Reading a *value*
 * out of registry.ts at the top level of this module would therefore read a
 * binding in its temporal dead zone and kill the whole documentation with a
 * `Cannot access '...' before initialization`. Types are erased, so the import
 * below costs nothing and cannot cycle. Do not add a value import.
 */

export interface EventAttr {
  key: string;
  /** As it lands in jsonb. A number stays a number, so a query can average it. */
  type: "string" | "number" | "boolean";
  what: string;
}

/** A question the board can answer from this event, and how it is built. */
export interface EventQuestion {
  question: string;
  /** Filter, group by, aggregate. The five parts a widget actually has. */
  how: string;
}

/** A pointer to another documentation page, by slug. */
export interface EventLink {
  topic: string;
  label: string;
}

export interface EventSpec {
  /** The literal value in the `name` column. Also the page title. */
  name: string;
  /** `/docs/<slug>`. Prefixed `event-`, so `identify` cannot take a bare noun. */
  slug: string;
  summary: string;
  order: number;
  icon: (props: { class?: string }) => JSX.Element;
  /** Which clients write it without being asked. */
  written: string;
  /** The band and the number, because the number is what a filter takes. */
  severity: string;
  /** How to stop it. Absent when there is nothing automatic to stop. */
  off?: string;
  /** When it fires, and what stops it firing twice. */
  when: () => JSX.Element;
  /** What the client fills in. Empty is a real answer and says so. */
  attrs: EventAttr[];
  /** What it deliberately does not carry. Absent when there is nothing to say. */
  never?: () => JSX.Element;
  /**
   * One more section, for the event that needs one.
   *
   * `web_vital` has a threshold table nothing else has, and the alternative to a
   * slot was either putting Google's numbers in a paragraph or giving every
   * other page an empty heading. The heading is the page's to name, so it does
   * not have to pretend to be one of the fixed four.
   */
  extra?: { heading: string; body: () => JSX.Element };
  questions: EventQuestion[];
  related: EventLink[];
}

/**
 * The facts block: four rows, vertical.
 *
 * Vertical rather than one wide row, because the values are sentences of very
 * different lengths and a four-column table would set its widths from the
 * longest one and leave the severity floating in the middle of a column.
 */
function Facts(props: { spec: EventSpec }) {
  return (
    <Table reference>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell class="whitespace-nowrap">Name</TableCell>
          <TableCell class="font-mono text-xs">{props.spec.name}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell class="whitespace-nowrap">Severity</TableCell>
          <TableCell class="font-mono text-xs">{props.spec.severity}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell class="whitespace-nowrap">Written by</TableCell>
          <TableCell>{props.spec.written}</TableCell>
        </TableRow>
        {props.spec.off ? (
          <TableRow>
            <TableCell class="whitespace-nowrap">Turned off by</TableCell>
            <TableCell>{props.spec.off}</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

/**
 * Build the page.
 *
 * Returned as a `DocsTopic` so the registry, the contents rail and the previous
 * and next links treat it exactly like a hand-written page: there is one kind
 * of documentation page here, not two.
 */
export function eventTopic(spec: EventSpec): DocsTopic {
  return {
    slug: spec.slug,
    title: spec.name,
    summary: spec.summary,
    section: "Premade events",
    order: spec.order,
    icon: spec.icon,
    render: () => (
      <DocsProse>
        <Facts spec={spec} />

        <h2>When it fires</h2>
        {spec.when()}

        <h2>Attributes</h2>
        {spec.attrs.length === 0 ? (
          <p>
            None of its own. The entry is the fact that it happened, and what it carries is what
            every entry carries.
          </p>
        ) : (
          <Table reference>
            <TableHeader>
              <TableRow>
                <TableHead>Attribute</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>What it holds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <For each={spec.attrs}>
                {(a) => (
                  <TableRow>
                    <TableCell class="whitespace-nowrap font-mono text-xs">{a.key}</TableCell>
                    <TableCell class="whitespace-nowrap text-muted-foreground">{a.type}</TableCell>
                    <TableCell>{a.what}</TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        )}
        <p>
          Every entry also carries the resource its client sends once per batch:{" "}
          <code>session.id</code>, <code>user.id</code> once you have called{" "}
          <code>identify()</code>, and the rest of{" "}
          <Link to="/docs/$topic" params={{ topic: "premade-events" }}>
            the list on the overview
          </Link>
          . Anything you pass yourself lands in the same map, and your key wins on a collision.
        </p>

        {spec.never ? (
          <>
            <h2>What it never carries</h2>
            {spec.never()}
          </>
        ) : null}

        {spec.extra ? (
          <>
            <h2>{spec.extra.heading}</h2>
            {spec.extra.body()}
          </>
        ) : null}

        <h2>Questions it answers</h2>
        <p>
          A widget is a filter, a group by, an aggregate, a time bucket and a limit. These are
          those five parts written out, and every one of them is something you can build yourself.
        </p>
        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>The query</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={spec.questions}>
              {(q) => (
                <TableRow>
                  <TableCell>{q.question}</TableCell>
                  <TableCell class="font-mono text-xs">{q.how}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>See also</h2>
        <ul>
          <For each={spec.related}>
            {(r) => (
              <li>
                <Link to="/docs/$topic" params={{ topic: r.topic }}>
                  {r.label}
                </Link>
              </li>
            )}
          </For>
        </ul>
      </DocsProse>
    ),
  };
}
