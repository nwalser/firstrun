# Billing

How the hosted service charges, and why self-hosting is free.

## Two editions, one switch

```
FIRSTRUN_CLOUD unset   the self-hosted edition. Everything on, nothing capped, nothing to pay
FIRSTRUN_CLOUD=1       the hosted service. Plans, a meter, Stripe
```

That variable is read in **one file**, `apps/web/src/lib/billing.server.ts`. Nothing else in the
repo reads it. Everything downstream calls `entitlementsFor(workspace)` and gets back an
`Entitlements` shape, and self-hosted answers `UNLIMITED`: every field `null`.

`null` means **no limit**, never zero. Every meter, banner, upsell and plan card in the UI is
conditioned on a ceiling existing, so a self-hoster sees none of them. There is no licence key, no
phone-home, no build flag and no gate to remove. That is the point: the free edition is the
product, not a trial of it.

## What is charged for

**Entries per calendar month.** One row in `log_entries` is one unit whatever it is called and
whatever severity it carries, because they are the same row (rule 1). There is no error pipeline
priced differently, because there is no error pipeline.

Not seats. The buyer is a team of three and per-seat pricing charges them for the one behaviour the
product needs, which is everybody looking at the same board.

**Not retention.** `log_entries` is partitioned by `time` across every workspace, so per-workspace
retention would need per-workspace DELETEs, which rule 4 exists to prevent. Retention is a
deployment-wide setting and cannot become a plan lever without repartitioning.

The tiers are in `packages/schema/src/plan.ts` and are meant to be edited. `workspaces.plan_limits`
overrides them for one workspace:

```sql
update workspaces set plan_limits = '{"entriesPerMonth": 25000000}'::jsonb where slug = 'acme';
```

Only the keys present are replaced, and a key set to anything that is not a finite number becomes
`null`, which is no limit. A typo widens a plan; it never silently closes one to nothing.

## The meter

`usage_daily(workspace_id, day, project_id, source_id, entries)`, written by `db/usage.ts` from the
ingest path.

**Counted on arrival, not on `time`.** This is the only place in the repo that does, and it is the
one exception to rule 5:

- `time` is client-stamped. A period counted on it never closes, because entries for last month
  keep arriving after the invoice went out.
- A client stamping `time` a year ago would fall outside every open period and ingest free forever.
- Arrival is when the row cost us the page it is written on.

So the usage page's chart buckets on `time` (when things happened) and the meter counts arrivals
(what was billed). They do not agree to the row. Both are on screen and both say which they are.

**A roll-up, not a `count(*)`.** Retention DROPs a whole month of `log_entries` once it ages out,
so a number derived from those rows stops being derivable exactly when somebody disputes it. This
table is a few rows per source per day and survives the drop. It is the record a dispute is settled
from, and Stripe is downstream of it.

**Only accepted rows are billed.** `insertLogEntries` returns the rows the primary key had not
already seen. Every client replays its durable queue after a crash, and billing somebody for their
own replay is both wrong and visible to them.

**The write cannot fail a request.** The entries are durable before it runs, so a throw there would
earn a 5xx for work that already succeeded and every client would retry a batch that can only
deduplicate. Rule 7 outranks the invoice.

## Going over does nothing

Nothing in the ingest path consults a plan, in either edition. An entry is never refused because a
workspace is over its limit or behind on a payment, and no board is ever closed for it.

| state | what happens |
|---|---|
| under 80% | nothing |
| 80% | the meter turns amber; a banner in the shell |
| over 100% | the meter turns red; the banner says everything is still being recorded |
| `past_due` | a banner asking an admin to fix the card. Reads are never gated |

Reading their own data is what makes somebody come back and pay. A customer who loses telemetry
over a late invoice has lost the month, and they do not upgrade afterwards.

## Stripe

No SDK. `apps/web/src/lib/stripe.server.ts` is four endpoints over `fetch` and one HMAC.

**No card details reach this codebase.** Checkout and the Billing Portal are hosted on Stripe's own
origin, which is why this repo has no PCI surface at all.

### Setting it up

1. Create a **billing meter** in Stripe with event name `firstrun_entries` (or set
   `STRIPE_METER_EVENT`), aggregating by sum, mapped on `stripe_customer_id`.
2. Create one **metered price** per paid tier against that meter, tiered so the included volume and
   the overage rate are set in Stripe. Pricing lives there; `PLANS` here is the entitlement the UI
   meter is drawn against, not the price.
3. Set the billing cycle anchor to the **1st of the month**. The meter window is the UTC calendar
   month, and it is the only thing that has to agree with Stripe.
4. Point a webhook at `POST <PUBLIC_ORIGIN>/api/stripe/webhook` for
   `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
   `invoice.payment_failed`.
5. Set `FIRSTRUN_CLOUD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_SCALE`.

### The webhook

Mounted in `apps/web/src/server.ts` **above** the data-plane guard, which answers `null` for
anything outside `/v1/` and hands it to SSR. It also has to see the raw `Request`: the signature is
over the exact bytes of the body, and anything that parses and re-serialises the JSON first
produces a signature that never matches.

Every handler writes **absolute state**, never a delta, so a Stripe retry or an out-of-order
delivery lands on the same row. That is why there is no processed-event table.

### The meter push

An hourly job in `context.server.ts` sends yesterday and today. Both, because the job runs on an
interval rather than at a wall-clock hour, and the run that straddles midnight would otherwise
leave a day unsent.

The event identifier is `${workspaceId}:${day}`. Stripe enforces identifier uniqueness over a
rolling window of at least 24 hours, which is what makes a repeat run harmless. Beyond that window
it would not be, which is why this only pushes recent days and never backfills.
