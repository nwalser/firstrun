import type { Namespaced } from "./namespace.js";

/**
 * Anything that can appear on more than one screen.
 *
 * This namespace is deliberately frozen while the areas are being translated in
 * parallel: it is the one file every translator would otherwise want to edit,
 * and four people appending to one object is the merge conflict the split
 * exists to prevent. It is seeded ahead of that sweep, so most of these keys
 * have no caller yet.
 *
 * A translator who needs a shared string that is not here puts it in their own
 * namespace instead, even if a neighbouring area ends up with the same word.
 * Two catalogue entries reading "Speichern" cost nothing. Two people editing
 * one file costs an afternoon.
 */
export const common = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.create": "Create",
  "common.rename": "Rename",
  "common.edit": "Edit",
  "common.remove": "Remove",
  "common.add": "Add",
  "common.close": "Close",
  "common.back": "Back",
  "common.next": "Next",
  "common.done": "Done",
  "common.confirm": "Confirm",
  "common.retry": "Try again",
  "common.dismiss": "Dismiss",
  "common.search": "Search",
  "common.loading": "Loading",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.none": "None",
  "common.never": "Never",
  "common.all": "All",
  "common.unknown": "Unknown",

  /*
   * The refresh control, which every data view carries.
   *
   * Here rather than in one area's namespace despite the freeze above: it is
   * rendered by ONE shared component (`components/refresh-button.tsx`) on six
   * pages across five areas, so putting it in an area's file would mean picking
   * an area at random and having the other five reach into it. That is the case
   * this namespace exists for.
   */
  "common.refresh": "Refresh",
  "common.updated_when": "Updated {when}",

  "common.name": "Name",
  "common.description": "Description",
  "common.actions": "Actions",
  "common.required": "Required",
  "common.optional": "Optional",
  "common.learn_more": "Learn more",

  // In-flight states. Separate keys rather than a suffix on the verb, because
  // German does not build them by suffixing either: "Wird gespeichert…" is a
  // sentence, not "Speichern" with something on the end.
  "common.saving": "Saving…",
  "common.creating": "Creating…",
  "common.deleting": "Deleting…",
  "common.adding": "Adding…",
  "common.error": "Something went wrong.",

  // Written by the formatting helpers rather than by a screen, which is why
  // they are lower case: they are fragments, not labels.
  "common.just_now": "just now",
  "common.no_change": "no change",
  "common.delta_new": "new",
} satisfies Namespaced<"common">;

export type CommonMessages = typeof common;
