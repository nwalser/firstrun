import { For, Show, createMemo } from "solid-js";
import type { Snapshot } from "@firstrun/db";
import { METRIC_LABELS, type Widget } from "@firstrun/schema";
import { cn } from "../lib/cn.js";
import { compareVersions, delta, fmt, pct, shortDate } from "./format.js";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/index.js";

/**
 * One component per catalogue entry.
 *
 * Every widget renders from the snapshot the page already fetched, so adding a
 * card costs a render and not a round trip.
 *
 * Exact and estimated never share a colour. `text-exact` is the plain
 * foreground; `text-estimate` is amber, everywhere, always. See CLAUDE.md rule 1.
 */

export interface WidgetProps {
  widget: Widget;
  snapshot: Snapshot;
}

const metricValue = (snap: Snapshot, metric: string): { exact: number; estimated: number } => {
  switch (metric) {
    case "visited":
      return { exact: snap.funnel.exact.visited, estimated: snap.funnel.estimated.visited };
    case "downloaded":
      return { exact: snap.funnel.exact.downloaded, estimated: snap.funnel.estimated.downloaded };
    case "first_run":
      return { exact: snap.funnel.exact.first_run, estimated: snap.funnel.estimated.first_run };
    case "day7":
      return { exact: snap.day7.exact.day7, estimated: snap.day7.estimated.day7 };
    case "paid":
      return { exact: snap.funnel.exact.paid, estimated: snap.funnel.estimated.paid };
    case "active_installs": {
      const n = snap.versions.reduce((s, r) => s + r.active, 0);
      return { exact: n, estimated: n };
    }
    case "quiet_installs": {
      const n = snap.versions.reduce((s, r) => s + r.quiet, 0);
      return { exact: n, estimated: n };
    }
    default:
      return { exact: 0, estimated: 0 };
  }
};

