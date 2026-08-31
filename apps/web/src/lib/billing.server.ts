import { monthWindow, usageBetween } from "@firstrun/db/usage";
import {
  DEFAULT_PLAN,
  UNLIMITED,
  isBillingStatus,
  isPlanId,
  planFor,
  withOverride,
  type BillingStatus,
  type Entitlements,
  type PlanId,
} from "@firstrun/schema/plan";
import type { BillingView } from "./api.js";
import { getStore } from "./context.server.js";

/**
 * The one place that knows there are two editions.
 *
 * `FIRSTRUN_CLOUD` is read HERE and nowhere else. Everything downstream asks
 * for entitlements and gets a shape it can render: a limit, or `null` for no
 * limit. That is what keeps the self-hosted edition free without a second code
 * path, a build flag, a licence check or a feature gate anywhere in the app.
 *
 * Self-hosted therefore resolves `UNLIMITED`, and every meter, banner and
 * upsell in the UI is already conditioned on a limit existing, so all of them
 * render nothing. There is nothing to unlock, because nothing was locked.
 *
 * ## What this file may never do
 *
 * It may not reach the ingest path. Entries are accepted in both editions,
 * over the limit or not, and no plan is consulted when a row is written (rule
 * 7). Limits are read on the dashboard and warned about there. A workspace over
 * its plan keeps recording, and keeps being able to read what it recorded:
 * losing the data, or losing sight of it, is how a late invoice turns into a
 * lost customer and a lost month of somebody's telemetry.
 */

let cloud: boolean | null = null;

export function isCloud(): boolean {
  if (cloud === null) cloud = (process.env.FIRSTRUN_CLOUD ?? "").trim() === "1";
  return cloud;
}

/** The columns `requireAccess` already has in hand. No extra read to resolve a plan. */
export interface BillableWorkspace {
  id: string;
  plan: string;
  planLimits: unknown;
  billingStatus: string;
}

/**
 * A hand-tuned override, read defensively.
 *
 * This column is written by an operator with SQL, not by a form, so it is
 * treated like anything else that arrives from outside: a key that is not a
 * known entitlement is ignored, and a value that is not a finite number becomes
 * `null`, which reads as "no limit" rather than as zero. A typo must widen
 * somebody's plan, never silently close it to nothing.
 */
function overrideFrom(value: unknown): Partial<Entitlements> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: Partial<Entitlements> = {};
  for (const key of ["entriesPerMonth", "projects", "members"] as const) {
    if (key in raw) {
      const n = raw[key];
      out[key] = typeof n === "number" && Number.isFinite(n) ? n : null;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** What a workspace is actually owed. UNLIMITED off the hosted service. */
export function entitlementsFor(workspace: BillableWorkspace): Entitlements {
  if (!isCloud()) return UNLIMITED;
  return withOverride(planFor(workspace.plan).entitlements, overrideFrom(workspace.planLimits));
}

/**
 * Read on the workspace layout, so every page inside it can warn without any of
 * them paying for a second query. It is one `sum()` over a table that holds a
 * few rows per source per day.
 *
 * Self-hosted skips the read entirely: with no ceiling there is no number to
 * compare against and nothing that would be drawn with it.
 */
export async function loadBilling(workspace: BillableWorkspace): Promise<BillingView> {
  const { from, to } = monthWindow();
  const entitlements = entitlementsFor(workspace);

  if (!isCloud()) {
    return {
      cloud: false,
      plan: DEFAULT_PLAN,
      status: "active",
      entitlements,
      period: { from, to, entries: 0 },
    };
  }

  const entries = await usageBetween(getStore(), workspace.id, from, to);
  return {
    cloud: true,
    plan: isPlanId(workspace.plan) ? workspace.plan : DEFAULT_PLAN,
    status: isBillingStatus(workspace.billingStatus) ? workspace.billingStatus : "active",
    entitlements,
    period: { from, to, entries },
  };
}
