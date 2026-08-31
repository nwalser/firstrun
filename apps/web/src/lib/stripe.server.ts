import { createHmac, timingSafeEqual } from "node:crypto";
import { meterTargets, setBilling, workspaceByStripeCustomer } from "@firstrun/db/billing";
import { totalsForDay, utcDay } from "@firstrun/db/usage";
import { DEFAULT_PLAN, isPlanId, type PlanId } from "@firstrun/schema/plan";
import { getStore } from "./context.server.js";
import { isCloud } from "./billing.server.js";

/**
 * Stripe, over `fetch`, with no SDK.
 *
 * The surface actually used here is four endpoints and one signature check, and
 * the alternative is a dependency in the browser-adjacent half of the repo for
 * the sake of form encoding. The API is form encoded and stable, `node:crypto`
 * does the HMAC, and this file is short enough to read in one sitting.
 *
 * ## Nothing here is reachable on a self-hosted install
 *
 * `stripeConfigured()` is false without `FIRSTRUN_CLOUD` and a secret key, and
 * every entry point returns early on it. A self-hoster has no plan, no ceiling,
 * no customer and nothing to pay: this file simply never runs.
 *
 * ## Pricing lives in Stripe, not here
 *
 * One metered price per paid tier, tiered inside Stripe so the included volume
 * and the overage rate are set where prices belong. We report entries; Stripe
 * decides what they cost. `PLANS` in the contract package is the ENTITLEMENT
 * (what the meter in the UI draws against), not the price.
 */

const API = "https://api.stripe.com/v1";

/** Meter events are timestamped, and Stripe rejects anything older than 35 days. */
const MAX_METER_AGE_DAYS = 35;

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Partial<Record<PlanId, string>>;
  meterEvent: string;
}

let config: StripeConfig | null | undefined;

function stripeConfig(): StripeConfig | null {
  if (config !== undefined) return config;
  const secretKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  config =
    isCloud() && secretKey
      ? {
          secretKey,
          webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
          prices: {
            pro: (process.env.STRIPE_PRICE_PRO ?? "").trim() || undefined,
            scale: (process.env.STRIPE_PRICE_SCALE ?? "").trim() || undefined,
          },
          meterEvent: (process.env.STRIPE_METER_EVENT ?? "").trim() || "firstrun_entries",
        }
      : null;
  return config;
}

export function stripeConfigured(): boolean {
  return stripeConfig() !== null;
}

/** Which tier a price id means, for reading a subscription back off a webhook. */
function planForPrice(priceId: string | null | undefined): PlanId | null {
  const cfg = stripeConfig();
  if (!cfg || !priceId) return null;
  for (const plan of ["pro", "scale"] as const) {
    if (cfg.prices[plan] === priceId) return plan;
  }
  return null;
}

/**
 * Flattens a nested object into Stripe's bracket form: `payload[value]=3`.
 *
 * Stripe takes form encoding and not JSON, and the nesting is one level deep in
 * everything below, so this is the whole of it.
 */
function form(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        put(`${key}[${k}]`, v);
      }
      return;
    }
    params.set(key, String(value));
  };
  for (const [key, value] of Object.entries(body)) put(key, value);
  return params;
}

/**
 * One POST to Stripe.
 *
 * Throws on a non-2xx with Stripe's own message, because every caller here is
 * either answering a person who pressed a button (and wants to be told it did
 * not work) or is the nightly job (which logs and carries on). Nothing in this
 * file is on a path a customer's software is waiting on.
 */
