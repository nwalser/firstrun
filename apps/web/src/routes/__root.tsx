import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import { For, Show, type JSX } from "solid-js";
import { HydrationScript } from "solid-js/web";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/index.js";
import { getSession } from "../lib/api.js";
import styles from "../styles.css?url";

/**
 * The document shell and the one piece of chrome: who you are, and which
 * workspace you are in.
 *
 * The session loads here rather than per route so every page can assume it, and
 * so a signed-out visitor is bounced from one place instead of five.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: "firstrun" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  loader: () => getSession(),
  component: RootDocument,
});

function RootDocument() {
  const session = Route.useLoaderData();

  return (
    <html lang="en" class="dark">
      <head>
        <HeadContent />
        {/*
          Solid's own hydration bootstrap. Without this nothing on the page is
          interactive, in dev or in production, and the failure surfaces as a
          seroval stream error inside TanStack's client entry that names nothing
          Solid-related. Do not remove it.
        */}
        <HydrationScript />
      </head>
      <body class="min-h-dvh antialiased">
        <Show when={session()?.user}>
          {(user) => (
            <header class="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
              <div class="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2.5">
                <Link to="/" class="flex items-center gap-2 font-semibold tracking-tight">
                  <span class="size-2 rounded-[3px] bg-chart-1 shadow-[0_0_12px_var(--color-chart-1)]" />
                  firstrun
                </Link>

                <Show when={session()!.workspaces.length > 0}>
                  <nav class="ml-2 flex items-center gap-0.5">
                    <For each={session()!.workspaces}>
                      {(w) => (
                        <Link
                          to="/w/$wslug"
                          params={{ wslug: w.slug }}
                          class="rounded-md px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          activeProps={{ class: "bg-accent text-foreground" }}
                        >
                          {w.name}
                        </Link>
                      )}
                    </For>
                  </nav>
                </Show>

                <div class="flex-1" />

                <DropdownMenu>
                  <DropdownMenuTrigger class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <Show when={user().avatarUrl}>
                      {(src) => <img src={src()} alt="" class="size-5 rounded-full" />}
                    </Show>
                    {user().login}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>{user().name ?? user().login}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem as="a" href="/new">
                      New workspace
                    </DropdownMenuItem>
                    <DropdownMenuItem as="a" href="/auth/logout">
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
          )}
        </Show>

        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * A page header, used by every screen so the vertical rhythm is the same
 * everywhere rather than re-guessed per route.
 */
export function PageHeader(props: {
  title: string;
  crumb?: { label: string; href: string };
  description?: string;
  badge?: string;
  actions?: JSX.Element;
}) {
  return (
    <div class="flex flex-wrap items-end justify-between gap-4 pb-5 pt-7">
      <div class="min-w-0">
        <Show when={props.crumb}>
          {(crumb) => (
            <a
              href={crumb().href}
              class="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {crumb().label}
            </a>
          )}
        </Show>
        <div class="flex items-center gap-2">
          <h1 class="text-xl font-semibold tracking-tight">{props.title}</h1>
          <Show when={props.badge}>{(badge) => <Badge variant="outline">{badge()}</Badge>}</Show>
        </div>
        <Show when={props.description}>
          <p class="mt-1 max-w-2xl text-sm text-muted-foreground">{props.description}</p>
        </Show>
      </div>
      <div class="flex items-center gap-2">{props.actions}</div>
    </div>
  );
}
