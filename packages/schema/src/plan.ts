/**
 * What a plan entitles a workspace to, and nothing about how it is paid for.
 *
 * This lives in the contract package rather than in `db` for the usual reason:
 * the usage meter is drawn in the browser, and a value import from
 * `@firstrun/db` in a component pulls `pg` into the client graph and stops the
 * page hydrating. The server reads these constants to decide what a workspace
 * is owed; the UI reads the same constants to draw the bar.
 *
 * ## A limit of `null` is no limit, never zero
 *
 * Same idiom as an empty board filter: absence is "no constraint", not
 * "nothing". This is what makes the self-hosted edition free without a second
 * code path anywhere. Self-hosted resolves `UNLIMITED`, every field is null,
 * and every meter, banner and upsell in the UI is conditioned on the limit
 * existing. There is no licence, no key and no gate to remove.
 *
 * ## These numbers are meant to be edited
 *
 * They are one constant in one file precisely so that moving a tier is a
 * one-line change rather than a migration. `workspaces.plan_limits` overrides
 * them per workspace, because the first ten customers get hand-tuned and none
 * of that should reach this table.
 */

/** The tiers on offer. Closed set: a workspace on an unknown plan reads as free. */
export const PLAN_IDS = ["free", "pro", "scale"] as const;

export type PlanId = (typeof PLAN_IDS)[number];

/**
 * What a workspace is allowed. Every field is a ceiling or `null` for none.
 *
 * Entries are counted on ARRIVAL, not on the entry's own `time`. See
 * `db/usage.ts`: it is the only window that closes.
 */
export interface Entitlements {
  /** Entries accepted in one calendar month. */
  entriesPerMonth: number | null;
  /** Projects in the workspace. */
  projects: number | null;
  /** People in the workspace. Null everywhere today, and that is deliberate. */
  members: number | null;
}

export interface Plan {
  id: PlanId;
  /** For the plan picker. Stripe is authoritative for what is actually charged. */
  monthlyCents: number;
  entitlements: Entitlements;
}

/** No ceilings at all: the self-hosted edition, and the answer for any admin override. */
export const UNLIMITED: Entitlements = {
  entriesPerMonth: null,
  projects: null,
  members: null,
};

/**
 * The tiers.
 *
 * Sized against PostHog, which is the only comparable that counts the way this
 * does: one event is one row whatever it happens to be, so a page view, a crash
 * and a latency sample all cost the same. Its free tier is 1M events a month
 * with unlimited seats, and matching it makes the free tier legible to anybody
 * who has priced a competitor. Sentry's 50k is not comparable, because it
 * counts errors only and meters spans and replays separately.
 *
 * Seats are unlimited on every tier on purpose. The buyer here is a team of
 * three, and per-seat pricing charges them for the one behaviour the product
 * needs: everybody looking at the same board.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    monthlyCents: 0,
    entitlements: { entriesPerMonth: 1_000_000, projects: 2, members: null },
  },
  pro: {
    id: "pro",
    monthlyCents: 2_000,
    entitlements: { entriesPerMonth: 10_000_000, projects: null, members: null },
  },
  scale: {
    id: "scale",
    monthlyCents: 10_000,
    entitlements: { entriesPerMonth: 100_000_000, projects: null, members: null },
  },
};

export const DEFAULT_PLAN: PlanId = "free";

/**
 * What Stripe has most recently said about the money.
 *
 * `past_due` warns and never blocks: reading their own data is the thing that
 * makes somebody come back and fix a card.
 */
export const BILLING_STATUSES = ["active", "past_due", "canceled"] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const isPlanId = (v: unknown): v is PlanId => PLAN_IDS.includes(v as PlanId);

export const isBillingStatus = (v: unknown): v is BillingStatus =>
  BILLING_STATUSES.includes(v as BillingStatus);

/** An unknown or missing plan reads as free rather than throwing. */
export function planFor(id: string | null | undefined): Plan {
  return PLANS[isPlanId(id) ? id : DEFAULT_PLAN];
}

/**
 * A per-workspace override on top of a plan's ceilings.
 *
 * Only the keys present in the override are replaced, so `{"entriesPerMonth":
 * null}` is "this workspace is uncapped on volume" and an absent key is "leave
 * the plan alone". That distinction is why this reads the key rather than the
 * value being non-null.
 */
export function withOverride(
  base: Entitlements,
  override: Partial<Entitlements> | null | undefined
): Entitlements {
  if (!override) return base;
  const out = { ...base };
  for (const key of ["entriesPerMonth", "projects", "members"] as const) {
    if (key in override) {
      const value = override[key];
      out[key] = typeof value === "number" && Number.isFinite(value) ? value : null;
    }
  }
  return out;
}

/** Where the meter turns amber. One number, so the UI and any future mail agree. */
export const WARN_AT = 0.8;

export type UsageLevel = "ok" | "warn" | "over";

/**
 * How close a workspace is to a ceiling, or null when there is no ceiling.
 *
 * Null is the self-hosted answer and the unlimited-tier answer, and every
 * caller treats it as "draw nothing". A progress bar with no limit behind it is
 * a decoration pretending to be a number.
 */
export function usageLevel(used: number, limit: number | null): UsageLevel | null {
  if (limit === null || limit <= 0) return null;
  const ratio = used / limit;
  if (ratio >= 1) return "over";
  return ratio >= WARN_AT ? "warn" : "ok";
}

export function usageRatio(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return used / limit;
}
