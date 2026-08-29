export const fmt = (n: number): string => n.toLocaleString("en-US");

export function pct(part: number, whole: number | undefined | null): string | null {
  if (!whole) return null;
  const p = (part / whole) * 100;
  if (p >= 10) return p.toFixed(0) + "%";
  if (p >= 1) return p.toFixed(1) + "%";
  return p.toFixed(2) + "%";
}

/** Change against the previous window, as a signed percentage. */
export function delta(now: number, before: number): { dir: "up" | "down" | "flat"; label: string } {
  if (!before) return { dir: "flat", label: now > 0 ? "new" : "no change" };
  const change = ((now - before) / before) * 100;
  if (Math.abs(change) < 0.5) return { dir: "flat", label: "no change" };
  const dir = change > 0 ? "up" : "down";
  return { dir, label: `${change > 0 ? "+" : ""}${change.toFixed(change > 100 ? 0 : 1)}%` };
}

export function shortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Numeric-segment comparison, so 1.10.0 sorts above 1.9.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
