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
 * belong to two sources. Nothing errors, the board looks fine, and the total
 * is a lie. So that one is the page's single red callout and everything else is
 * stated flatly and briefly around it.
 *
 * The second thing it has to say plainly is that all three fields are optional.
 * A reader who assumes one of them is always there will read a zero as a bug.
 */

export const topics: DocsTopic[] = [
  {
    slug: "identity",
    title: "Identity",
    summary:
      "Three optional fields, nothing inferred, and why a unique is only ever counted inside one source.",
    section: "How firstrun works",
    order: 20,
    icon: Users,
    render: () => (
      <DocsProse>
        <p>
          Identity here is three optional fields and no inference. Every number that counts people
          rather than events rests on them. You set them; nothing is worked out on your behalf.
        </p>

        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Set by</TableHead>
              <TableHead>Lives</TableHead>
              <TableHead>What it is</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">user.id</TableCell>
              <TableCell>
                <code>user(id)</code>
              </TableCell>
              <TableCell>Until you clear it</TableCell>
              <TableCell>
                Your id and your meaning. Never invented, derived, looked up, or filled in from
                anything else. <code>user(null)</code> signs them out.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">device.id</TableCell>
              <TableCell>
                <code>device(id)</code>
              </TableCell>
              <TableCell>Forever</TableCell>
              <TableCell>
                One machine, where there honestly is one. A desktop install fills this in for
                itself. A website does not: see below.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell class="whitespace-nowrap font-mono text-xs">session.id</TableCell>
              <TableCell>
                <code>session(id)</code>
              </TableCell>
              <TableCell>Until you replace it</TableCell>
              <TableCell>
                One visit or one run. The browser tag and the desktop clients keep this for you.
                There is no separate new-session call: pass a new id.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h2>Absent is an answer</h2>
        <p>
          All three are optional and an event may carry none of them. That is not a broken event:
          it is stored, indexed and queried like every other one, it counts as an event, and it
          counts in no unique. On a backend that is the normal case, because a process is not a
          person and a request is not a visit.
        </p>
        <p>
          Nothing is ever substituted for a field you did not set. An id we invented would look
          exactly like an id you set, which is the worst property a number can have.
        </p>

        <h2>What gets filled in for you</h2>
        <Table reference>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>
                <code>device.id</code>
              </TableHead>
              <TableHead>
                <code>session.id</code>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Browser tag</TableCell>
              <TableCell>Only with fingerprinting on and consent given</TableCell>
              <TableCell>Yes: 30 idle minutes, or arrival from a new site</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Desktop (.NET, Tauri)</TableCell>
              <TableCell>Yes: the install id, kept on the machine</TableCell>
              <TableCell>Yes: one run is one session</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Server (Node, Go, Python)</TableCell>
              <TableCell>Never</TableCell>
              <TableCell>Never</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p>
          A desktop install is a machine, so the desktop clients report one. A browser is not a
          machine, so the tag reports none. A server is neither, so it reports whatever you tell
          it and nothing otherwise.
        </p>

        <h2>A unique is counted inside one source</h2>
        <p>
          One definition, everywhere:{" "}
          <code>count(distinct coalesce(user.id, device.id, session.id))</code>, scoped to a single
          source. The best identity present wins: a named user is one person, a device is one
          install, a session is one visit. An event with none of the three is counted in no unique.
        </p>

        <Callout variant="caution" title="Never add uniques across sources">
          The same human on your website and in your app is <strong>two uniques</strong>, and that
          is the correct answer rather than a bug. The two ids were generated in different places
          and have never met, so a figure totalled across sources counts that person twice.
          Nothing on screen will look wrong. Read each source on its own.
        </Callout>

        <h2>Sources are never linked</h2>
        <p>
          Two sources in one project are two separate id spaces reported next to each other. A
          project is a namespace for events, sources and boards; it is not an identity namespace.
          There is no inference, no probabilistic matching, no IP heuristic, and no merging, ever.
        </p>
        <p>
          If you want one person joined across two sources, call <code>user()</code> with the same
          id on both. That is the only link there is, and it is your data and your decision rather
          than something reconstructed from behaviour. It applies to the events that carry the id:
          nothing is merged retroactively.
        </p>

        <h2>Signing in starts a new session</h2>
        <p>
          Calling <code>user()</code> with a <em>different</em> id replaces the session id, because
          a sign-in is a boundary and one visit spanning two accounts belongs to neither. Calling
          it with the same id again does nothing at all, which is what makes it safe to call from a
          router on every route change.
        </p>

        <h2>A device names an installation</h2>
        <p>
          A desktop client keeps <code>device.id</code> in per-user local application data, not the
          roaming profile, because it names <strong>one installation</strong> rather than one
          person. Carrying it to a second machine would report two installs as one, which is what{" "}
          <code>user()</code> is for.
        </p>
        <p>
          A website has no device to find out. Everything a page can read describes software rather
          than a machine, so the tag reports no device unless you switch fingerprinting on, and
          then what you get collides between two identical laptops and changes when the OS updates.
          It is a trend line, not a headcount.
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
