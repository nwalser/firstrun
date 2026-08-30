import { createRouter } from "@tanstack/solid-router";
import Compass from "lucide-solid/icons/compass";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  buttonVariants,
} from "./components/ui/index.js";
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
    defaultNotFoundComponent: NotFound,
  });
}

/**
 * The not-found page.
 *
 * It cannot tell "does not exist" apart from "you are not a member", and it
 * deliberately does not try: saying which one would confirm the existence of a
 * workspace to somebody who cannot see it.
 */
function NotFound() {
  return (
    <main class="flex min-h-dvh items-center justify-center p-6">
      <Empty class="max-w-md border-none">
        <EmptyMedia>
          <Compass />
        </EmptyMedia>
        <EmptyTitle>Not found</EmptyTitle>
        <EmptyDescription>
          That page does not exist, or it belongs to a workspace you are not a member of.
        </EmptyDescription>
        <EmptyContent>
          <a href="/" class={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to your workspaces
          </a>
        </EmptyContent>
      </Empty>
    </main>
  );
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
