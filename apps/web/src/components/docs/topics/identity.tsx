import Users from "lucide-solid/icons/users";
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
import { Callout } from "../snippet.js";

/**
 * The page that stops somebody misreading their own numbers.
 *
 * The mistake it exists to prevent is silent: adding two uniques counts that
 * belong to two surfaces. Nothing errors, the board looks fine, and the total
 * is a lie. So that one is the page's single red callout and everything else is
 * stated flatly and briefly around it.
 */

export const topics: DocsTopic[] = [
  {
    slug: "identity",
    title: "Identity",
    summary:
      "Two fields, nothing inferred, and why a unique is only ever counted inside one surface.",
    section: "How firstrun works",
    order: 20,
    icon: Users,
    render: () => (
      <DocsProse>
        <p>
          Identity here is two fields and no inference. Every number that counts people rather
          than events rests on them.
        </p>

        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Comes from</TableHead>
              <TableHead>What it is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">distinct_id</TableCell>
              <TableCell>The client, on every event</TableCell>
              <TableCell>
                A column. Anonymous and scoped to one surface: a visitor id in a browser, an
                install id on a machine, whatever your server passes per call.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">user.id</TableCell>
              <TableCell>
                Only ever the string you passed to <code>identify()</code>
              </TableCell>
              <TableCell>
                An attribute. Your id and your meaning. It is never invented, derived, looked up,
                or filled in from anything else.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h2>A unique is counted inside one surface</h2>
        <p>
          One definition, everywhere: <code>count(distinct coalesce(user.id, distinct_id))</code>,
          scoped to a single surface. An identified client folds into its user; an anonymous one
          stands on its own.
        </p>

        <Callout variant="caution" title="Never add uniques across surfaces">
          The same human on your website and in your app is <strong>two uniques</strong>, and that
          is the correct answer rather than a bug. The two ids were generated in different places
          and have never met, so a figure totalled across surfaces counts that person twice.
          Nothing on screen will look wrong. Read each surface on its own.
        </Callout>

        <h2>Surfaces are never linked</h2>
        <p>
          Two sources in one project are two separate anonymous id spaces reported next to each
          other. A project is a namespace for events, sources and boards; it is not an identity
          namespace. There is no inference, no probabilistic matching, no IP or fingerprint
          heuristic, and no merging, ever.
        </p>
        <p>
          If you want one person joined across two surfaces, call <code>identify()</code> with the
          same id on both. That is the only link there is, and it is your data and your decision
          rather than something reconstructed from behaviour. It applies to the events that carry
          the id: nothing is merged retroactively.
        </p>

        <h2>The id names an installation</h2>
        <p>
          A desktop client keeps <code>distinct_id</code> in per-user local application data, not
          the roaming profile, because it names <strong>one installation</strong> rather than one
          person. Carrying it to a second machine would report two installs as one, which is what{" "}
          <code>identify()</code> is for and what an anonymous id must not do quietly.
        </p>

        <h2>Late events count when they happened</h2>
        <p>
          <code>time</code> is stamped by the client at the moment the thing happened, and it is
          authoritative. A laptop that was offline until Monday still reports Friday&rsquo;s launch
          as Friday. Every series and every bucket is built on that, never on when the event
          arrived.
        </p>
      </DocsProse>
    ),
  },
];
