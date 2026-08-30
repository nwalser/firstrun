import { Link } from "@tanstack/solid-router";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import { For } from "solid-js";
import type { WikiTopic } from "../registry.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/index.js";
import { WikiProse } from "../shell.js";
import { Callout } from "../snippet.js";

/**
 * Boards: placement, filters and the two windows.
 *
 * What a card ASKS is the querying page, and this one does not repeat it. This
 * page is about the board around the card: where it sits, what it inherits, and
 * what "up 12%" is measured against.
 */

const VISUALS: Array<{ label: string; when: string }> = [
  { label: "Single number", when: "No group by and no bucket. One figure, with its delta." },
  { label: "Line or bar", when: "A time bucket. One series, or one per group." },
  { label: "Ranked list", when: "A group by and no bucket. Rows with a share of the total." },
  { label: "Table", when: "Several group bys, or several aggregates side by side." },
  { label: "Entry list", when: "No aggregate. The rows themselves, newest first." },
  { label: "Note", when: "A heading or a caveat. No query behind it." },
];

export const topics: WikiTopic[] = [
  {
    slug: "dashboards",
    title: "Boards and cards",
    summary: "Cards placed on a canvas, each a saved query, with filters that belong to the board.",
    section: "How firstrun works",
    order: 30,
    icon: LayoutDashboard,
    render: () => (
      <WikiProse>
        <p>
          A card is a{" "}
          <Link to="/wiki/$topic" params={{ topic: "querying" }}>
            saved query
          </Link>{" "}
          plus a way of drawing its answer. A board is a canvas of cards you place yourself.
        </p>

        <h2>How an answer is drawn</h2>
        <p>
          The shape of the query decides which visualisations make sense, and you pick from those.
        </p>
        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Visualisation</TableHead>
              <TableHead>Fits a query with</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <For each={VISUALS}>
              {(row) => (
                <TableRow>
                  <TableCell class="whitespace-nowrap">{row.label}</TableCell>
                  <TableCell>{row.when}</TableCell>
                </TableRow>
              )}
            </For>
          </TableBody>
        </Table>

        <h2>Cards are placed, not flowed</h2>
        <p>
          Every card carries a position and a size in pixels on a canvas of fixed logical width,
          snapped to a small grid. Width and height are both draggable, cards keep rendering live
          data while you move them, and settings open in a side drawer rather than inside the
          card. It is not a column layout: the point of placing a card yourself is that you can
          leave a gap, and a column system reflows a careful board the moment something above it
          changes height.
        </p>

        <Callout title="There is no Save button">
          Every edit is saved as it is made. With drag-to-place there is no natural moment to
          press Save.
        </Callout>

        <h2>Many boards, one project</h2>
        <p>
          A project holds an ordered list of boards, each with its own layout, its own dates and
          its own <strong>permanent filters</strong>. A board filter applies to every card on it,
          and can be any condition a card could carry: a source, an operating system, a release
          channel, an attribute of your own. It belongs to the board rather than to the viewer, so
          it survives a reload, a link sent to a colleague, and the next person to open it. An
          empty filter means <strong>no constraint</strong>, never &ldquo;nothing&rdquo;.
        </p>

        <h2>The range and the comparison are separate</h2>
        <p>
          The <strong>range</strong> is what the numbers are. The <strong>comparison</strong> is
          what &ldquo;up 12%&rdquo; means. Both are set independently, both can be rolling or
          pinned, and both show their resolved dates on screen, because a delta whose baseline is
          unstated is a number nobody can check. With no baseline, or a baseline of zero, no delta
          is shown at all.
        </p>
        <p>
          The range is also what makes a board fast. The table is partitioned by time, so a window
          of a fortnight reads a fortnight of data and never touches the rest.
        </p>
      </WikiProse>
    ),
  },
];