async function post<T>(path: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const cfg = stripeConfig();
  if (!cfg) throw new Error("stripe is not configured");

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = json.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `stripe ${path} returned ${res.status}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Checkout and the portal
// ---------------------------------------------------------------------------

export interface CheckoutWorkspace {
  id: string;
  name: string;
  slug: string;
  stripeCustomerId: string | null;
}

/**
 * The workspace's Stripe customer, created on first use.
 *
 * Created rather than looked up by email, because the thing being billed is a
 * workspace and not a person: the admin who pays may leave, and the workspace
 * carries on. `metadata[workspace_id]` is the join back, and it is what makes a
 * customer created by hand in the dashboard still resolvable.
 */
async function ensureCustomer(workspace: CheckoutWorkspace): Promise<string> {
  if (workspace.stripeCustomerId) return workspace.stripeCustomerId;

  const customer = await post<{ id: string }>("/customers", {
    name: workspace.name,
    metadata: { workspace_id: workspace.id, workspace_slug: workspace.slug },
  });

  await setBilling(getStore().db, workspace.id, { stripeCustomerId: customer.id });
  return customer.id;
}

/**
 * A Checkout Session for one tier, and the URL to send somebody to.
 *
 * Stripe Checkout rather than a card form here, and the Billing Portal rather
 * than a card form for changes. No card number, no billing address and no tax
 * id ever reaches this codebase, which is not a convenience: it is the reason
 * this repo has no PCI surface at all.
 *
 * No `quantity`: the price is metered, so Stripe takes the quantity from the
 * meter events the nightly job sends and setting it here is an error.
 */
export async function checkoutUrl(
  workspace: CheckoutWorkspace,
  plan: PlanId,
  origin: string
): Promise<string> {
  const cfg = stripeConfig();
  if (!cfg) throw new Error("stripe is not configured");

  const price = cfg.prices[plan];
  if (!price) throw new Error(`no price configured for the ${plan} plan`);

  const customer = await ensureCustomer(workspace);
  const back = `${origin}/w/${workspace.slug}/settings/billing`;

  const session = await post<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer,
    "line_items[0][price]": price,
    success_url: `${back}?checkout=done`,
    cancel_url: `${back}?checkout=cancelled`,
    client_reference_id: workspace.id,
    subscription_data: { metadata: { workspace_id: workspace.id, plan } },
  });

  return session.url;
}

/** The Billing Portal: change the card, change the plan, cancel, read invoices. */
export async function portalUrl(
  workspace: CheckoutWorkspace,
  origin: string
): Promise<string> {
  const customer = await ensureCustomer(workspace);
  const session = await post<{ url: string }>("/billing_portal/sessions", {
    customer,
    return_url: `${origin}/w/${workspace.slug}/settings/billing`,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

/** Stripe's own tolerance. A replayed old signature is not a valid one. */
const SIGNATURE_TOLERANCE_S = 5 * 60;

/**
 * Verifies `Stripe-Signature` against the raw body.
 *
 * The RAW body, byte for byte. Anything that parses and re-serialises the JSON
 * first will produce a different string and a signature that never matches,
 * which is why the webhook is mounted on the plain `Request` in `server.ts`
 * rather than as a server function.
 *
 * `timingSafeEqual` rather than `===`, and the timestamp is checked as well as
 * the digest: without the second check a captured payload can be replayed
 * forever.
 */
export function verifyWebhook(raw: string, header: string | null, now = Date.now()): boolean {
  const cfg = stripeConfig();
  if (!cfg?.webhookSecret || !header) return false;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value) timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_S) return false;

  const expected = createHmac("sha256", cfg.webhookSecret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const want = Buffer.from(expected, "utf8");

  return signatures.some((candidate) => {
    const got = Buffer.from(candidate, "utf8");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Stripe's subscription statuses, mapped onto the two that change what a
 * workspace sees.
 *
 * `past_due` and `unpaid` warn. `canceled` and `incomplete_expired` put the
 * workspace back on free. Everything else is active. Nothing in this map turns
 * anything off: a workspace that stops paying keeps recording and keeps being
 * readable, and the only thing that changes is the banner and the ceiling the
 * meter is drawn against.
 */
function statusFor(stripeStatus: string | null): "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "active";
  }
}

/** The first price id on a subscription. One item per subscription, by construction. */
function priceOf(subscription: Json): string | null {
  const items = asObject(subscription.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const first = asObject(data[0]);
  const price = asObject(first?.price);
  return asString(price?.id);
}

/**
 * Applies one webhook event.
 *
 * Every branch writes absolute state, so a retry or an out-of-order delivery
 * lands on the same row. An event for a customer this instance has never heard
 * of is a no-op and still answers 200: refusing it would make Stripe retry
 * somebody else's event against us forever.
 */
export async function applyWebhook(event: Json): Promise<void> {
  const type = asString(event.type);
  const data = asObject(event.data);
  const object = asObject(data?.object);
  if (!type || !object) return;

  const db = getStore().db;

  const workspaceIdFor = async (customerId: string | null, fallback: string | null) => {
    if (customerId) {
      const found = await workspaceByStripeCustomer(db, customerId);
      if (found) return found.id;
    }
    return fallback;
  };

  switch (type) {
    case "checkout.session.completed": {
      const customer = asString(object.customer);
      const metadata = asObject(object.metadata);
      const workspaceId =
        asString(object.client_reference_id) ?? asString(metadata?.workspace_id) ?? null;
      if (!workspaceId) return;
      await setBilling(db, workspaceId, {
        stripeCustomerId: customer,
        stripeSubscriptionId: asString(object.subscription),
        billingStatus: "active",
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const metadata = asObject(object.metadata);
      const workspaceId = await workspaceIdFor(
        asString(object.customer),
        asString(metadata?.workspace_id)
      );
      if (!workspaceId) return;

      const deleted = type === "customer.subscription.deleted";
      const status = deleted ? "canceled" : statusFor(asString(object.status));
      // Back to free when the subscription is gone, and to whatever the price
      // says otherwise. An unrecognised price means somebody wired a price id
      // this deploy does not know: leave the plan alone rather than guess.
      const plan = deleted ? DEFAULT_PLAN : planForPrice(priceOf(object));

      await setBilling(db, workspaceId, {
        ...(plan ? { plan } : {}),
        billingStatus: status,
        stripeSubscriptionId: deleted ? null : asString(object.id),
      });
      return;
    }

    case "invoice.payment_failed":
    case "invoice.paid": {
      const workspaceId = await workspaceIdFor(asString(object.customer), null);
      if (!workspaceId) return;
      await setBilling(db, workspaceId, {
        billingStatus: type === "invoice.paid" ? "active" : "past_due",
      });
      return;
    }

    default:
      return;
  }
}

/**
 * The webhook, as a plain handler.
 *
 * Mounted in `apps/web/src/server.ts` above the data-plane guard, so it sees
 * the request before anything can read the body.
 */
export async function handleStripeWebhook(req: Request): Promise<Response> {
  if (!stripeConfigured()) return new Response("not configured", { status: 404 });

  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"))) {
    return new Response("bad signature", { status: 400 });
  }

  let event: Json;
  try {
    event = JSON.parse(raw) as Json;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  try {
    await applyWebhook(event);
  } catch (err) {
    // A 5xx makes Stripe retry, which is what we want for a transient database
    // problem and harmless otherwise: every handler above is idempotent.
    console.error("stripe webhook failed", (err as Error)?.message);
    return new Response("retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

// ---------------------------------------------------------------------------
// The nightly meter push
// ---------------------------------------------------------------------------

export interface MeterPushResult {
  day: string;
  sent: number;
  failed: number;
}

/**
 * Reports one day's entries to Stripe, one meter event per workspace.
 *
 * The identifier is `${workspaceId}:${day}`, which is what makes running this
 * twice harmless: Stripe enforces identifier uniqueness over a rolling window
 * of at least 24 hours, so a job that runs again the same day is discarded on
 * their side rather than doubling somebody's bill. Beyond that window it would
 * not be, which is why this only ever pushes recent days and never backfills.
 *
 * The timestamp is midday UTC of the day being reported rather than "now", so a
 * job that runs a few minutes after midnight still lands the entries on the day
 * they arrived. Stripe rejects timestamps older than 35 days.
 *
 * Failures are counted and logged, not thrown. This runs on an interval with
 * nothing waiting on it, and a workspace that fails tonight is reported again
 * tomorrow for the same day only if somebody asks: it is deliberately not a
 * retry loop, because the meter is a roll-up in our own database and that is
 * the record a dispute is settled from.
 */
export async function pushMeter(day: string = utcDay()): Promise<MeterPushResult> {
  const cfg = stripeConfig();
  if (!cfg) return { day, sent: 0, failed: 0 };

  const ageDays = (Date.now() - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > MAX_METER_AGE_DAYS || ageDays < -1) {
    return { day, sent: 0, failed: 0 };
  }

  const store = getStore();
  const [totals, targets] = await Promise.all([totalsForDay(store, day), meterTargets(store.db)]);
  const customerFor = new Map(targets.map((t) => [t.workspaceId, t.stripeCustomerId]));

  const timestamp = Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000);
  let sent = 0;
  let failed = 0;

  for (const total of totals) {
    const customer = customerFor.get(total.workspaceId);
    if (!customer) continue;
    try {
      await post(
        "/billing/meter_events",
        {
          event_name: cfg.meterEvent,
          timestamp,
          identifier: `${total.workspaceId}:${day}`,
          payload: { stripe_customer_id: customer, value: total.entries },
        },
        `meter:${total.workspaceId}:${day}`
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error("stripe meter push failed", total.workspaceId, (err as Error)?.message);
    }
  }

  return { day, sent, failed };
}

export { isPlanId };
