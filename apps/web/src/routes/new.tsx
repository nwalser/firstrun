import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { createWorkspaceFn, getSession } from "../lib/api.js";

/**
 * Creating a workspace.
 *
 * A workspace is one identity namespace: everything inside it -- the marketing
 * site, the desktop app, a second app -- resolves to the same people. That is
 * said here rather than buried in docs, because it is the decision someone
 * makes wrong when they create one workspace per platform.
 */
export const Route = createFileRoute("/new")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
  },
  component: NewWorkspace,
});

function NewWorkspace() {
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createWorkspaceFn({ data: name() });
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    navigate({ to: "/w/$slug", params: { slug: result.slug } });
  }

  return (
    <main class="center-page">
      <form class="center-card" onSubmit={submit}>
        <h1>New workspace</h1>
        <p class="lede">
          One workspace per product, not per platform. Your site and your app belong in the same
          one — a person who visits and then installs has to be a single person, and that only
          works inside one workspace.
        </p>

        <div class="field" style={{ "margin-top": "20px" }}>
          <label for="name">Name</label>
          <input
            id="name"
            type="text"
            placeholder="Themia"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>

        {error() && <p class="meta" style={{ color: "var(--warn)" }}>{error()}</p>}

        <button class="btn" data-variant="primary" disabled={busy() || !name().trim()} style={{ "margin-top": "18px" }}>
          {busy() ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </main>
  );
}
