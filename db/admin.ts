import type { Queryable } from "./client.js";

/**
 * The instance-wide view: every workspace on this deployment, with its plan and
 * what it has used.
 *
 * This is the only file that reads ACROSS workspaces. Every other query in the
 * repo is scoped to one, because every other reader is a member of one. The
 * caller here is whoever operates the deployment, and the guard is
 * `apps/web/src/lib/admin.server.ts` rather than `requireAccess`: workspace
 * membership is not the question, and an admin of one workspace must not reach
 * this by being an admin of one workspace.
 *
 * Plain SQL through `Queryable`, like `usage.ts`, because it is one statement
 * with five aggregates hanging off it and the builder would make that longer
 * without making it clearer.
 */

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  plan: string;
  planLimits: unknown;
  billingStatus: string;
  stripeCustomerId: string | null;
  members: number;
  projects: number;
  sources: number;
  /** Entries billed in the current calendar month, counted on arrival. */
  entriesThisMonth: number;
  /** The same for the month before, so a trend is visible without a chart. */
  entriesLastMonth: number;
  /** The last day anything ARRIVED, which is what "is this alive" asks. */
  lastBilledDay: string | null;
}

/**
 * Every workspace, ordered by how much it is using.
 *
 * One statement rather than a join per aggregate: correlated subqueries over
 * tables measured in tens of rows, plus two over `usage_daily`, which holds a
 * handful of rows per source per day. At the scale this product is built for
 * the whole thing is a few milliseconds, and the alternative is five round
 * trips and a merge in JavaScript.
 *
 * Ordered by this month's volume because that is what the operator is looking
 * for: who is growing, who is about to need a bigger plan, and who has gone
 * quiet. Alphabetical would bury all three.
 *
 * `last_billed_day` comes off `usage_daily` rather than `max(ingested_at)` over
 * `log_entries`. That looks like the more direct answer and is the wrong query:
 * it has no time bound, so it scans every partition of the largest table in the
 * database once per workspace. The roll-up already records the day anything
 * arrived, at the granularity an operator needs, for the cost of an index scan
 * on a small table.
 *
 * It is therefore an ARRIVAL date, not an activity date. Everywhere a CUSTOMER
 * reads last-seen it is on `time` (rule 5); this one answers "is this
 * deployment still hearing from them", which is a question about the connection
 * rather than about their users.
 */
export async function adminWorkspaces(
  q: Queryable,
  monthFrom: string,
  monthTo: string,
  prevFrom: string
): Promise<AdminWorkspaceRow[]> {
  const rows = await q.query<{
    id: string;
    name: string;
    slug: string;
    created_at: Date | string;
    plan: string;
    plan_limits: unknown;
    billing_status: string;
    stripe_customer_id: string | null;
    members: string | number;
    projects: string | number;
    sources: string | number;
    this_month: string | number;
    last_month: string | number;
    last_billed_day: string | null;
  }>(
    `select w.id, w.name, w.slug, w.created_at,
            w.plan, w.plan_limits, w.billing_status, w.stripe_customer_id,
            (select count(*) from workspace_members m
              where m.workspace_id = w.id) as members,
            (select count(*) from projects p
              where p.workspace_id = w.id) as projects,
            (select count(*) from sources s
               join projects p on p.id = s.project_id
              where p.workspace_id = w.id) as sources,
            coalesce((select sum(u.entries) from usage_daily u
                       where u.workspace_id = w.id
                         and u.day >= $1::date and u.day < $2::date), 0) as this_month,
            coalesce((select sum(u.entries) from usage_daily u
                       where u.workspace_id = w.id
                         and u.day >= $3::date and u.day < $1::date), 0) as last_month,
            (select max(u.day)::text from usage_daily u
              where u.workspace_id = w.id and u.entries > 0) as last_billed_day
       from workspaces w
      order by this_month desc, w.created_at`,
    [monthFrom, monthTo, prevFrom]
  );

  const iso = (v: Date | string | null) =>
    v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    plan: r.plan,
    planLimits: r.plan_limits,
    billingStatus: r.billing_status,
    stripeCustomerId: r.stripe_customer_id,
    members: Number(r.members ?? 0),
    projects: Number(r.projects ?? 0),
    sources: Number(r.sources ?? 0),
    entriesThisMonth: Number(r.this_month ?? 0),
    entriesLastMonth: Number(r.last_month ?? 0),
    lastBilledDay: r.last_billed_day,
  }));
}
