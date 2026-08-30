import type { MembersMessages } from "./members.en.js";

/**
 * "Admin" is the role's stored value and the word the product uses everywhere
 * else, so it stays. "Read" is a label rather than a name, and becomes
 * "Lesen".
 *
 * "members.you" is the badge beside your own row. "Sie" rather than "Ich",
 * because the whole product addresses the reader formally and a badge that
 * suddenly speaks in the first person reads as a different voice.
 */
export const members: MembersMessages = {
  "members.title": "Mitglieder",
  "members.people": "Personen",
  "members.hint": "Admins ändern Dinge. Leser sehen zu.",
  "members.description":
    "Zugriff wird pro Workspace vergeben, nicht pro Projekt: Alle hier Aufgeführten sehen jedes " +
    "Projekt darin und jedes Event, das diese Projekte enthalten.",

  "members.person": "Person",
  "members.you": "Sie",

  "members.role": "Rolle",
  "members.role_for": "Rolle für {name}",
  "members.role_admin": "Admin",
  "members.role_read": "Lesen",
  "members.role_admin_hint": "Kann alles ändern.",
  "members.role_read_hint": "Kann alles sehen.",
  "members.now_admin": "{name} ist jetzt Admin.",
  "members.now_reader": "{name} hat jetzt nur Leserechte.",

  "members.add": "Jemanden hinzufügen",
  "members.add_hint": "Über den GitHub-Benutzernamen, dasselbe Konto wie zur Anmeldung.",
  "members.username_label": "GitHub-Benutzername",
  "members.username_hint":
    "Die Person muss sich hier einmal angemeldet haben, bevor sie hinzugefügt werden kann. Es " +
    "gibt keine Einladung per E-Mail, und ein Benutzername, den niemand beansprucht hat, würde " +
    "stillschweigend nichts bewirken.",
  "members.added": "{name} kann diesen Workspace jetzt sehen.",

  "members.remove": "Entfernen",
  "members.remove_confirm": "{name} entfernen?",
  "members.remove_self_hint":
    "Sie verlieren den Zugriff auf diesen Workspace und jedes Projekt darin. Ein anderer Admin " +
    "muss Sie wieder hinzufügen.",
  "members.remove_other_hint":
    "Die Person verliert den Zugriff auf diesen Workspace und jedes Projekt darin. Bereits " +
    "Erfasstes wird nicht gelöscht, und Sie können sie später wieder hinzufügen.",
  "members.removed": "{name} hat keinen Zugriff mehr.",

  "members.last_admin":
    "Der letzte Admin kann weder herabgestuft noch entfernt werden. Ein Workspace, den niemand " +
    "administrieren kann, lässt sich nicht wiederherstellen.",
  "members.failed": "Das hat nicht funktioniert.",

  "members.members_one": "{count} Mitglied",
  "members.members_other": "{count} Mitglieder",
};
