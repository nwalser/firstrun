import { BILLING_STATUSES, PLAN_IDS, usageLevel, type PlanId } from "@firstrun/schema/plan";
import { Link, createFileRoute, notFound, useRouter } from "@tanstack/solid-router";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import CreditCard from "lucide-solid/icons/credit-card";
import Building2 from "lucide-solid/icons/building-2";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Fact, FactRow } from "../components/admin-shell.js";
import { PageHeader } from "../components/page-header.js";
import { PLAN_KEYS } from "../components/plan-meter.js";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Empty,
  EmptyMedia,
  EmptyTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "../components/ui/index.js";
import {
  forceWorkspacePlanFn,
  getAdminOverview,
  overrideWorkspaceLimitFn,
  type AdminWorkspaceView,
} from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";

/**
 * Every workspace on this deployment, and the two levers over its plan.
 *
 * ## A plan belongs to a workspace
 *
 * Every number in the table is therefore counted across all of that workspace's
 * projects, and `entries` is the same number the workspace's own meter draws:
 * one query, one definition, counted on arrival.
 *
 * ## Two different levers
 *
 * **Plan** writes the same columns Stripe writes, so it is overwritten by the
 * next subscription event for a workspace that actually pays. **Limit** writes
 * `plan_limits`, which nothing in the Stripe path touches, so it survives. The
 * page says this rather than leaving somebody to discover it when a forced plan
 * silently reverts.
 *
 * ## The guard is above this file and re-checked below it
 *
 * `/admin` resolves the operator once, for the shell it draws. This loader
 * still calls a server function that re-checks `requireInstanceAdmin`, and so
 * does every write on the page: the layout decides what is REACHABLE, not what
 * is allowed.
 */
export const Route = createFileRoute("/admin/workspaces")({
  loader: async () => {
    const view = await getAdminOverview();
    if (!view) throw notFound();
    return view;
  },
  component: AdminWorkspacesPage,
});

const STATUS_KEYS = {
  active: "admin.status_active",
  past_due: "admin.status_past_due",
  canceled: "admin.status_canceled",
} as const satisfies Record<(typeof BILLING_STATUSES)[number], SimpleKey>;

