import type { BillingMessages } from "./billing.en.js";

/**
 * "Plan" und "Workspace" bleiben englisch, wie im Rest der Oberfläche. "Entry"
 * wird als "Eintrag" übersetzt, weil hier gezählt und abgerechnet wird und das
 * Wort in einer Rechnung deutsch stehen muss.
 *
 * Der Ton ist derselbe wie im Englischen: nichts wird abgeschaltet, nichts geht
 * verloren. Eine Warnung, die Datenverlust andeutet, wo keiner stattfindet,
 * kostet mehr Vertrauen als das Upgrade wert ist.
 */
export const billing: BillingMessages = {
  "billing.nav": "Abrechnung",
  "billing.plan": "Plan",
  "billing.plan_free": "Free",
  "billing.plan_pro": "Pro",
  "billing.plan_scale": "Scale",

  "billing.included": "Diesen Monat enthalten",
  "billing.of_limit": "von {limit}",
  "billing.on_arrival":
    "Der Zähler zählt Einträge bei ihrem Eingang. Er ist damit die einzige Zahl hier, die sich " +
    "nach Ablauf eines Tages nicht mehr ändert. Das Diagramm darunter zählt nach dem Zeitstempel " +
    "des Eintrags.",

  "billing.ok": "Im Rahmen des Plans",
  "billing.warn": "Nähert sich dem Planlimit",
  "billing.over": "Über dem Planlimit",
  "billing.warn_body":
    "Dieser Workspace hat {percent} seiner monatlichen Einträge genutzt. Beim Überschreiten " +
    "ändert sich nichts: Einträge werden weiter aufgezeichnet und bleiben lesbar.",
  "billing.over_body":
    "Dieser Workspace hat sein monatliches Kontingent überschritten. Es wird weiterhin alles " +
    "aufgezeichnet, nichts wurde verworfen. Ein Upgrade hält das so, während ihr wachst.",
  "billing.over_short": "Über dem Planlimit. Zeichnet weiter auf, nichts verworfen.",

  "billing.past_due": "Die letzte Zahlung ist fehlgeschlagen",
  "billing.past_due_body":
    "Es wurde nichts abgeschaltet und nichts verworfen. Eine aktualisierte Karte löst das auf.",
  "billing.canceled": "Dieses Abo wurde gekündigt",
  "billing.canceled_body":
    "Der Workspace wechselt zum Ende der bezahlten Periode auf den Free-Plan.",

  "billing.upgrade": "Upgrade",
  "billing.manage": "Abrechnung verwalten",
  "billing.view_usage": "Usage ansehen",
  "billing.admin_only": "Ein Admin dieses Workspace kann den Plan ändern.",
  "billing.opening": "Stripe wird geöffnet",
  "billing.failed": "Stripe war nicht erreichbar. Bitte gleich noch einmal versuchen.",

  "billing.title": "Plan und Abrechnung",
  "billing.hint":
    "Ein Preis für Einträge. Ein Fehler, ein Seitenaufruf und eine Messung zählen je einmal, " +
    "weil sie dieselbe Zeile in derselben Tabelle sind.",
  "billing.per_month": "{price} pro Monat",
  "billing.free_price": "Kostenlos",
  "billing.entries_per_month": "{count} Einträge pro Monat",
  "billing.projects_limit": "{count} Projekte",
  "billing.projects_unlimited": "Unbegrenzt Projekte",
  "billing.members_unlimited": "Unbegrenzt Mitglieder",
  "billing.current": "Aktueller Plan",
  "billing.select": "{plan} wählen",
  "billing.self_hosted": "Selbst gehostet",
  "billing.self_hosted_body":
    "Dies ist eine selbst gehostete Installation. Alle Funktionen sind aktiv, es gibt keine " +
    "Limits und nichts zu bezahlen oder zu lizenzieren.",
};
