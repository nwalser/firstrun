import { account } from "./messages/account.de.js";
import { auth } from "./messages/auth.de.js";
import { boards } from "./messages/boards.de.js";
import { common } from "./messages/common.de.js";
import { dashboard } from "./messages/dashboard.de.js";
import { explore } from "./messages/explore.de.js";
import { events } from "./messages/events.de.js";
import { usage } from "./messages/usage.de.js";
import { locale } from "./messages/locale.de.js";
import { members } from "./messages/members.de.js";
import { project } from "./messages/project.de.js";
import { settings } from "./messages/settings.de.js";
import { shell } from "./messages/shell.de.js";
import { sources } from "./messages/sources.de.js";
import { templates } from "./messages/templates.de.js";
import { ui } from "./messages/ui.de.js";
import { docs } from "./messages/docs.de.js";
import { workspace } from "./messages/workspace.de.js";
import type { Messages } from "./en.js";

/**
 * German, composed the same way, and typed twice over.
 *
 * Each module is already annotated against its English counterpart, so a
 * missing or misspelled key fails inside the file that owns it, named, without
 * anyone else's work having to compile first. The `Messages` annotation here is
 * the second net: it catches a module that was written but never wired in,
 * which is the one mistake a per-file annotation cannot see.
 *
 * Neither net can be removed. Without them a missing German key is not an
 * error at all: it falls back to English at runtime and ships as a word of
 * English in the middle of a German screen.
 */
export const de: Messages = {
  ...common,
  ...shell,
  ...locale,

  ...workspace,
  ...project,
  ...boards,
  ...sources,
  ...templates,

  ...settings,
  ...members,
  ...auth,
  ...account,

  ...dashboard,
  ...explore,
  ...events,
  ...usage,

  ...ui,
  ...docs,
};