function Swatch(props: { class: string }) {
  return <span class={cn("inline-block size-2 rounded-[2px]", props.class)} />;
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export function FunnelWidgetView(props: { snapshot: Snapshot }) {
  const steps = createMemo(() => {
    const f = props.snapshot.funnel;
    const d = props.snapshot.day7;
    return [
      { label: "Visited", exact: f.exact.visited, estimated: f.estimated.visited, base: undefined as number | undefined },
      { label: "Downloaded", exact: f.exact.downloaded, estimated: f.estimated.downloaded, base: f.exact.visited },
      { label: "First run", exact: f.exact.first_run, estimated: f.estimated.first_run, base: f.exact.downloaded },
      { label: "Day 7", exact: d.exact.day7, estimated: d.estimated.day7, base: f.exact.first_run },
      { label: "Paid", exact: f.exact.paid, estimated: f.estimated.paid, base: d.exact.day7 },
    ];
  });

  const top = () => Math.max(1, steps()[0]!.exact);

  return (
    <>
      <div class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
        <For each={steps()}>
          {(s) => {
            const extra = Math.max(0, s.estimated - s.exact);
            const conversion = pct(s.exact, s.base);
            return (
              <div class="min-w-0 bg-card p-3.5">
                <div class="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  {s.label}
                </div>
                <div class="mt-1.5 text-3xl font-semibold leading-none tracking-tight text-exact">
                  {fmt(s.exact)}
                </div>
                <div class={cn("mt-1.5 text-xs", extra > 0 ? "text-estimate" : "text-muted-foreground/50")}>
                  {extra > 0 ? `+${fmt(extra)} estimated` : "no estimated matches"}
                </div>
                <div class="mt-2.5 flex h-[3px] overflow-hidden rounded-full bg-muted">
                  <i
                    class="block h-full bg-exact"
                    style={{ width: `${Math.min(100, (s.exact / top()) * 100)}%` }}
                  />
                  <i
                    class="block h-full bg-estimate/75"
                    style={{ width: `${Math.min(100, (extra / top()) * 100)}%` }}
                  />
                </div>
                <div class="mt-2 h-4 text-[11px] text-muted-foreground">
                  {conversion ? `${conversion} of ${fmt(s.base!)}` : ""}
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span class="flex items-center gap-1.5">
          <Swatch class="bg-exact" />
          Exact — joined by a download token or a shared account id
        </span>
        <span class="flex items-center gap-1.5">
          <Swatch class="bg-estimate" />
          Estimated — matched on network and OS, never merged into a person
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Single number
// ---------------------------------------------------------------------------

export function MetricWidgetView(props: { widget: Extract<Widget, { type: "metric" }>; snapshot: Snapshot }) {
  const value = () => metricValue(props.snapshot, props.widget.metric);
  const extra = () => Math.max(0, value().estimated - value().exact);

  const change = createMemo(() => {
    const prev = props.snapshot.previous;
    if (!props.widget.compare || !prev) return null;
    const before = metricValue(
      { ...props.snapshot, funnel: prev.funnel, day7: prev.day7 } as Snapshot,
      props.widget.metric
    );
    return delta(value().exact, before.exact);
  });

  return (
    <div>
      <div class="text-4xl font-semibold leading-none tracking-tight text-exact">
        {fmt(value().exact)}
      </div>
      <Show when={extra() > 0}>
        <div class="mt-1.5 text-xs text-estimate">+{fmt(extra())} estimated</div>
      </Show>
      <Show when={change()}>
        {(c) => (
          <div class="mt-2 flex items-center gap-2 text-xs">
            <span
              class={cn(
                "font-medium",
                c().dir === "up" && "text-positive",
                c().dir === "down" && "text-destructive",
                c().dir === "flat" && "text-muted-foreground"
              )}
            >
              {c().label}
            </span>
            <span class="text-muted-foreground">vs previous period</span>
          </div>
        )}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Over time
// ---------------------------------------------------------------------------

export function TimeseriesWidgetView(props: {
  widget: Extract<Widget, { type: "timeseries" }>;
  snapshot: Snapshot;
}) {
  const points = () => props.snapshot.series[props.widget.metric] ?? [];
  const max = () => Math.max(1, ...points().map((p) => p.people));

  const W = 300;
  const H = 72;

  return (
    <Show
      when={points().length > 0}
      fallback={<div class="text-sm text-muted-foreground">No data in this window.</div>}
    >
      <svg
        class="block h-[72px] w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${METRIC_LABELS[props.widget.metric]} per day`}
      >
        <For each={points()}>
          {(p, i) => {
            const bw = W / points().length;
            const h = Math.max(p.people > 0 ? 1.5 : 0, (p.people / max()) * H);
            return (
              <rect
                class="fill-chart-1 opacity-80 hover:opacity-100"
                x={i() * bw}
                y={H - h}
                width={Math.max(1, bw - 1.5)}
                height={h}
                rx="1"
              >
                <title>{`${shortDate(p.day)} — ${fmt(p.people)}`}</title>
              </rect>
            );
          }}
        </For>
      </svg>
      <div class="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{shortDate(points()[0]!.day)}</span>
        <span>peak {fmt(max())}</span>
        <span>{shortDate(points()[points().length - 1]!.day)}</span>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function VersionsWidgetView(props: {
  widget: Extract<Widget, { type: "versions" }>;
  snapshot: Snapshot;
}) {
  const rows = createMemo(() =>
    [...props.snapshot.versions].sort((a, b) => compareVersions(b.app_version, a.app_version))
  );
  const latest = () => rows()[0]?.app_version ?? null;
  const totalInstalls = () => Math.max(1, rows().reduce((s, r) => s + r.installs, 0));
  const quietOnOld = () =>
    rows()
      .filter((r) => latest() !== null && compareVersions(r.app_version, latest()!) < 0)
      .reduce((s, r) => s + r.quiet, 0);

  return (
    <Show
      when={rows().length > 0}
      fallback={<div class="text-sm text-muted-foreground">No app events yet.</div>}
    >
      <p class="mb-3 text-xs text-muted-foreground">
        Latest is {latest()}. <span class="font-semibold text-destructive">{fmt(quietOnOld())}</span>{" "}
        installs on an older version have gone quiet — nothing for {props.widget.quietDays} days.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Installs</TableHead>
            <TableHead>Share</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Quiet</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={rows()}>
            {(r) => {
              const outdated = latest() !== null && compareVersions(r.app_version, latest()!) < 0;
              return (
                <TableRow>
                  <TableCell class={cn(outdated && "text-destructive")}>
                    {r.app_version}
                    <Show when={!outdated}>
                      <Badge variant="outline" class="ml-2 align-middle">
                        latest
                      </Badge>
                    </Show>
                  </TableCell>
                  <TableCell>{fmt(r.installs)}</TableCell>
                  <TableCell class="text-muted-foreground">
                    {((r.installs / totalInstalls()) * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell>{fmt(r.active)}</TableCell>
                  <TableCell class={cn(r.quiet > 0 && "font-semibold text-destructive")}>
                    {fmt(r.quiet)}
                  </TableCell>
                </TableRow>
              );
            }}
          </For>
        </TableBody>
      </Table>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Join health
// ---------------------------------------------------------------------------

export function JoinHealthWidgetView(props: { snapshot: Snapshot }) {
  const exact = () => props.snapshot.funnel.exact.first_run;
  const estimated = () => Math.max(0, props.snapshot.funnel.estimated.first_run - exact());
  const total = () => Math.max(1, exact() + estimated());

  return (
    <div>
      <div class="mb-3 flex h-2 overflow-hidden rounded-full bg-muted">
        <i class="block h-full bg-exact" style={{ width: `${(exact() / total()) * 100}%` }} />
        <i class="block h-full bg-estimate" style={{ width: `${(estimated() / total()) * 100}%` }} />
      </div>

      <div class="flex items-center justify-between py-0.5 text-xs">
        <span class="flex items-center gap-1.5 text-muted-foreground">
          <Swatch class="bg-exact" />
          Proven
        </span>
        <span>{fmt(exact())}</span>
      </div>
      <div class="flex items-center justify-between py-0.5 text-xs">
        <span class="flex items-center gap-1.5 text-muted-foreground">
          <Swatch class="bg-estimate" />
          Estimated
        </span>
        <span>{fmt(estimated())}</span>
      </div>

      <p class="mt-3 text-xs text-muted-foreground">
        {pct(exact(), total())} of installs can be traced to a visit with certainty. The rest are a
        guess and never change who anybody is.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retention curve
// ---------------------------------------------------------------------------

export function RetentionWidgetView(props: { snapshot: Snapshot }) {
  const points = () => props.snapshot.retention.filter((p) => p.eligible > 0);

  const W = 300;
  const H = 80;

  const path = createMemo(() => {
    const pts = points();
    if (pts.length === 0) return "";
    const maxDay = Math.max(1, ...pts.map((p) => p.day));
    return pts
      .map((p, i) => {
        const x = (p.day / maxDay) * W;
        const y = H - (p.retained / p.eligible) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  });

  const dayN = (n: number) => {
    const p = points().find((x) => x.day === n);
    return p && p.eligible > 0 ? Math.round((p.retained / p.eligible) * 100) : null;
  };

  return (
    <Show
      when={points().length > 1}
      fallback={<div class="text-sm text-muted-foreground">Not enough history yet.</div>}
    >
      <svg
        class="block h-20 w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Retention by day since first run"
      >
        <defs>
          <linearGradient id="retention-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-chart-1)" stop-opacity="0.3" />
            <stop offset="100%" stop-color="var(--color-chart-1)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path fill="url(#retention-fade)" d={`${path()} L${W},${H} L0,${H} Z`} />
        <path
          fill="none"
          stroke="var(--color-chart-1)"
          stroke-width="1.75"
          vector-effect="non-scaling-stroke"
          d={path()}
        />
      </svg>
      <div class="mt-2 flex gap-4 text-[11px] text-muted-foreground">
        <For each={[1, 7, 14, 30]}>
          {(d) => (
            <Show when={dayN(d) !== null}>
              <span>
                d{d} <span class="font-semibold text-foreground">{dayN(d)}%</span>
              </span>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function defaultTitle(widget: Widget): string {
  switch (widget.type) {
    case "funnel":
      return "Visit to paid";
    case "metric":
      return METRIC_LABELS[widget.metric];
    case "timeseries":
      return `${METRIC_LABELS[widget.metric]} per day`;
    case "versions":
      return "Versions";
    case "join_health":
      return "Join health";
    case "retention":
      return "Retention";
  }
}

export function WidgetBody(props: WidgetProps) {
  return (
    <>
      <Show when={props.widget.type === "funnel"}>
        <FunnelWidgetView snapshot={props.snapshot} />
      </Show>
      <Show when={props.widget.type === "metric"}>
        <MetricWidgetView widget={props.widget as never} snapshot={props.snapshot} />
      </Show>
      <Show when={props.widget.type === "timeseries"}>
        <TimeseriesWidgetView widget={props.widget as never} snapshot={props.snapshot} />
      </Show>
      <Show when={props.widget.type === "versions"}>
        <VersionsWidgetView widget={props.widget as never} snapshot={props.snapshot} />
      </Show>
      <Show when={props.widget.type === "join_health"}>
        <JoinHealthWidgetView snapshot={props.snapshot} />
      </Show>
      <Show when={props.widget.type === "retention"}>
        <RetentionWidgetView snapshot={props.snapshot} />
      </Show>
    </>
  );
}
