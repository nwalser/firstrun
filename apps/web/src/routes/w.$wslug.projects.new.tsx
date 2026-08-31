import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import { Show, createSignal, type JSX } from "solid-js";
import { PageHeader } from "../components/page-header.js";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Spinner,
  buttonVariants,
} from "../components/ui/index.js";
import { createProjectFn } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * Creating a project, as a page.
 *
 * One panel with the action in a recessed bar at the bottom: the reference's
 * own create-flow shape rather than the column of separate cards a settings
 * page uses.
 *
 * It asks for the project and NOTHING else. A source lived here for a while,
 * and a starting board before that, and both were the same mistake in two
 * shapes: a create form that quietly makes three things is a form whose result
 * has to be audited. The project's own page carries the quickstart instead --
 * add a source, install it, make a board -- and each of those has a page that
 * does it properly. Nothing here duplicates any of them.
 */
export const Route = createFileRoute("/w/$wslug/projects/new")({
  component: NewProject,
});

function NewProject() {
  const i18n = useI18n();
  const data = WorkspaceRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const workspace = () => data().view.workspace;
  const isAdmin = () => workspace().role === "admin";

  async function submit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    setBusy(true);
    setError(null);
    const result = await createProjectFn({
      data: { workspace: workspace().slug, name: name().trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await router.invalidate();
    // The project's own page, which for a project this new is the quickstart:
    // add a source, install it, make a board, each linking to the page that
    // does it. That list is the reason nothing was created here.
    await navigate({
      to: "/w/$wslug/$pslug",
      params: { wslug: workspace().slug, pslug: result.slug },
    });
  }

  return (
    // The compact track, the measured 914px one Settings and the source flow
    // already use, rather than a fourth page width invented here.
    <div class="page-track page-track-compact">
      <main class="w-full py-6">
        <Show
          when={isAdmin()}
          fallback={
            <Alert variant="destructive">
              <AlertDescription>{i18n.t("project.admin_only")}</AlertDescription>
            </Alert>
          }
        >
          <PageHeader
            title={i18n.t("project.new")}
            description={i18n.t("project.new_hint", { workspace: workspace().name })}
          />

          <form onSubmit={submit} class="flex flex-col gap-4">
            {/*
              `border-t` on the footer rather than `divide-y` on the card.
              `divide-y` reaches the built stylesheet as NOTHING here -- no rule
              at all, so the seam renders at 0px -- and `border-t` is what every
              other card in the product draws its hairlines with anyway.

              `overflow-hidden` is what lets the footer's fill respect the
              bottom corners; the card's own separation is a box-shadow ring,
              so it is untouched by clipping.
            */}
            <Card class="overflow-hidden">
              <Section
                title={i18n.t("project.name_label")}
                description={i18n.t("project.name_hint")}
              >
                <Field>
                  <Input
                    placeholder="Themia"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </Field>
              </Section>

              {/*
                The recessed bar. It is the page colour inside a raised card,
                which is the reference's own footer: the card is
                `background-100` and this is `background-200`, so the seam is a
                step down rather than a second ring.
              */}
              <div class="flex items-center justify-end gap-2 border-t bg-background px-4 py-3">
                <Link
                  to="/w/$wslug"
                  params={{ wslug: workspace().slug }}
                  class={buttonVariants({ variant: "ghost" })}
                >
                  {i18n.t("common.cancel")}
                </Link>
                {/* Kobalte renders type="button" unless told otherwise.

                    Spinner and the changed word, the treatment `ConfirmDelete`
                    already uses: a disabled button reading "Creating" is
                    indistinguishable from a disabled button that has stopped. */}
                <Button type="submit" disabled={busy() || !name().trim()}>
                  <Show when={busy()}>
                    <Spinner />
                  </Show>
                  {busy() ? i18n.t("common.creating") : i18n.t("project.create")}
                </Button>
              </div>
            </Card>

            {/* Under the button that was pressed, rather than at the top of a
                form somebody has already scrolled past. */}
            <Show when={error()}>
              {(message) => (
                <Alert variant="destructive">
                  <AlertDescription>{message()}</AlertDescription>
                </Alert>
              )}
            </Show>
          </form>
        </Show>
      </main>
    </div>
  );
}

/**
 * One part of the panel: a heading block and its controls, at the card's own
 * measured padding.
 *
 * `CardHeader` and `CardContent` rather than a hand-written `p-4`, so a section
 * here keeps the same rhythm as every other card in the product and cannot
 * drift from it.
 */
function Section(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div>
      <CardHeader class="flex-col items-stretch gap-1">
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </div>
  );
}
