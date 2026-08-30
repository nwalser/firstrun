import type { CommonMessages } from "./common.en.js";

/**
 * The annotation is the safety net, once per namespace.
 *
 * `CommonMessages` is `typeof common` from the English file, so a key that is
 * missing fails the build with the key named, and a key that is misspelled
 * fails twice: once as an unknown property and once as a missing one. Neither
 * can reach a screen as silent English.
 */
export const common: CommonMessages = {
  "common.save": "Speichern",
  "common.cancel": "Abbrechen",
  "common.delete": "Löschen",
  "common.create": "Erstellen",
  "common.rename": "Umbenennen",
  "common.edit": "Bearbeiten",
  "common.remove": "Entfernen",
  "common.add": "Hinzufügen",
  "common.close": "Schließen",
  "common.back": "Zurück",
  "common.next": "Weiter",
  "common.done": "Fertig",
  "common.confirm": "Bestätigen",
  "common.retry": "Erneut versuchen",
  "common.dismiss": "Ausblenden",
  "common.search": "Suchen",
  "common.loading": "Wird geladen",
  "common.copy": "Kopieren",
  "common.copied": "Kopiert",
  "common.none": "Keine",
  "common.never": "Nie",
  "common.all": "Alle",
  "common.unknown": "Unbekannt",

  // Siehe den Kommentar in common.en.ts: das Aktualisieren steht hier, weil
  // eine einzige gemeinsame Komponente es auf jeder Datenansicht zeichnet.
  "common.refresh": "Aktualisieren",
  "common.updated_when": "Aktualisiert {when}",

  "common.name": "Name",
  "common.description": "Beschreibung",
  "common.actions": "Aktionen",
  "common.required": "Erforderlich",
  "common.optional": "Optional",
  "common.learn_more": "Mehr erfahren",

  "common.saving": "Wird gespeichert…",
  "common.creating": "Wird erstellt…",
  "common.deleting": "Wird gelöscht…",
  "common.adding": "Wird hinzugefügt…",
  "common.error": "Etwas ist schiefgelaufen.",

  "common.just_now": "gerade eben",
  "common.no_change": "keine Änderung",
  "common.delta_new": "neu",
};
