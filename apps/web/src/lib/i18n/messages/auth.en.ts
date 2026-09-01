import type { Namespaced } from "./namespace.js";

/** The sign-in screen and everything that can go wrong on it. */
export const auth = {
  "auth.sign_in": "Sign in",
  "auth.sign_in_with_github": "Continue with GitHub",
  "auth.signing_in": "Signing in…",
  "auth.tagline":
    "One self-hosted analytics backend for everything you ship: your site, your app, your " +
    "backend, on your own Postgres.",
  "auth.privacy_note":
    "We read your public profile and email address. Nothing is posted on your behalf.",
  "auth.failed": "Sign-in did not work. Try again.",
  "auth.session_expired": "Your session has expired. Sign in again.",

  "auth.not_configured": "GitHub sign-in is not configured",
  // The two environment variable names arrive as vars rather than as markup in
  // the middle of the sentence. A key that carried the markup would have to be
  // three keys, and three fragments do not survive German word order.
  "auth.not_configured_hint": "Set {first} and {second}, or mint a local session out of band:",

  // The running preview beside the form. It is `aria-hidden`, but it is still
  // on the screen, and a German page with an English caption on it reads as
  // broken rather than as decorative.
  //
  // What is NOT here is as deliberate as what is. Entry names, attribute keys,
  // source names, the query lines, `POST /v1/e`, `log_entries` and its
  // partitions, the 202, the board's filter chips and the two window dates are
  // all code rather than copy, so they are printed verbatim in both languages.
  // Translating `url.path` would be translating a customer's data.
  "auth.preview_live": "Live",
  "auth.preview_sample": "Sample data",
  "auth.preview_range": "Last 24 hours",
  "auth.preview_windows": "{window} vs {baseline}",
  "auth.preview_chart_title": "{name} per hour",
  "auth.preview_agg_count": "count of entries",
  "auth.preview_agg_errors": "entries at severity 17 or worse",
  "auth.preview_agg_uniques": "unique installs on {source}",
  "auth.preview_open_bucket": "this hour, still filling",
  "auth.preview_late_note": "1 entry arrived {delay} late and grew an older hour",
  "auth.preview_late_by": "late by {delay}",
  "auth.preview_breakdown_title": "Top pages",
  "auth.preview_breakdown_by": "by {key}",
  "auth.preview_sources": "Sources",
  "auth.preview_wire": "Wire",
  "auth.preview_resolved": "source key resolved",
  "auth.preview_validated": "shape validated",
  "auth.preview_stamped": "ingested_at stamped",
  "auth.preview_accepted": "accepted",
  "auth.preview_lateness": "ingested_at - time p50",
  "auth.preview_throughput": "{rate} entries/sec",
  // A family rather than one string. The count only ever climbs and never
  // reaches one here, but `Intl.PluralRules` is what decides the form
  // everywhere else in this catalogue and an exception would be the thing
  // somebody copies.
  "auth.preview_keys_one": "{count} attribute key in this range",
  "auth.preview_keys_other": "{count} attribute keys in this range",

  "auth.preview_motion_label": "Animated preview",
  "auth.preview_motion_pause": "Pause",
  "auth.preview_motion_play": "Play",
} satisfies Namespaced<"auth">;

export type AuthMessages = typeof auth;
