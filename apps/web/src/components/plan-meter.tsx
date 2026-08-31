import { PLANS, usageLevel, usageRatio, type PlanId } from "@firstrun/schema/plan";
import { Link } from "@tanstack/solid-router";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Show, createMemo } from "solid-js";
import type { BillingView, MemberRole } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  buttonVariants,
  Card,
  CardContent,
} from "./ui/index.js";

/**
 * The plan meter, and the notice that appears when a workspace passes it.
 *
 * ## Everything here is conditioned on a ceiling existing
 *
 * `entitlements.entriesPerMonth === null` means NO LIMIT, and every component
 * in this file renders nothing for it. That is the whole of the self-hosted
 * story in the UI: a self-hoster resolves UNLIMITED on the server, so the meter
 * and the notice do not appear, and there is no edition check, no licence
 * prompt and nothing visibly switched off. It is also what the usage page has
 * always said about itself, that a progress bar with no limit behind it is a
 * decoration pretending to be a number.
 *
 * ## Nothing here threatens anything
 *
 * Passing the plan does not stop ingest, does not drop entries and does not
 * close a board. Rule 7 covers the first of those and product sense covers the
 * rest, and the copy says so in as many words: a warning that implies data loss
 * where there is none costs more trust than the upgrade it is asking for.
 */

const PLAN_KEYS = {
  free: "billing.plan_free",
  pro: "billing.plan_pro",
  scale: "billing.plan_scale",
} as const satisfies Record<PlanId, SimpleKey>;

/** The tiers, cheapest first, which is the order they read in. */
const PLAN_ORDER: PlanId[] = ["free", "pro", "scale"];

export { PLANS, PLAN_KEYS, PLAN_ORDER };

/** The bar. A local element rather than a `ui` primitive: one use, six lines. */
function Bar(props: { ratio: number; tone: string }) {
  return (
    <div
      class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, props.ratio) * 100)}
    >
      <div
        class={cn("h-full rounded-full transition-[width]", props.tone)}
        style={{ width: `${Math.min(100, Math.max(0, props.ratio * 100))}%` }}
      />
    </div>
  );
}

const TONES = {
  ok: "bg-foreground",
  warn: "bg-warning",
  over: "bg-negative",
} as const;

export interface PlanMeterProps {
  billing: BillingView;
  workspaceSlug: string;
  role: MemberRole;
}

/**
 * The included-entries meter, for the usage page.
 *
 * A separate card from the volume summary beside it, because the two count
 * different things. This one counts entries as they ARRIVE, which is what
 * closes a month and what an invoice can be checked against. The summary and
 * the chart count them on the entry's own timestamp, which is when they
 * happened. The caption says which this is: two numbers on one page that do not
 * match have to explain themselves before somebody files it as a bug.
 */
