import FolderTree from "lucide-solid/icons/folder-tree";
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
 * Three levels, two roles.
 *
 * Small enough to state in a table, so the page is a table plus the two rules
 * that are not obvious from it: membership is per workspace, and the last admin
 * is the one thing the model will not let you delete.
 */

export const topics: WikiTopic[] = [
  {
    slug: "workspaces",
    title: "Workspaces, projects and sources",
    summary: "The three levels, the two roles, and who can change what.",
    section: "How firstrun works",
    order: 40,
    icon: FolderTree,
    render: (ctx) => (
      <WikiProse>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Level</TableHead>
              <TableHead>Answers</TableHead>
              <TableHead>Owns</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Workspace</TableCell>
              <TableCell>Who can see this, and who can change it</TableCell>
              <TableCell>People and projects</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Project</TableCell>
              <TableCell>Which product is this</TableCell>
              <TableCell>Log entries, sources and boards</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Source</TableCell>
              <TableCell>Which thing wrote this entry</TableCell>
              <TableCell>Nothing</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <p>
          A source is one thing that writes entries, with a fixed surface: a website, a desktop app,
          a backend. Each has a public key of the form <code>fr_&lt;surface&gt;_…</code> that names
          a destination and authorises nothing: it cannot read a number, a board or a person.
          Entries from every source land at <code>{ctx.vars.origin}</code>.
        </p>
        <p>
          One project per <strong>product</strong> is the advice, because that is what makes a
          board readable. It is not a data-safety rule: sources are never linked to each other, so
          getting it wrong puts numbers on the wrong board rather than corrupting them.
        </p>

        <h2>Two roles</h2>
        <p>
          <strong>Admin</strong> changes things: projects, sources, boards, and who else is in the
          workspace. <strong>Read</strong> looks. There is nothing in between.
        </p>
        <p>
          Membership is <strong>per workspace</strong> and covers every project in it. There is no
          per-project access, so two groups who should not see each other&rsquo;s numbers need two
          workspaces. Every check runs on the server, on every change; the interface hides buttons
          a reader cannot use as a courtesy, not as the check.
        </p>

        <Callout title="The last admin cannot be removed">
          An admin cannot be demoted or removed while they are the only one, because a workspace
          nobody can administer cannot invite an admin back. Promote a replacement before somebody
          leaves.
        </Callout>
      </WikiProse>
    ),
  },
];
