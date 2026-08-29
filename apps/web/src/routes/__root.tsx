import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { getSession } from "../lib/api.js";
import styles from "../styles.css?url";

/**
 * The document shell and the one piece of chrome: who you are, and which
 * workspace you are looking at.
 *
 * The session is loaded here rather than per route so every page can assume it,
 * and so a signed-out visitor is bounced from one place instead of five.
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
    <html lang="en">
      <head>
        <HeadContent />
        {/* Solid needs its own bootstrap in the head or nothing hydrates. */}
        <HydrationScript />
      </head>
      <body>
        <Show when={session()?.user}>
          {(user) => (
            <header class="topbar">
              <div class="topbar-inner">
                <Link to="/" class="brand">
                  <span class="dot" />
                  firstrun
                </Link>

                <Show when={session()!.workspaces.length > 0}>
                  <nav>
                    {session()!.workspaces.map((w) => (
                      <Link to="/w/$slug" params={{ slug: w.slug }} activeProps={{ "data-active": "true" }}>
                        {w.name}
                      </Link>
                    ))}
                  </nav>
                </Show>

                <span class="spacer" />

                <span class="who">
                  <Show when={user().avatarUrl}>
                    {(src) => <img src={src()} alt="" />}
                  </Show>
                  {user().login}
                </span>
                <a class="btn sm" data-variant="ghost" href="/auth/logout">
                  Sign out
                </a>
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
