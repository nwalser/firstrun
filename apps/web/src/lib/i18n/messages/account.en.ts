import type { Namespaced } from "./namespace.js";

/**
 * The signed-in person's own surfaces: the account section, the profile row,
 * and the preferences that belong to them rather than to a workspace.
 */
export const account = {
  "account.title": "Account",
  "account.signed_in_as": "Signed in as {name}",
  "account.github_profile": "GitHub profile",
  "account.appearance": "Appearance",
  "account.sign_out": "Sign out",
} satisfies Namespaced<"account">;

export type AccountMessages = typeof account;
