import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { workspaces } from "./schema.js";

/**
 * The workspace side of billing: what Stripe told us, written down.
 *
 * Separate from `repo.ts` because it is the one part of this database the
 * self-hosted edition never reads. Keeping it in its own file means the seam
 * between the two editions is visible in the file list rather than buried in a
 * thousand-line module, and it means the hosted service's billing code can be
 * read end to end without reading everything else.
 *
 * Drizzle rather than raw SQL, unlike `usage.ts`: none of this is in the ingest
 * path, and there are a handful of these calls a day.
 */

export interface BillingPatch {
  plan?: string;
  billingStatus?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

/**
 * Writes ABSOLUTE state, never a delta.
 *
 * Stripe retries a webhook it did not get a 2xx for, and it does not promise
 * that two events arrive in the order they happened. A handler that sets the
 * plan to what the event says is idempotent under both, which is why there is
 * no processed-event table here: replaying an event writes the same row twice.
 */
export async function setBilling(
  db: Database,
  workspaceId: string,
  patch: BillingPatch
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
}

/**
 * The workspace a Stripe customer belongs to.
 *
 * The webhook usually knows a customer id and nothing else, which is why that
 * column carries a unique index. A customer we have never seen is not an error:
 * it is somebody else's Stripe account hitting a shared endpoint, or a test
 * event, and the handler answers 200 and does nothing.
 */
export async function workspaceByStripeCustomer(
  db: Database,
  customerId: string
): Promise<{ id: string; plan: string } | null> {
  const rows = await db
    .select({ id: workspaces.id, plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.stripeCustomerId, customerId))
    .limit(1);
  return rows[0] ?? null;
}

export interface MeterTarget {
  workspaceId: string;
  stripeCustomerId: string;
}

/**
 * Every workspace whose usage Stripe is expecting, for the nightly push.
 *
 * A workspace with no customer id has never been through checkout, so there is
 * nothing to report it against. A workspace on the free plan still has a
 * customer id if it once paid, and is still reported: Stripe decides what a
 * meter event costs, and a cancelled subscription costs nothing.
 */
export async function meterTargets(db: Database): Promise<MeterTarget[]> {
  const rows = await db
    .select({ id: workspaces.id, customer: workspaces.stripeCustomerId })
    .from(workspaces)
    .where(and(isNotNull(workspaces.stripeCustomerId)));
  return rows
    .filter((r): r is { id: string; customer: string } => typeof r.customer === "string")
    .map((r) => ({ workspaceId: r.id, stripeCustomerId: r.customer }));
}
