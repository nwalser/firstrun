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

  "auth.preview_per_day": "{name} pro Tag",
  "auth.preview_retention": "Retention an Tag 7",
};
