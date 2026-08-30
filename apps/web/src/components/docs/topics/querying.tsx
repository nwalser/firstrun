import Search from "lucide-solid/icons/search";
import { For } from "solid-js";
import type { DocsTopic } from "../registry.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/index.js";
import { DocsProse } from "../shell.js";

/**
 * How a question becomes a card.
 *
 * The page exists because the five parts below are the whole vocabulary: a
 * reader who knows them knows everything the product can be asked. Kept to
 * tables for that reason: it is a vocabulary to look up, not an argument.
 */

const PARTS: Array<{ part: string; what: string }> = [
  {
    part: "Filter",
    what:
      "Conditions on the five columns and on any attribute path. Several conditions are ANDed. " +
      "No filter means no constraint, not nothing.",
  },
  {
    part: "Group by",
    what:
      "Zero or more columns or attribute paths. None gives one number; one gives a ranked breakdown.",
  },
  {
    part: "Aggregate",
    what:
      "Events, uniques, or a numeric aggregate over an attribute: sum, average or a percentile.",
  },
  {
    part: "Time bucket",
    what: "None for a single number, or a bucket width for a series. Always on time, never on arrival.",
  },
  {
    part: "Limit",
    what: "How many groups come back, so grouping by something high-cardinality stays readable.",
  },
];

const EXAMPLES: Array<{ question: string; query: string }> = [
  {
    question: "Errors per day",
    query: "severity at least ERROR · bucket by day · count events",
  },
  {
    question: "Which pages people land on",
    query: "name is page_view · group by url.path · count uniques · limit 20",
  },
  {
    question: "Slowest routes",
    query: "name is http.request · group by http.route · p95 of firstrun.duration_ms",
  },
  {
    question: "Which build is crashing",
    query: "name is exception · group by service.version and exception.type · count events",
  },
];

export const topics: DocsTopic[] = [
  {
    slug: "querying",
    title: "Querying",
    summary: "Filter, group, aggregate, bucket, limit: the whole vocabulary a card is built from.",
    section: "How firstrun works",
    order: 25,
    icon: Search,
    render: () => (
      <DocsProse>
        <p>
          Every card on a board is a <strong>saved query plus a way of drawing it</strong>. The
          query has five parts and nothing else, so anything you can express in them you can put
          on a board.
        </p>

        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead>What it does</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={PARTS}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap">{row.part}</TableCell>
                  <TableCell>{row.what}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Attributes are discovered, not declared</h2>
        <p>
          There is nothing to register and no schema to keep in step. The pickers list the
          attribute keys that have actually been written in the window you are looking at, with
          the conventional ones offered before your project has written anything.
        </p>
        <p>
          A key nobody has sent yet is not an error. It is a filter that matches nothing, until
          the day you ship the build that starts sending it, and then the same card fills in. The
          same goes for a name: <code>rows_exported</code> works the moment you write it, without
          anybody adding it to a list first.
        </p>

        <h2>Some questions and the queries behind them</h2>
        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Query</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={EXAMPLES}>
              {(row) => (
                <TableRow>
                  <TableCell>{row.question}</TableCell>
                  <TableCell>{row.query}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Uniques</h2>
        <p>
          A unique is <code>count(distinct coalesce(user.id, distinct_id))</code>, scoped to one
          surface. An identified client folds into its user; an anonymous one stands alone. Two
          surfaces are never linked, so a unique count filtered to one surface is the only one
          that means anything.
        </p>

        <h2>Templates are starting points</h2>
        <p>
          The board templates are named queries with a chart already chosen: errors over time,
          pages by visitor, installs by version. Every one of them is editable, and none of them
          reaches a query you could not have built yourself. They exist so a new project has
          something on screen on day one, not to bound what you can ask.
        </p>
      </DocsProse>
    ),
  },
];
