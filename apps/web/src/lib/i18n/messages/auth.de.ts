import type { AuthMessages } from "./auth.en.js";

/**
 * The formal address, worked through. "Ihre Sitzung" and "melden Sie sich an",
 * never "deine" or "melde dich an": this is a tool somebody's employer bought,
 * and the informal form reads as a consumer app pretending to be a friend.
 *
 * "Log", "Backend", "Postgres" and "Retention" stay English. They are the
 * product's own words, and "Protokoll" would be a different noun.
 */
export const auth: AuthMessages = {
  "auth.sign_in": "Anmelden",
  "auth.sign_in_with_github": "Mit GitHub fortfahren",
  "auth.signing_in": "Wird angemeldet…",
  "auth.tagline":
    "Ein selbst gehostetes Analytics-Backend für alles, was Sie ausliefern: Ihre Website, Ihre " +
    "App, Ihr Backend, auf Ihrem eigenen Postgres.",
  "auth.privacy_note":
    "Wir lesen Ihr öffentliches Profil und Ihre E-Mail-Adresse. In Ihrem Namen wird nichts " +
    "veröffentlicht.",
  "auth.failed": "Die Anmeldung hat nicht funktioniert. Bitte erneut versuchen.",
  "auth.session_expired": "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",

  "auth.not_configured": "Die Anmeldung über GitHub ist nicht konfiguriert",
  "auth.not_configured_hint":
    "Setzen Sie {first} und {second}, oder erzeugen Sie eine lokale Sitzung außerhalb der App:",

  // "Severity", "Source Key", "ingested_at" und "time" bleiben englisch, wie
  // "Retention" und "Postgres" es hier schon tun: es sind die Namen aus dem
  // Datenmodell und keine Uebersetzungssache.
  "auth.preview_live": "Live",
  "auth.preview_sample": "Beispieldaten",
  "auth.preview_range": "Letzte 24 Stunden",
  "auth.preview_windows": "{window} vs. {baseline}",
  "auth.preview_chart_title": "{name} pro Stunde",
  "auth.preview_agg_count": "Anzahl der Eintraege",
  "auth.preview_agg_errors": "Eintraege ab Severity 17",
  "auth.preview_agg_uniques": "eindeutige Installationen auf {source}",
  "auth.preview_open_bucket": "laufende Stunde, noch nicht vollstaendig",
  "auth.preview_late_note": "1 Eintrag traf {delay} verspaetet ein und liess eine aeltere Stunde wachsen",
  "auth.preview_late_by": "{delay} verspaetet",
  "auth.preview_breakdown_title": "Top-Seiten",
  "auth.preview_breakdown_by": "nach {key}",
  "auth.preview_sources": "Quellen",
  "auth.preview_wire": "Leitung",
  "auth.preview_resolved": "Source Key aufgeloest",
  "auth.preview_validated": "Form validiert",
  "auth.preview_stamped": "ingested_at gestempelt",
  "auth.preview_accepted": "angenommen",
  "auth.preview_lateness": "ingested_at - time p50",
  "auth.preview_throughput": "{rate} Eintraege/Sek.",
  "auth.preview_keys_one": "{count} Attributschluessel entdeckt",
  "auth.preview_keys_other": "{count} Attributschluessel entdeckt",

  "auth.preview_motion_label": "Animierte Vorschau",
  "auth.preview_motion_pause": "Pause",
  "auth.preview_motion_play": "Abspielen",
};
