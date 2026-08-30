import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import { Show, createSignal } from "solid-js";
import { TemplatePicker } from "../components/template-picker.js";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  buttonVariants,
} from "../components/ui/index.js";
import { createDashboardFn } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * Creating a board, as a page.
 *
 * It used to be a dialog, which meant the four template thumbnails -- the only
 * part of this that is actually a decision -- were squeezed into whatever was
 * left beside a name field. A board is an arrangement you are going to look at
 * every day; picking its starting shape deserves the same room as picking a
 * project's.
 *
 * It nests under the project layout on purpose: `/w/$wslug/$pslug/dashboards/new`
 * puts it inside the route that already owns the breadcrumb and the one
 * `getProject` call, so opening this page costs no extra load and the sidebar
 * still lists the boards you are adding to. Nothing above it needed to become a
 * pass-through -- the project layout already renders an `<Outlet />`.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/dashboards/new")({
  component: NewDashboard,
});

/** Mirrors db/repo.ts, so the preview is the slug and not an approximation. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "untitled"
  );
}

function NewDashboard() {
  const i18n = useI18n();
  const view = ProjectRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [name, setName] = createSignal("");
  const [template, setTemplate] = createSignal("handoff");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => view().workspace.slug;
  const project = () => view().project.slug;
  const canEdit = () => view().role === "admin";

  /** Where Cancel goes: the board that was open when the `+` was pressed. */
  async function submit(e: Event) {
    e.preventDefault();
    if (!name().trim() || busy()) return;
    setBusy(true);
    setError(null);
    const result = await createDashboardFn({
      data: {
        workspace: workspace(),
        project: project(),
        name: name().trim(),
        template: template(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Invalidate first so the sidebar's board rows already have the new one,
    // then land on the board that was just made, by its own slug. Navigating to
    // the bare project would land on the project overview instead, which is the
    // one page that does not show what the reader just created.
    await router.invalidate();
    navigate({
      to: "/w/$wslug/$pslug/dashboards/$dslug",
      params: { wslug: workspace(), pslug: project(), dslug: result.slug },
    });
  }

  return (
    // The compact track, and vertical padding only: the shell's grid already
    // supplies the 24px page margin as a column, so a fourth container with
    // horizontal padding of its own would inset this page further than every
    // other one.
    <main class="mx-auto w-full max-w-[var(--page-width-compact)] py-6">
      <Show
        when={canEdit()}
        fallback={
          <Alert variant="destructive">
            <AlertDescription>{i18n.t("boards.admin_only")}</AlertDescription>
          </Alert>
        }
      >
        <form onSubmit={submit} class="flex flex-col gap-7">
          <div>
            <h1 class="text-h2">{i18n.t("boards.new_dashboard")}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {i18n.t("boards.new_hint", { name: view().project.name })}
            </p>
          </div>

          <Field
            label={i18n.t("common.name")}
            description={
              <>
                {i18n.t("boards.address_prefix")}{" "}
                <span class="font-mono text-foreground">
                  /w/{workspace()}/{project()}/dashboards/{slugify(name())}
                </span>
                .
              </>
            }
          >
            <Input
              placeholder={i18n.t("boards.name_placeholder")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              // The `+` used to open a dialog, which put the caret in the name
              // field for free. A page has to ask.
              ref={(el) => {
                requestAnimationFrame(() => el.focus());
              }}
            />
          </Field>

          <Field>
            <FieldLabel>{i18n.t("boards.start_from")}</FieldLabel>
            <FieldDescription>{i18n.t("boards.start_from_hint")}</FieldDescription>
            <TemplatePicker value={template()} onChange={setTemplate} class="mt-2" />
          </Field>

          <Show when={error()}>
            {(message) => (
              <Alert variant="destructive">
                <AlertDescription>{message()}</AlertDescription>
              </Alert>
            )}
          </Show>

          <div class="flex items-center justify-end gap-2 border-t pt-5">
            {/* Back to the project, which lands on its first board. The board
                somebody came from is not tracked: it would have to be threaded
                through the URL to survive a reload, and a cancel button is not
                worth a query parameter. */}
            <Link
              to="/w/$wslug/$pslug"
              params={{ wslug: workspace(), pslug: project() }}
              class={buttonVariants({ variant: "ghost" })}
            >
              {i18n.t("common.cancel")}
            </Link>
            {/* Kobalte renders type="button" unless told otherwise. */}
            <Button type="submit" disabled={busy() || !name().trim()}>
              {busy() ? i18n.t("common.creating") : i18n.t("boards.create_dashboard")}
            </Button>
          </div>
        </form>
      </Show>
    </main>
  );
}
