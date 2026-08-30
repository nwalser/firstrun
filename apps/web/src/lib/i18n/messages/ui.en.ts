import type { Namespaced } from "./namespace.js";

/**
 * The strings the primitives in `components/ui/` say for themselves.
 *
 * Only the ones a primitive owns: a close button's accessible name, a month
 * arrow, an empty state's own wording. Anything a caller passes in is the
 * caller's string and belongs to the caller's namespace.
 */
export const ui = {
  "ui.close": "Close",
  "ui.dismiss": "Dismiss",
  "ui.open_menu": "Open menu",
  "ui.toggle_sidebar": "Toggle sidebar",
  "ui.more": "More",

  "ui.select_placeholder": "Select…",
  "ui.clear": "Clear",
  "ui.no_results": "No results",

  "ui.previous_month": "Previous month",
  "ui.next_month": "Next month",

  "ui.file_drop": "Drop a file here, or browse",
  "ui.file_too_large": "That file is larger than {size}.",
  // The dropzone's own default face, for a caller that passes no children.
  "ui.drop_image": "Drop an image, or click to choose",
  "ui.image_formats": "PNG, JPEG, WebP or SVG",
  "ui.choose_file": "Choose a file",
  "ui.processing": "Processing…",
  // The two ways reading a dropped file fails. Thrown as codes by the module
  // functions, which have no locale, and turned into these inside the component.
  "ui.not_an_image": "That file is not an image we can read.",
  "ui.file_unreadable": "Could not read that file.",

  "ui.copy_code": "Copy code",
  "ui.copy_to_clipboard": "Copy to clipboard",
  "ui.copied": "Copied",

  /*
   * The one sentence in this namespace that is split in two, and the reason is
   * in the middle of it: the word being typed is set in mono at full contrast,
   * because the whole point of asking somebody to type a name is that they read
   * it character by character first. A placeholder cannot carry that styling,
   * and the alternative was dropping the emphasis from a confirmation that
   * deletes a workspace. German keeps the same two halves around the word:
   * "Geben Sie <name> zur Bestätigung ein."
   */
  "ui.confirm_type_prefix": "Type",
  "ui.confirm_type_suffix": "to confirm",
} satisfies Namespaced<"ui">;

export type UiMessages = typeof ui;
