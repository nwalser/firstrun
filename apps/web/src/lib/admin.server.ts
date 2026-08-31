import type { User } from "@firstrun/db/schema";
import { getRequest } from "@tanstack/solid-start/server";
import { currentUser } from "./auth.server.js";
import { ensureReady } from "./context.server.js";

/**
 * Who operates this deployment, as opposed to who is in a workspace.
 *
 * Two different questions and deliberately two different mechanisms.
 * `requireAdmin` asks whether somebody administers ONE workspace, which is
 * product state and is edited in the product. This asks whether somebody
 * operates the whole instance, which is deployment configuration and is not.
 *
 * ## Why an env var and not a column
 *
 * A column needs a way to grant it, and a way to grant it needs somebody who
 * already has it: the first instance admin has no honest bootstrap inside the
 * app. It would also put "can read every workspace on the deployment" behind a
 * row that a SQL injection or a careless migration could set. An env var can
 * only be changed by whoever can deploy, which is exactly the population that
 * should have this, and it is empty by default so a fresh clone and every
 * self-hosted install have no instance admin at all until somebody says so.
 *
 * GitHub logins rather than user ids, because the operator sets this BEFORE the
 * user row exists. Compared case-insensitively: GitHub logins are.
 *
 * ## What it does not grant
 *
 * Reading a workspace's ENTRIES. Nothing here widens `requireAccess`, and the
 * admin page shows counts, plans and dates. An operator who needs to see inside
 * a customer's data is a support conversation, not a button.
 */

let admins: Set<string> | null = null;

export function instanceAdmins(): Set<string> {
  if (!admins) {
    admins = new Set(
      (process.env.FIRSTRUN_ADMINS ?? "")
        .split(",")
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  return admins;
}

export function isInstanceAdmin(user: Pick<User, "login"> | null | undefined): boolean {
  if (!user) return false;
  const set = instanceAdmins();
  return set.size > 0 && set.has(user.login.toLowerCase());
}

/** The signed-in operator, or null. Null for a stranger and for an ordinary user alike. */
export async function requireInstanceAdmin(): Promise<User | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  return isInstanceAdmin(user) ? user : null;
}
