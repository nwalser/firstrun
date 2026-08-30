import { z } from "zod";

/**
 * The severity ladder, taken from the OpenTelemetry log data model.
 *
 * Twenty-four numbers in six bands of four. The bands are what a person reads
 * and filters on; the four steps inside a band are what a library uses when it
 * wants to say "a slightly worse warning than the last one" without inventing a
 * new level. We use the ladder rather than a six-value enum because it is the
 * spec's, and because a customer whose logger already has nine levels can map
 * onto it without losing the ordering.
 *
 * A number is authoritative. Text is derived from it and never stored: two
 * entries that sorted differently because one said "warn" and the other said
 * "WARNING" would be a bug nobody could see.
 */

export const SEVERITY_BANDS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;

export type SeverityBand = (typeof SEVERITY_BANDS)[number];

export const SEVERITY_MIN = 1;
export const SEVERITY_MAX = 24;

/** How many numbers each band owns. Four, in every band, by the spec. */
const BAND_WIDTH = 4;

/** The first number of each band. `SEVERITY.WARN` is the plain, unqualified warn. */
export const SEVERITY: Record<SeverityBand, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
};

export const SEVERITY_RANGE: Record<SeverityBand, { min: number; max: number }> = {
  TRACE: { min: 1, max: 4 },
  DEBUG: { min: 5, max: 8 },
  INFO: { min: 9, max: 12 },
  WARN: { min: 13, max: 16 },
  ERROR: { min: 17, max: 20 },
  FATAL: { min: 21, max: 24 },
};

/** How a band reads in a filter chip or a legend. */
export const SEVERITY_LABELS: Record<SeverityBand, string> = {
  TRACE: "Trace",
  DEBUG: "Debug",
  INFO: "Info",
  WARN: "Warning",
  ERROR: "Error",
  FATAL: "Fatal",
};

export const SeverityNumber = z.number().int().min(SEVERITY_MIN).max(SEVERITY_MAX);

export const SeverityBandSchema = z.enum(SEVERITY_BANDS);

const clamp = (n: number) => Math.min(SEVERITY_MAX, Math.max(SEVERITY_MIN, Math.round(n)));

/** Which band a number falls in. Total: out-of-range numbers clamp to an end. */
export function severityBand(n: number): SeverityBand {
  const idx = Math.floor((clamp(n) - 1) / BAND_WIDTH);
  return SEVERITY_BANDS[Math.min(SEVERITY_BANDS.length - 1, Math.max(0, idx))]!;
}

/**
 * The spec's short name: `INFO`, `INFO2`, `INFO3`, `INFO4`, then `WARN`.
 *
 * The first step of a band has no digit, which is why `severityText(9)` is
 * `INFO` and not `INFO1`. Round-trips through `severityNumber` exactly.
 */
export function severityText(n: number): string {
  const v = clamp(n);
  const band = severityBand(v);
  const step = (v - SEVERITY_RANGE[band].min) % BAND_WIDTH;
  return step === 0 ? band : `${band}${step + 1}`;
}

const TEXT_RE = /^([A-Za-z]+)([1-4])?$/;

/**
 * A short name back to its number, or null when it is not one of ours.
 *
 * Case-insensitive and tolerant of the two spellings people actually type, so a
 * customer sending `"warning"` or `"warn"` lands on the same 13. Null rather
 * than a default, because guessing a severity is worse than having none: an
 * entry with no severity is honestly unclassified, and one silently filed as
 * INFO is a lie a filter will act on.
 */
export function severityNumber(text: string): number | null {
  const m = TEXT_RE.exec(text.trim());
  if (!m) return null;
  const word = m[1]!.toUpperCase();
  const band = (SEVERITY_ALIASES[word] ?? (SEVERITY_BANDS as readonly string[]).find((b) => b === word)) as
    | SeverityBand
    | undefined;
  if (!band) return null;
  const step = m[2] ? Number(m[2]) - 1 : 0;
  return SEVERITY_RANGE[band].min + step;
}

/** The spellings people already have in their loggers, mapped onto a band. */
const SEVERITY_ALIASES: Record<string, SeverityBand> = {
  VERBOSE: "TRACE",
  FINE: "DEBUG",
  FINER: "TRACE",
  FINEST: "TRACE",
  NOTICE: "INFO",
  INFORMATION: "INFO",
  INFORMATIONAL: "INFO",
  WARNING: "WARN",
  ERR: "ERROR",
  SEVERE: "ERROR",
  CRIT: "FATAL",
  CRITICAL: "FATAL",
  ALERT: "FATAL",
  EMERG: "FATAL",
  EMERGENCY: "FATAL",
  PANIC: "FATAL",
};

/** `severityAtLeast(18, "ERROR")` is true. What a "errors and worse" filter means. */
export const severityAtLeast = (n: number, band: SeverityBand): boolean =>
  n >= SEVERITY_RANGE[band].min;

/** The bands, as the options a severity picker offers. */
export const SEVERITY_OPTIONS: Array<{ band: SeverityBand; label: string; number: number }> =
  SEVERITY_BANDS.map((band) => ({ band, label: SEVERITY_LABELS[band], number: SEVERITY[band] }));
