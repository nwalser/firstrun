import { createFileRoute, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { Button } from "../components/ui/index.js";
import { getSession } from "../lib/api.js";

export const Route = createFileRoute("/login")({
  loader: async () => {
    const session = await getSession();
    if (session.user) throw redirect({ to: "/" });
    return session;
  },
  component: Login,
});

function Login() {
  const session = Route.useLoaderData();

  return (
    <main class="flex min-h-dvh items-center justify-center p-6">
      <div class="w-full max-w-sm rounded-xl border bg-card p-7">
        <div class="mb-5 flex items-center gap-2 font-semibold tracking-tight">
          <span class="size-2 rounded-[3px] bg-chart-1 shadow-[0_0_12px_var(--color-chart-1)]" />
          firstrun
        </div>

        <h1 class="text-lg font-semibold tracking-tight">Sign in</h1>
        <p class="mt-1.5 text-sm text-muted-foreground">
          Analytics that joins a website visitor to an app installation as the same person.
        </p>

        <Show
          when={session()?.loginConfigured}
          fallback={
            <div class="mt-6 rounded-lg border bg-background p-4">
              <p class="text-sm font-medium">GitHub sign-in is not configured.</p>
              <p class="mt-1.5 text-xs text-muted-foreground">
                Set <code class="font-mono">GITHUB_CLIENT_ID</code> and{" "}
                <code class="font-mono">GITHUB_CLIENT_SECRET</code>, or mint a local session out of
                band:
              </p>
              <pre class="mt-2.5 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">bun run dev:login seed</pre>
            </div>
          }
        >
          <Button as="a" href="/auth/github" class="mt-6 w-full">
            Continue with GitHub
          </Button>
        </Show>
      </div>
    </main>
  );
}
