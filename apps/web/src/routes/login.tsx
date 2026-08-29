import { createFileRoute, redirect } from "@tanstack/solid-router";
import { Show } from "solid-js";
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
    <main class="center-page">
      <div class="center-card">
        <div class="brand" style={{ "margin-bottom": "18px" }}>
          <span class="dot" />
          firstrun
        </div>

        <h1>Sign in</h1>
        <p class="lede">
          Analytics that joins a website visitor to an app installation as the same person.
        </p>

        <Show
          when={session()?.loginConfigured}
          fallback={
            <div class="notice" style={{ "margin-top": "20px" }}>
              <strong>GitHub sign-in is not configured.</strong>
              <p class="meta" style={{ "margin-top": "8px" }}>
                Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code>, or mint a
                local session out of band:
              </p>
              <div class="code" style={{ "margin-top": "10px" }}>bun run dev:login seed</div>
            </div>
          }
        >
          <a class="btn" data-variant="primary" href="/auth/github" style={{ "margin-top": "20px", display: "inline-block" }}>
            Continue with GitHub
          </a>
        </Show>
      </div>
    </main>
  );
}
