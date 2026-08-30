import type { Namespaced } from "./namespace.js";

/** Who can see this workspace, and who can change it. */
export const members = {
  "members.title": "Members",
  "members.people": "People",
  "members.hint": "Admins change things. Readers look.",
  "members.description":
    "Access is granted per workspace, not per project: everyone listed here can see every " +
    "project in it, and every event those projects hold.",

  "members.person": "Person",
  "members.you": "you",

  "members.role": "Role",
  "members.role_for": "Role for {name}",
  "members.role_admin": "Admin",
  "members.role_read": "Read",
  "members.role_admin_hint": "Can change everything.",
  "members.role_read_hint": "Can see everything.",
  "members.now_admin": "{name} is now an admin.",
  "members.now_reader": "{name} is now a reader.",

  "members.add": "Add someone",
  "members.add_hint": "By GitHub username, the same account they sign in with.",
  "members.username_label": "GitHub username",
  "members.username_hint":
    "They have to sign in here once before they can be added. There is no invite email, and " +
    "adding a username nobody has claimed would silently do nothing.",
  "members.added": "{name} can now see this workspace.",

  "members.remove": "Remove",
  "members.remove_confirm": "Remove {name}?",
  "members.remove_self_hint":
    "You lose access to this workspace and every project in it. Another admin has to add you " +
    "back.",
  "members.remove_other_hint":
    "They lose access to this workspace and every project in it. Nothing already collected is " +
    "deleted, and you can add them again later.",
  "members.removed": "{name} no longer has access.",

  "members.last_admin":
    "The last admin cannot be demoted or removed. A workspace nobody can administer cannot be " +
    "recovered.",
  "members.failed": "That did not work.",

  "members.members_one": "{count} member",
  "members.members_other": "{count} members",
} satisfies Namespaced<"members">;

export type MembersMessages = typeof members;
