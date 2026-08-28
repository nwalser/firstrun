import { ClickHouseClient } from "@firstrun/db/clickhouse";
import { day7, funnel, versions, type VersionRow } from "@firstrun/db/queries";

/**
 * The only screen.
 *
 * Five numbers across the top -- the chain from a stranger reading the
 * marketing site to a paying customer -- and underneath, which versions are
 * still running and which cohort has gone quiet.
 *
 * Exact and estimated are shown as two numbers, never one. An exact join is a
 * fact about a person; an estimated join is a guess about two rows. Adding them
 * together would produce a number that looks authoritative and is not, and
 * nothing downstream would ever notice. See CLAUDE.md rule 1.
 */

export const dynamic = "force-dynamic";

const DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const QUIET_DAYS = 14;

const INGEST = process.env.NEXT_PUBLIC_INGEST_ORIGIN ?? "http://localhost:4318";

interface Step {
  label: string;
  exact: number;
  estimated: number;
  /** The step this one converts from, for the percentage underneath. */
  base?: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

function pct(part: number, whole: number | undefined): string | null {
  if (!whole) return null;
  const p = (part / whole) * 100;
  return p >= 10 ? p.toFixed(0) + "%" : p.toFixed(1) + "%";
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function projectName(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${INGEST}/v1/projects/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { name?: string }).name ?? null;
  } catch {
    // The dashboard reads ClickHouse itself; the name is a nicety, not a
    // dependency. If ingest is down the screen still works.
    return null;
  }
}

export default async function FunnelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ch = new ClickHouseClient();
  const now = Date.now();
  const window = { projectId: id, from: now - DAYS * DAY, to: now + DAY };

  let data: {
    f: Awaited<ReturnType<typeof funnel>>;
    d7: Awaited<ReturnType<typeof day7>>;
    v: VersionRow[];
    name: string | null;
  };

  try {
    const [f, d7, v, name] = await Promise.all([
      funnel(ch, window),
      day7(ch, window),
      versions(ch, id, now, QUIET_DAYS),
      projectName(id),
    ]);
    data = { f, d7, v, name };
  } catch (err) {
    return <Unavailable message={err instanceof Error ? err.message : String(err)} />;
  }

  const { f, d7, v, name } = data;

  const steps: Step[] = [
    { label: "Visited", exact: f.exact.visited, estimated: f.estimated.visited },
    { label: "Downloaded", exact: f.exact.downloaded, estimated: f.estimated.downloaded, base: f.exact.visited },
    { label: "First run", exact: f.exact.first_run, estimated: f.estimated.first_run, base: f.exact.downloaded },
    { label: "Day 7", exact: d7.exact.day7, estimated: d7.estimated.day7, base: f.exact.first_run },
    { label: "Paid", exact: f.exact.paid, estimated: f.estimated.paid, base: d7.exact.day7 },
  ];

  const top = steps[0]!.exact || 1;

  const sorted = [...v].sort((a, b) => compareVersions(b.app_version, a.app_version));
  const latest = sorted[0]?.app_version ?? null;
  const quietOnOutdated = sorted
    .filter((r) => latest !== null && compareVersions(r.app_version, latest) < 0)
    .reduce((sum, r) => sum + r.quiet, 0);
  const totalInstalls = sorted.reduce((sum, r) => sum + r.installs, 0) || 1;

  return (
    <main className="wrap">
      <header className="page">
        <h1>{name ?? "Funnel"}</h1>
        <div className="window">last {DAYS} days</div>
      </header>

      <p className="lede">
        One person, from the first page view to the payment. A person is counted once, on whichever
        surface they appear.
      </p>

      <div className="funnel">
        {steps.map((s) => {
          const extra = Math.max(0, s.estimated - s.exact);
          const conversion = pct(s.exact, s.base);
          return (
            <div className="step" key={s.label}>
              <div className="label">{s.label}</div>
              <div className="value">{fmt(s.exact)}</div>
              <div className={extra > 0 ? "est" : "est none"}>
                {extra > 0 ? `+${fmt(extra)} estimated` : "no estimated matches"}
              </div>
              <div className="bar">
                <span style={{ width: `${Math.min(100, (s.exact / top) * 100)}%` }} />
              </div>
              <div className="conv">{conversion ? `${conversion} of ${s.base && fmt(s.base)}` : " "}</div>
            </div>
          );
        })}
      </div>

      <div className="legend">
        <span>
          <span className="swatch" style={{ background: "var(--exact)" }} />
          Exact — joined by a download token or a shared account id
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--estimate)" }} />
          Estimated — matched on network and OS within 30 minutes, never merged into a person
        </span>
      </div>

      <section className="versions">
        <h2>Versions</h2>
        <p className="note">
          {latest ? (
            <>
              Latest is {latest}. <strong>{fmt(quietOnOutdated)}</strong> installs on an older version
              have gone quiet — nothing for {QUIET_DAYS} days.
            </>
          ) : (
            <>No app events yet.</>
          )}
        </p>

        {sorted.length > 0 && (
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
              {sorted.map((r) => {
                const outdated = latest !== null && compareVersions(r.app_version, latest) < 0;
                return (
                  <tr key={r.app_version} className={outdated ? "outdated" : undefined}>
                    <td>
                      {r.app_version}
                      {!outdated && <span className="pill">latest</span>}
                    </td>
                    <td>{fmt(r.installs)}</td>
                    <td>{((r.installs / totalInstalls) * 100).toFixed(0)}%</td>
                    <td>{fmt(r.active)}</td>
                    <td className="quiet-cell">{r.quiet > 0 ? <strong>{fmt(r.quiet)}</strong> : "0"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <main className="wrap">
      <h1>No data</h1>
      <p className="lede">The funnel queries could not run.</p>
      <div className="error">
        <p>
          Start the stack, then reload:
          <br />
          <code>docker compose up -d &amp;&amp; bun run migrate &amp;&amp; bun run seed</code>
        </p>
        <p>
          <code>{message}</code>
        </p>
      </div>
    </main>
  );
}