export function PlanMeter(props: PlanMeterProps) {
  const i18n = useI18n();

  const limit = () => props.billing.entitlements.entriesPerMonth;
  const used = () => props.billing.period.entries;
  const level = createMemo(() => usageLevel(used(), limit()));
  const ratio = createMemo(() => usageRatio(used(), limit()) ?? 0);

  return (
    <Show when={limit()}>
      {(cap) => (
        <Card>
          <CardContent class="flex flex-col gap-4 @md-page/page:flex-row @md-page/page:items-start @md-page/page:gap-10">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 text-caption text-muted-foreground">
                {i18n.t("billing.included")}
                <Badge variant="secondary">{i18n.t(PLAN_KEYS[props.billing.plan])}</Badge>
              </div>

              <div class="mt-1 flex items-baseline gap-2">
                <span class="text-h1 tabular-nums">{i18n.num(used())}</span>
                <span class="text-caption text-muted-foreground">
                  {i18n.t("billing.of_limit", { limit: i18n.num(cap()) })}
                </span>
                <span
                  class={cn(
                    "text-caption tabular-nums",
                    level() === "over"
                      ? "text-negative"
                      : level() === "warn"
                        ? "text-warning"
                        : "text-muted-foreground"
                  )}
                >
                  {i18n.percent(ratio())}
                </span>
              </div>

              <div class="mt-2 max-w-md">
                <Bar ratio={ratio()} tone={TONES[level() ?? "ok"]} />
              </div>

              <div class="mt-1.5 truncate text-caption text-muted-foreground">
                {/* Exclusive at the top, like every other range here, so
                    `dateRange` reads it the same way it reads a window. */}
                {i18n.dateRange(props.billing.period.from, props.billing.period.to)}
                {" · "}
                {level() === "over"
                  ? i18n.t("billing.over")
                  : level() === "warn"
                    ? i18n.t("billing.warn")
                    : i18n.t("billing.ok")}
              </div>
            </div>

            <div class="flex flex-col items-start gap-2 @md-page/page:items-end">
              <Show
                when={props.role === "admin"}
                fallback={
                  <p class="text-caption text-muted-foreground">{i18n.t("billing.admin_only")}</p>
                }
              >
                {/* `Link` carrying the button's classes rather than
                    `Button as={Link}`: the polymorphic props widen the router
                    to `AnyRouter` and lose the typed `params`, which is the one
                    thing worth keeping about a typed router. */}
                <Link
                  to="/w/$wslug/settings/billing"
                  params={{ wslug: props.workspaceSlug }}
                  class={buttonVariants({
                    size: "sm",
                    variant: level() === "ok" ? "outline" : "default",
                  })}
                >
                  {props.billing.plan === "scale"
                    ? i18n.t("billing.manage")
                    : i18n.t("billing.upgrade")}
                </Link>
              </Show>
              <p class="max-w-xs text-caption text-muted-foreground @md-page/page:text-right">
                {i18n.t("billing.on_arrival")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </Show>
  );
}

/**
 * The plan, beside the workspace name in the sidebar header.
 *
 * Cloud only, and it shows the FREE tier too: the point is that somebody can
 * always see what the workspace they are looking at is on, and a badge that
 * only appears once you are paying tells you nothing at the moment you are
 * deciding whether to. Self hosted there is no plan, so there is no badge.
 *
 * It turns when something needs attention, which is the same signal the shell
 * banner carries, at a glance and without taking a row of the page.
 */
export function PlanBadge(props: { billing: BillingView }) {
  const i18n = useI18n();

  const attention = () =>
    props.billing.status === "past_due" ||
    usageLevel(props.billing.period.entries, props.billing.entitlements.entriesPerMonth) === "over";

  return (
    <Show when={props.billing.cloud}>
      <Badge
        variant={attention() ? "destructive" : "secondary"}
        class="ml-auto shrink-0 text-caption"
      >
        {i18n.t(PLAN_KEYS[props.billing.plan])}
      </Badge>
    </Show>
  );
}

/**
 * The workspace-wide notice, rendered by the shell.
 *
 * Three things can put it there and they are ranked, because only one banner is
 * ever worth showing: a failed payment first, since somebody has to act on it,
 * then over the limit, then approaching it. Below that it renders nothing, and
 * on a self-hosted install it renders nothing at all.
 *
 * Readers see it as well as admins. A reader cannot fix it, and the copy tells
 * them who can rather than hiding a fact about the workspace they are looking
 * at.
 */
export function PlanNotice(props: PlanMeterProps) {
  const i18n = useI18n();

  const level = () =>
    usageLevel(props.billing.period.entries, props.billing.entitlements.entriesPerMonth);

  const state = createMemo(() => {
    if (!props.billing.cloud) return null;
    if (props.billing.status === "past_due") return "past_due" as const;
    const l = level();
    return l === "over" || l === "warn" ? l : null;
  });

  const percent = () =>
    i18n.percent(
      usageRatio(props.billing.period.entries, props.billing.entitlements.entriesPerMonth) ?? 0
    );

  return (
    <Show when={state()}>
      {(kind) => (
        <Alert variant={kind() === "warn" ? "warning" : "destructive"} class="mt-4">
          <TriangleAlert />
          <AlertTitle>
            {kind() === "past_due"
              ? i18n.t("billing.past_due")
              : kind() === "over"
                ? i18n.t("billing.over")
                : i18n.t("billing.warn")}
          </AlertTitle>
          <AlertDescription class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {kind() === "past_due"
                ? i18n.t("billing.past_due_body")
                : kind() === "over"
                  ? i18n.t("billing.over_body")
                  : i18n.t("billing.warn_body", { percent: percent() })}
            </span>
            <Show
              when={props.role === "admin"}
              fallback={<span class="opacity-80">{i18n.t("billing.admin_only")}</span>}
            >
              <Link
                to="/w/$wslug/settings/billing"
                params={{ wslug: props.workspaceSlug }}
                class="font-medium underline underline-offset-2"
              >
                {kind() === "past_due" ? i18n.t("billing.manage") : i18n.t("billing.upgrade")}
              </Link>
            </Show>
          </AlertDescription>
        </Alert>
      )}
    </Show>
  );
}
