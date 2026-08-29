import { For, Show, createMemo } from "solid-js";
import type { Snapshot } from "@firstrun/db";
import { METRIC_LABELS, type Widget } from "@firstrun/schema";
import { compareVersions, delta, fmt, pct, shortDate } from "./format.js";

/**
 * One component per catalogue entry.
 *
 * Every widget renders from the snapshot the page already fetched, so adding a
 * card to a dashboard costs a render and not a round trip. A configurable
 * dashboard where each card fetches its own data is how a screen with eight
 * cards ends up making eight requests for numbers that came from three queries.
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
      <div class="funnel-steps">
        <For each={steps()}>
          {(s) => {
            const extra = Math.max(0, s.estimated - s.exact);
            const conversion = pct(s.exact, s.base);
            return (
              <div class="step">
                <div class="label">{s.label}</div>
                <div class="value">{fmt(s.exact)}</div>
                <div class="est" data-none={extra === 0}>
                  {extra > 0 ? `+${fmt(extra)} estimated` : "no estimated matches"}
                </div>
                <div class="track">
                  <i style={{ width: `${Math.min(100, (s.exact / top()) * 100)}%` }} />
                  <i class="e" style={{ width: `${Math.min(100, (extra / top()) * 100)}%` }} />
                </div>
                <div class="conv">{conversion ? `${conversion} of ${fmt(s.base!)}` : " "}</div>
              </div>
            );
          }}
        </For>
      </div>
      <div class="chart-legend">
        <span>
          <i class="swatch" style={{ background: "var(--exact)" }} />
          Exact — joined by a download token or a shared account id
        </span>
        <span>
          <i class="swatch" style={{ background: "var(--estimate)" }} />
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
    <div class="metric">
      <div class="value">{fmt(value().exact)}</div>
      <Show when={extra() > 0}>
        <div class="est">+{fmt(extra())} estimated</div>
      </Show>
      <Show when={change()}>
        {(c) => (
          <div class="delta" data-dir={c().dir}>
            <span>{c().label}</span>
            <span class="meta">vs previous period</span>
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
  const gap = 1.5;

  return (
    <Show when={points().length > 0} fallback={<div class="meta">No data in this window.</div>}>
      <svg class="chart" viewBox={`0 0 ${W} ${H + 14}`} preserveAspectRatio="none" role="img">
        <For each={points()}>
          {(p, i) => {
            const bw = W / points().length;
            const h = Math.max(p.people > 0 ? 1.5 : 0, (p.people / max()) * H);
            return (
              <rect
                class="bar"
                x={i() * bw}
                y={H - h}
                width={Math.max(1, bw - gap)}
                height={h}
                rx="1"
              >
                <title>{`${shortDate(p.day)} — ${fmt(p.people)}`}</title>
              </rect>
            );
          }}
        </For>
        <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      </svg>
      <div class="chart-legend">
        <span>{shortDate(points()[0]!.day)}</span>
        <span class="spacer" />
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
    <Show when={rows().length > 0} fallback={<div class="meta">No app events yet.</div>}>
      <p class="meta" style={{ margin: "0 0 12px" }}>
        Latest is {latest()}. <strong style={{ color: "var(--warn)" }}>{fmt(quietOnOld())}</strong> installs
        on an older version have gone quiet — nothing for {props.widget.quietDays} days.
      </p>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Installs</th>
            <th>Share</th>
            <th>Active</th>
            <th>Quiet</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(r) => {
              const outdated = latest() !== null && compareVersions(r.app_version, latest()!) < 0;
              return (
                <tr data-outdated={outdated}>
                  <td>
                    {r.app_version}
                    <Show when={!outdated}>
                      <span class="pill" data-tone="good">
                        latest
                      </span>
                    </Show>
                  </td>
                  <td>{fmt(r.installs)}</td>
                  <td>{((r.installs / totalInstalls()) * 100).toFixed(0)}%</td>
                  <td>{fmt(r.active)}</td>
                  <td>{r.quiet > 0 ? <span class="quiet">{fmt(r.quiet)}</span> : "0"}</td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
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
      <div class="bar-split">
        <i class="exact" style={{ width: `${(exact() / total()) * 100}%` }} />
        <i class="est" style={{ width: `${(estimated() / total()) * 100}%` }} />
      </div>
      <div class="kv">
        <span class="k">
          <i class="swatch" style={{ background: "var(--exact)" }} />
          Proven
        </span>
        <span>{fmt(exact())}</span>
      </div>
      <div class="kv">
        <span class="k">
          <i class="swatch" style={{ background: "var(--estimate)" }} />
          Estimated
        </span>
        <span>{fmt(estimated())}</span>
      </div>
      <p class="meta" style={{ "margin-top": "10px" }}>
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
    <Show when={points().length > 1} fallback={<div class="meta">Not enough history yet.</div>}>
      <svg class="chart" viewBox={`0 0 ${W} ${H + 12}`} preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path class="area" d={`${path()} L${W},${H} L0,${H} Z`} />
        <path class="line" d={path()} />
        <line class="axis" x1="0" y1={H} x2={W} y2={H} />
      </svg>
      <div class="chart-legend">
        <For each={[1, 7, 14, 30]}>
          {(d) => (
            <Show when={dayN(d) !== null}>
              <span>
                d{d} <strong style={{ color: "var(--text)" }}>{dayN(d)}%</strong>
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