function AdminWorkspacesPage() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const i18n = useI18n();
  const [busy, setBusy] = createSignal<string | null>(null);

  const rows = () => view().workspaces;

  const totals = createMemo(() => ({
    workspaces: rows().length,
    entries: rows().reduce((sum, row) => sum + row.entriesThisMonth, 0),
    paying: rows().filter((row) => row.plan !== "free").length,
  }));

  /**
   * Every write reloads the loader rather than patching a signal.
   *
   * The row's effective limit is resolved on the server from the plan and the
   * override together, so guessing at the new one in the client would be
   * reimplementing `entitlementsFor` in a second place and getting it wrong the
   * first time a tier changes.
   */
  const refresh = () => router.invalidate();

  const setPlan = async (row: AdminWorkspaceView, plan: PlanId, status: string) => {
    setBusy(row.id);
    try {
      const result = await forceWorkspacePlanFn({
        data: { workspaceId: row.id, plan, status },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        i18n.t("admin.plan_forced", { workspace: row.name, plan: i18n.t(PLAN_KEYS[plan]) })
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  /**
   * Commits on blur and on Enter, not on every keystroke.
   *
   * A limit that saved as it was typed would pass through 1, 10 and 100 on the
   * way to 1000, and each of those is a real ceiling somebody's workspace was
   * briefly on.
   */
  const setLimit = async (row: AdminWorkspaceView, raw: string) => {
    const text = raw.trim();
    const value = text === "" ? null : Number(text.replace(/[\s_,]/g, ""));
    if (value !== null && !Number.isFinite(value)) {
      toast.error(i18n.t("admin.limit_placeholder"));
      return;
    }

    setBusy(row.id);
    try {
      const result = await overrideWorkspaceLimitFn({
        data: { workspaceId: row.id, entriesPerMonth: value },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        value === null
          ? i18n.t("admin.limit_cleared", { workspace: row.name })
          : i18n.t("admin.limit_set", { workspace: row.name, count: value })
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main class="px-6 pb-6">
      {/* No width cap and no centring here: the shell's content track is the
          same 1620px every other page in the product sits in. */}
      <PageHeader title={i18n.t("admin.workspaces_title")} />

      <div class="flex flex-col gap-4">
        {/* The same strip the overview opens with, kept here too: this is the
            page somebody arrives on from a support conversation, and a table of
            workspaces with no total above it makes you count rows. */}
        <FactRow>
          <Fact label={i18n.t("admin.workspaces")}>{i18n.num(totals().workspaces)}</Fact>
          <Fact label={i18n.t("admin.total_entries")}>{i18n.num(totals().entries)}</Fact>
          <Fact label={i18n.t("admin.paying")}>{i18n.num(totals().paying)}</Fact>
          <Fact label={i18n.t("admin.period")}>
            {i18n.dateRange(view().period.from, view().period.to)}
          </Fact>
        </FactRow>

        <Alert variant="warning">
          <AlertDescription>{i18n.t("admin.forced_warning")}</AlertDescription>
        </Alert>

        <Card>
          <CardContent class="px-0">
            <Show
              when={rows().length > 0}
              fallback={
                <Empty>
                  <EmptyMedia>
                    <Building2 />
                  </EmptyMedia>
                  <EmptyTitle>{i18n.t("admin.empty")}</EmptyTitle>
                </Empty>
              }
            >
              {/* The row carries two dropdowns and an input, so it is wider than
                  a phone. It scrolls inside the card rather than making the page
                  scroll sideways. */}
              <div class="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18n.t("admin.col_workspace")}</TableHead>
                      <TableHead>{i18n.t("admin.col_plan")}</TableHead>
                      <TableHead>{i18n.t("admin.col_status")}</TableHead>
                      <TableHead numeric>{i18n.t("admin.col_entries")}</TableHead>
                      <TableHead>{i18n.t("admin.col_limit")}</TableHead>
                      <TableHead numeric>{i18n.t("admin.col_projects")}</TableHead>
                      <TableHead numeric>{i18n.t("admin.col_people")}</TableHead>
                      <TableHead>{i18n.t("admin.col_last_seen")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <For each={rows()}>
                      {(row) => <WorkspaceRow row={row} busy={busy() === row.id} onPlan={setPlan} onLimit={setLimit} />}
                    </For>
                  </TableBody>
                </Table>
              </div>
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function WorkspaceRow(props: {
  row: AdminWorkspaceView;
  busy: boolean;
  onPlan: (row: AdminWorkspaceView, plan: PlanId, status: string) => void | Promise<void>;
  onLimit: (row: AdminWorkspaceView, raw: string) => void | Promise<void>;
}) {
  const i18n = useI18n();

  const level = () => usageLevel(props.row.entriesThisMonth, props.row.entriesLimit);
  /** The hand-tuned number, or empty when the workspace is on its plan's own. */
  const override = () =>
    props.row.overridden && props.row.entriesLimit !== null ? String(props.row.entriesLimit) : "";
  const plan = () => (PLAN_IDS.includes(props.row.plan as PlanId) ? (props.row.plan as PlanId) : "free");
  const status = () =>
    BILLING_STATUSES.includes(props.row.billingStatus as (typeof BILLING_STATUSES)[number])
      ? (props.row.billingStatus as (typeof BILLING_STATUSES)[number])
      : "active";

  return (
    <TableRow class={cn(props.busy && "opacity-60")}>
      <TableCell class="py-2">
        <div class="flex min-w-0 items-center gap-2">
          <Link
            to="/w/$wslug"
            params={{ wslug: props.row.slug }}
            class="truncate font-medium hover:underline"
          >
            {props.row.name}
          </Link>
          <Show when={props.row.hasStripeCustomer}>
            <CreditCard
              class="size-3.5 shrink-0 text-muted-foreground"
              aria-label={i18n.t("admin.stripe_linked")}
            />
          </Show>
        </div>
        <div class="truncate text-caption text-muted-foreground">{props.row.slug}</div>
      </TableCell>

      <TableCell class="py-2">
        <DropdownMenu>
          <DropdownMenuTrigger as={Button} variant="outline" size="sm" disabled={props.busy}>
            {i18n.t(PLAN_KEYS[plan()])}
            <ChevronsUpDown class="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{i18n.t("admin.set_plan")}</DropdownMenuLabel>
            <For each={PLAN_IDS}>
              {(id) => (
                <DropdownMenuItem onSelect={() => void props.onPlan(props.row, id, status())}>
                  <Check class={cn("size-4", plan() === id ? "opacity-100" : "opacity-0")} />
                  {i18n.t(PLAN_KEYS[id])}
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>

      <TableCell class="py-2">
        <DropdownMenu>
          <DropdownMenuTrigger as={Button} variant="ghost" size="sm" disabled={props.busy}>
            <Badge variant={status() === "active" ? "secondary" : "destructive"}>
              {i18n.t(STATUS_KEYS[status()])}
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{i18n.t("admin.set_status")}</DropdownMenuLabel>
            <For each={BILLING_STATUSES}>
              {(value) => (
                <DropdownMenuItem onSelect={() => void props.onPlan(props.row, plan(), value)}>
                  <Check class={cn("size-4", status() === value ? "opacity-100" : "opacity-0")} />
                  {i18n.t(STATUS_KEYS[value])}
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>

      <TableCell numeric class="py-2">
        <div
          class={cn(
            level() === "over"
              ? "text-negative"
              : level() === "warn"
                ? "text-warning"
                : undefined
          )}
        >
          {i18n.num(props.row.entriesThisMonth)}
        </div>
        <div class="text-caption text-muted-foreground">
          {i18n.t("admin.of_previous", { count: i18n.compact(props.row.entriesLastMonth) })}
        </div>
      </TableCell>

      <TableCell class="py-2">
        <div class="flex items-center gap-2">
          {/*
            The box holds the OVERRIDE, and the placeholder holds the plan's own
            number. Filling it with the effective limit instead would put a
            value in every row on the page and make every workspace look
            hand-tuned, which is exactly the thing this column exists to tell
            apart. Empty means "whatever the plan says", and that is also how it
            is cleared.

            Uncontrolled: the row is the state, and the loader reload after a
            save is what refills it.
          */}
          <Input
            class="h-8 w-32"
            inputMode="numeric"
            disabled={props.busy}
            value={override()}
            placeholder={
              props.row.entriesLimit === null
                ? i18n.t("admin.no_limit")
                : i18n.num(props.row.entriesLimit)
            }
            aria-label={i18n.t("admin.col_limit")}
            /*
              Only on a real change. Blur fires for every box somebody tabs
              through, and without this, walking the table with the keyboard
              would write an override to every row it passed and raise a toast
              for each one.
            */
            onBlur={(e) => {
              const next = e.currentTarget.value.trim();
              if (next !== override()) void props.onLimit(props.row, next);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
          />
          <Show when={props.row.overridden}>
            <Badge variant="outline">{i18n.t("admin.override")}</Badge>
          </Show>
        </div>
      </TableCell>

      <TableCell numeric class="py-2">
        {props.row.projects}
        <span class="text-muted-foreground">
          {props.row.projectsLimit === null ? "" : ` / ${props.row.projectsLimit}`}
        </span>
      </TableCell>

      <TableCell numeric class="py-2">
        {props.row.members}
      </TableCell>

      <TableCell class="py-2 text-caption text-muted-foreground">
        {props.row.lastBilledDay
          ? i18n.shortDate(props.row.lastBilledDay)
          : i18n.t("admin.never")}
      </TableCell>
    </TableRow>
  );
}
