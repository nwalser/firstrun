import { PLANS, usageLevel, usageRatio, type PlanId } from "@firstrun/schema/plan";
import { createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import Check from "lucide-solid/icons/check";
import ServerCog from "lucide-solid/icons/server-cog";
import { For, Show, createMemo, createSignal } from "solid-js";
import { PLAN_KEYS, PLAN_ORDER } from "../components/plan-meter.js";
import {
  SettingsPending,
  SettingsSection,
  SettingsShell,
} from "../components/settings-shell.js";
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  toast,
} from "../components/ui/index.js";
import { getSession, getWorkspace, openBillingPortalFn, startCheckoutFn } from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Plan and billing, for the hosted service.
 *
 * The route exists in both editions and says something different in each. Self
 * hosted it is a single card explaining that there is nothing here: every
 * feature is on, there are no limits, and there is nothing to pay or license.
 * That is worth a page rather than a 404, because "where is billing" is a
 * question somebody will ask, and answering it once beats leaving a hole where
 * a competitor has a paywall.
 *
 * Nothing on this page can take anything away. Going over a plan does not stop
 * ingest, does not drop entries and does not close a board, and the copy says
 * so. What upgrading buys is headroom, not access to what was already recorded.
 *
 * No card fields anywhere. Both buttons hand off to Stripe's own hosted pages,
 * which is why this repo has no PCI surface at all.
 */
export const Route = createFileRoute("/w/$wslug/settings/billing")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const view = await getWorkspace({ data: params.wslug });
    if (!view) throw notFound();
    return view;
  },
  component: WorkspaceBilling,
  pendingComponent: SettingsPending,
});

function WorkspaceBilling() {
  const view = Route.useLoaderData();
  const i18n = useI18n();
  const [busy, setBusy] = createSignal<PlanId | "portal" | null>(null);

  const workspace = () => view().workspace;
  const billing = () => view().billing;
  const isAdmin = () => workspace().role === "admin";

  const limit = () => billing().entitlements.entriesPerMonth;
  const used = () => billing().period.entries;
  const level = createMemo(() => usageLevel(used(), limit()));

  /**
   * Sends the browser to Stripe.
   *
   * A full navigation rather than a new tab: Checkout comes back to this page
   * through its own success and cancel URLs, and a popup that a blocker eats is
   * a button that silently does nothing.
   */
  const go = async (target: PlanId | "portal") => {
    setBusy(target);
    try {
      const result =
        target === "portal"
          ? await openBillingPortalFn({ data: { workspace: workspace().slug } })
          : await startCheckoutFn({ data: { workspace: workspace().slug, plan: target } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.url;
    } catch {
      toast.error(i18n.t("billing.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsShell title={i18n.t("billing.title")} description={i18n.t("billing.hint")}>
      <Show
        when={billing().cloud}
        fallback={
          <SettingsSection id="self-hosted" title={i18n.t("billing.self_hosted")}>
            <Empty>
              <EmptyMedia>
                <ServerCog />
              </EmptyMedia>
              <EmptyTitle>{i18n.t("billing.self_hosted")}</EmptyTitle>
              <EmptyDescription>{i18n.t("billing.self_hosted_body")}</EmptyDescription>
            </Empty>
          </SettingsSection>
        }
      >
        {/* What is being used, before what it costs. Somebody opening this page
            is asking one of two questions and this is the more common one. */}
        <SettingsSection
          id="usage"
          title={i18n.t("billing.included")}
          description={i18n.t("billing.on_arrival")}
        >
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-2">
              <span class="text-h2 tabular-nums">{i18n.num(used())}</span>
              <Show when={limit()}>
                {(cap) => (
                  <span class="text-caption text-muted-foreground">
                    {i18n.t("billing.of_limit", { limit: i18n.num(cap()) })}
                  </span>
                )}
              </Show>
              <Badge
                variant={
                  level() === "over"
                    ? "destructive"
                    : level() === "warn"
                      ? "outline"
                      : "secondary"
                }
              >
                {level() === "over"
                  ? i18n.t("billing.over")
                  : level() === "warn"
                    ? i18n.t("billing.warn")
                    : i18n.t("billing.ok")}
              </Badge>
            </div>
            <p class="text-caption text-muted-foreground">
              {i18n.dateRange(billing().period.from, billing().period.to)}
            </p>
            <Show when={level() === "over"}>
              <p class="text-small">{i18n.t("billing.over_body")}</p>
            </Show>
            <Show when={billing().status === "past_due"}>
              <p class="text-small text-negative">{i18n.t("billing.past_due_body")}</p>
            </Show>
            <Show when={billing().status === "canceled"}>
              <p class="text-small text-muted-foreground">{i18n.t("billing.canceled_body")}</p>
            </Show>
          </div>
        </SettingsSection>

        <SettingsSection
          id="plan"
          title={i18n.t("billing.plan")}
          footer={
            <Show when={isAdmin()} fallback={i18n.t("billing.admin_only")}>
              {/* The portal is where a card is changed, a plan is downgraded and
                  an invoice is read. It is only useful once there is something
                  to manage, so it appears with the first subscription. */}
              <Show when={billing().plan !== "free"}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy() !== null}
                  onClick={() => void go("portal")}
                >
                  {i18n.t("billing.manage")}
                </Button>
              </Show>
            </Show>
          }
        >
          <div class="grid gap-3 @xl-page/page:grid-cols-3">
            <For each={PLAN_ORDER}>
              {(id) => {
                const plan = PLANS[id];
                const current = () => billing().plan === id;
                return (
                  <div
                    class={cn(
                      "flex flex-col gap-3 rounded-md border p-4",
                      current() ? "border-foreground" : "border-border"
                    )}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-medium">{i18n.t(PLAN_KEYS[id])}</span>
                      <Show when={current()}>
                        <Badge variant="secondary">{i18n.t("billing.current")}</Badge>
                      </Show>
                    </div>

                    <div class="text-body">
                      {plan.monthlyCents === 0
                        ? i18n.t("billing.free_price")
                        : i18n.t("billing.per_month", {
                            price: i18n.num(plan.monthlyCents / 100, {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 0,
                            }),
                          })}
                    </div>

                    <ul class="flex flex-col gap-1 text-caption text-muted-foreground">
                      <li class="flex items-start gap-1.5">
                        <Check class="mt-0.5 size-3.5 shrink-0" />
                        {i18n.t("billing.entries_per_month", {
                          count: i18n.compact(plan.entitlements.entriesPerMonth ?? 0),
                        })}
                      </li>
                      <li class="flex items-start gap-1.5">
                        <Check class="mt-0.5 size-3.5 shrink-0" />
                        {plan.entitlements.projects === null
                          ? i18n.t("billing.projects_unlimited")
                          : i18n.t("billing.projects_limit", {
                              count: plan.entitlements.projects,
                            })}
                      </li>
                      <li class="flex items-start gap-1.5">
                        <Check class="mt-0.5 size-3.5 shrink-0" />
                        {i18n.t("billing.members_unlimited")}
                      </li>
                    </ul>

                    <Show when={isAdmin() && !current() && id !== "free"}>
                      <Button
                        size="sm"
                        class="mt-auto"
                        disabled={busy() !== null}
                        onClick={() => void go(id)}
                      >
                        {i18n.t("billing.select", { plan: i18n.t(PLAN_KEYS[id]) })}
                      </Button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </SettingsSection>
      </Show>
    </SettingsShell>
  );
}
