import type { Namespaced } from "./namespace.js";

/**
 * Plans, the meter, and what happens when a workspace goes past one.
 *
 * None of these strings are reachable on a self-hosted install: every screen
 * that uses them is conditioned on a ceiling existing, and self-hosted has
 * none. They are written for the hosted service only.
 *
 * The tone is the product's promise, not a threat. Nothing stops when a
 * workspace goes over: entries keep being recorded, boards keep being readable,
 * and the copy says so plainly. A warning that implies data loss when there is
 * none costs more trust than the upgrade is worth.
 */
export const billing = {
  "billing.nav": "Billing",
  "billing.plan": "Plan",
  "billing.plan_free": "Free",
  "billing.plan_pro": "Pro",
  "billing.plan_scale": "Scale",

  // The meter.
  "billing.included": "Included this month",
  "billing.of_limit": "of {limit}",
  "billing.on_arrival":
    "The meter counts entries when they reach us, so it is the one number here that does not " +
    "move once a day has passed. The chart below counts them on the entry's own timestamp.",

  // The three states.
  "billing.ok": "Within plan",
  "billing.warn": "Approaching the plan limit",
  "billing.over": "Over the plan limit",
  "billing.warn_body":
    "This workspace has used {percent} of its monthly entries. Nothing changes when it goes " +
    "past: entries keep being recorded and everything stays readable.",
  "billing.over_body":
    "This workspace has passed its monthly entries. Everything is still being recorded and " +
    "nothing has been dropped. Upgrading keeps it that way as you grow.",
  "billing.over_short": "Over the plan limit. Still recording, nothing dropped.",

  // Payment state, from Stripe.
  "billing.past_due": "The last payment did not go through",
  "billing.past_due_body":
    "Nothing has been switched off and nothing has been dropped. Updating the card clears this.",
  "billing.canceled": "This subscription has been cancelled",
  "billing.canceled_body": "The workspace is on the free plan from the end of the paid period.",

  // Actions.
  "billing.upgrade": "Upgrade",
  "billing.manage": "Manage billing",
  "billing.view_usage": "View usage",
  "billing.admin_only": "An admin of this workspace can change the plan.",
  "billing.opening": "Opening Stripe",
  "billing.failed": "Could not reach Stripe. Try again in a moment.",

  // The plan picker.
  "billing.title": "Plan and billing",
  "billing.hint":
    "One price for entries. An error, a page view and a measurement each count once, because " +
    "they are the same row in the same table.",
  "billing.per_month": "{price} per month",
  "billing.free_price": "Free",
  "billing.entries_per_month": "{count} entries per month",
  "billing.projects_limit": "{count} projects",
  "billing.projects_unlimited": "Unlimited projects",
  "billing.members_unlimited": "Unlimited members",
  "billing.current": "Current plan",
  "billing.select": "Choose {plan}",
  "billing.self_hosted": "Self-hosted",
  "billing.self_hosted_body":
    "This is a self-hosted install. Every feature is on, there are no limits, and there is " +
    "nothing to pay or to license.",
} satisfies Namespaced<"billing">;

export type BillingMessages = typeof billing;
