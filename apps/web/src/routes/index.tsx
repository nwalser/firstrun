import { createFileRoute, redirect } from "@tanstack/solid-router";
import { getSession } from "../lib/api.js";

/**
 * The front door decides where you actually belong.
 *
 * Signed out -> login. Signed in with no workspace -> make one. Otherwise the
 * first workspace, because a landing page listing one item is a click you
 * should not have to make every morning.
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const first = session.workspaces[0];
    if (!first) throw redirect({ to: "/new" });
    throw redirect({ to: "/w/$slug", params: { slug: first.slug } });
  },
});
