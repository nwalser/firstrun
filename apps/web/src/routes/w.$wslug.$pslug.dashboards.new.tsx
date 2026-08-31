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
  Select,
  buttonVariants,
  type SelectOption,
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

/**
 * "Every source", as a value the select can actually hold.
 *
 * A source id is a uuid, so no source can collide with it.
 */
const ALL = "all";

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
  const [template, setTemplate] = createSignal("overview");
  /**
   * Which source the board is about. `ALL` is every source, which is a board
   * with no permanent filter at all.
   *
   * A named sentinel rather than `""`: Kobalte reads an empty option value as
   * "nothing selected" and renders the placeholder, so the default choice sat
   * there looking unanswered while being the answer.
   */
  const [scope, setScope] = createSignal(ALL);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => view().workspace.slug;
  const project = () => view().project.slug;
  const canEdit = () => view().role === "admin";
  const sources = () => view().sources;

  /**
   * Every source, plus "all of them" first.
   *
   * The sources come off the project layout's nav, which is already loaded, so
   * offering this costs no round trip. An empty value is the absence of a
   * filter rather than a filter matching everything, which is the same
   * distinction `emptyFilter` makes: an empty AND is no constraint.
   */
  const scopeOptions = (): SelectOption<string>[] => [
    { value: ALL, label: i18n.t("boards.scope_all") },
    ...sources().map((s) => ({ value: s.id, label: s.name })),
  ];

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
        ...(scope() === ALL ? {} : { sourceId: scope() }),
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

          {/*
            Which source the board is about, as a PERMANENT filter.

            This is the whole difference between a board called "Marketing site"
            and a board you re-filter on every visit: the constraint belongs to
            the board, so it survives a reload, a shared link and the next
            person to open it. It is a filter like any other, ANDed into every
            card before its key is derived, so whoever opens the board can see
            it in the filter sheet and take it off.

            Offered here and nowhere else. The page that adds a source used to
            make a board at the same time, which meant the same decision was
            half-asked in two places and fully asked in neither.
          */}
          <Show when={sources().length > 0}>
            <Field>
              <FieldLabel>{i18n.t("boards.scope")}</FieldLabel>
              <FieldDescription>
                {scope() === ALL
                  ? i18n.t("boards.scope_all_hint")
                  : i18n.t("boards.scope_one_hint", {
                      name: sources().find((s) => s.id === scope())?.name ?? "",
                    })}
              </FieldDescription>
              <Select
                class="mt-2"
                value={scope()}
                options={scopeOptions()}
                onChange={setScope}
                aria-label={i18n.t("boards.scope")}
              />
            </Field>
          </Show>

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
