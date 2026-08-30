import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Globe from "lucide-solid/icons/globe";
import LayoutDashboard from "lucide-solid/icons/layout-dashboard";
import Monitor from "lucide-solid/icons/monitor";
import Server from "lucide-solid/icons/server";
import { Show, createSignal } from "solid-js";
import { PageHeader } from "../components/page-header.js";
import { TemplatePicker } from "../components/template-picker.js";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Field,
  Input,
  buttonVariants,
} from "../components/ui/index.js";
import { createProjectFn } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as WorkspaceRoute } from "./w.$wslug.js";

/**
 * Creating a project, as a page.
 *
 * A project is a decision, not a field. It is one product, and every surface of
 * that product reports into it: one project per PRODUCT, never per platform. A
 * site in one project and its app in another still work, and nothing looks
 * broken, but the two halves of one product never appear on the same board and
 * every comparison between them has to be done by hand.
 *
 * So the explanation gets the space a drawer could never give it, and sits
 * above the template picker rather than under it.
 */
export const Route = createFileRoute("/w/$wslug/projects/new")({
  component: NewProject,
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

function NewProject() {
  const i18n = useI18n();
  const data = WorkspaceRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [name, setName] = createSignal("");
  const [template, setTemplate] = createSignal("handoff");
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
      data: { workspace: workspace().slug, name: name().trim(), template: template() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await router.invalidate();
    navigate({
      to: "/w/$wslug/$pslug",
      params: { wslug: workspace().slug, pslug: result.slug },
    });
  }

  return (
    /*
      Vertical padding only. The shell's content pane is already the page
      track, so it owns the 24px horizontal margin: repeating it as padding
      here would inset this page twice and leave it out of line with every
      other page in the shell.
    */
    <main class="w-full max-w-[914px] py-6">
      <Show
        when={isAdmin()}
        fallback={
          <Alert variant="destructive">
            <AlertDescription>{i18n.t("project.admin_only")}</AlertDescription>
          </Alert>
        }
      >
        <form onSubmit={submit} class="flex flex-col gap-6">
          <PageHeader
            title={i18n.t("project.new")}
            description={i18n.t("project.new_hint", { workspace: workspace().name })}
          />

          <Field
            label={i18n.t("common.name")}
            description={
              <>
                {i18n.t("project.address_prefix")}{" "}
                <span class="font-mono text-foreground">
                  /w/{workspace().slug}/{slugify(name() || "")}
                </span>
                .
              </>
            }
          >
            <Input
              placeholder="Themia"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </Field>

          <OneProductCallout />

          {/* Prop form, like the Name field above it: `Field` renders label,
              control, description in that fixed order, and the longhand form
              this used to be put the description above the control instead, so
              two rows on one page read in two different orders. */}
          <Field
            label={i18n.t("project.start_from")}
            description={i18n.t("project.start_from_hint")}
          >
            <TemplatePicker value={template()} onChange={setTemplate} />
          </Field>

          <Show when={error()}>
            {(message) => (
              <Alert variant="destructive">
                <AlertDescription>{message()}</AlertDescription>
              </Alert>
            )}
          </Show>

          <div class="flex items-center justify-end gap-2 border-t pt-4">
            <Link
              to="/w/$wslug"
              params={{ wslug: workspace().slug }}
              class={buttonVariants({ variant: "ghost" })}
            >
              {i18n.t("common.cancel")}
            </Link>
            {/* Kobalte renders type="button" unless told otherwise. */}
            <Button type="submit" disabled={busy() || !name().trim()}>
              {busy() ? i18n.t("common.creating") : i18n.t("project.create")}
            </Button>
          </div>
        </form>
      </Show>
    </main>
  );
}

/**
 * The one thing on this page that must not be skimmed.
 *
 * Drawn rather than only written, because "every surface of one product" is an
 * abstraction and three boxes pointing at one board is not.
 */
function OneProductCallout() {
  const i18n = useI18n();
  return (
    /*
      A card, not a tinted panel. `--primary` is the text extreme rather than a
      hue, so a fill and a border mixed out of it invent a grey that is on no
      step of the scale, and the ring a card already carries is the separation
      mechanism here.
    */
    <Card class="p-4">
      <h2 class="text-body font-semibold">{i18n.t("project.callout_title")}</h2>
      {/* One key, one whole sentence. The English emphasised three words in the
          middle of this paragraph; German puts them somewhere else, and a
          sentence assembled from two translated halves around a <strong> can
          only be right in the language it was written in. */}
      <p class="mt-2 text-body text-muted-foreground">{i18n.t("project.callout_body")}</p>

      {/* Chips at the measured 32px, separated by their ring rather than by a
          border: this box already spends a shadow, and two hairlines on one
          edge shift the row a pixel. */}
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <div class="flex flex-col gap-2">
          <span class="flex h-control-sm items-center gap-1.5 rounded-md px-2.5 text-body shadow-xs">
            <Globe class="size-3.5 text-muted-foreground" />
            {i18n.t("project.chip_website")}
          </span>
          <span class="flex h-control-sm items-center gap-1.5 rounded-md px-2.5 text-body shadow-xs">
            <Monitor class="size-3.5 text-muted-foreground" />
            {i18n.t("project.chip_desktop")}
          </span>
          <span class="flex h-control-sm items-center gap-1.5 rounded-md px-2.5 text-body shadow-xs">
            <Server class="size-3.5 text-muted-foreground" />
            {i18n.t("project.chip_backend")}
          </span>
        </div>
        <ArrowRight class="size-4 shrink-0 text-muted-foreground" />
        {/* The one chip that is the point, marked with the subtlest opaque
            fill on the scale rather than with a colour of its own. */}
        <span class="flex h-control-sm items-center gap-1.5 rounded-md bg-muted px-2.5 font-medium text-body shadow-xs">
          <LayoutDashboard class="size-3.5 text-foreground" />
          {i18n.t("project.chip_one_board")}
        </span>
      </div>

      {/*
        Worth being honest about the size of the mistake. Splitting a product
        across two projects is now cosmetic rather than structural: the events
        are all still there and still correct, they are just on boards that do
        not sit next to each other.
      */}
      <p class="mt-4 text-body text-muted-foreground">{i18n.t("project.callout_second")}</p>
    </Card>
  );
}
