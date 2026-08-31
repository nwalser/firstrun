import { account } from "./messages/account.en.js";
import { billing } from "./messages/billing.en.js";
import { admin } from "./messages/admin.en.js";
import { auth } from "./messages/auth.en.js";
import { boards } from "./messages/boards.en.js";
import { common } from "./messages/common.en.js";
import { dashboard } from "./messages/dashboard.en.js";
import { explore } from "./messages/explore.en.js";
import { events } from "./messages/events.en.js";
import { usage } from "./messages/usage.en.js";
import { locale } from "./messages/locale.en.js";
import { members } from "./messages/members.en.js";
import { project } from "./messages/project.en.js";
import { settings } from "./messages/settings.en.js";
import { shell } from "./messages/shell.en.js";
import { sources } from "./messages/sources.en.js";
import { templates } from "./messages/templates.en.js";
import { ui } from "./messages/ui.en.js";
import { docs } from "./messages/docs.en.js";
import { workspace } from "./messages/workspace.en.js";

/**
 * English, the source of truth, composed from one module per area.
 *
 * The strings themselves live in `messages/<area>.en.ts`, one file per area of
 * the app, because several people translate several areas at once and a single
 * catalogue file is a merge conflict on every one of them. This file only puts
 * them back together, and it is the reason nobody has to edit a file somebody
 * else is editing: a new area is a new module plus one line here.
 *
 * Keys are flat and dotted rather than nested, because a flat map is what makes
 * the key type a plain union of string literals: nesting would need a recursive
 * path type to get the same compile-time safety, and would still read worse at
 * the call site.
 *
 * The namespace before the first dot is the area, and every key in a module is
 * required to start with it (`satisfies Namespaced<"sources">` in each file).
 * That is what makes the spread below safe: two modules cannot define the same
 * key, so no module can silently overwrite another's string.
 *
 * A plural family is two or more keys sharing a base and ending in an
 * `Intl.PluralRules` category (`_one`, `_other`, and whatever else a future
 * language needs). Call it by the base: `t("shell.members", { count })`.
 *
 * Placeholders are `{name}`. A numeric one is formatted for the active locale
 * on the way in, so `{count}` reads 1.234 in German and 1,234 in English
 * without every call site remembering to do it.
 *
 * Deliberately NOT `as const`: the literal types would then have to match
 * exactly in every other language, and "Speichern" is not "Save".
 */
export const en = {
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
  ...billing,
  ...admin,

  ...ui,
  ...docs,
};

export type Messages = typeof en;
