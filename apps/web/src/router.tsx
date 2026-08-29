import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

/**
 * Named `getRouter` because that is the export the generated client entry
 * imports. Renaming it produces a build error about a missing export from this
 * file, which is a confusing way to find out.
 */
export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <main class="wrap">
        <h1>Not found</h1>
        <p class="lede">That workspace does not exist, or you are not a member of it.</p>
      </main>
    ),
  });
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
