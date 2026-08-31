import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import Globe from "lucide-solid/icons/globe";
import Monitor from "lucide-solid/icons/monitor";
import { For, Show, createSignal } from "solid-js";
import { InstallGuideLink } from "../components/install-guide.js";
import {
  Alert,
  AlertDescription,
  Button,
  CodeBlock,
  Field,
  Input,
  Spinner,
  buttonVariants,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { createSourceFn } from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * Adding a source, as a page.
 *
 * One question and a handover: name the thing, then install it. It does ONE
 * thing, in full, and nothing else on the way past.
 *
 * There used to be a step in the middle that made a board from a template at
 * the same time. It is gone, and not because boards stopped mattering: it asked
 * half of a decision -- a template, but no name, no range and no scope -- that
 * the page for adding a board asks properly. Two pages asking the same question
 * differently is how somebody ends up with a board they did not choose and
 * cannot find the settings for. Adding a source adds a source; the quickstart
 * on the project page is what points at the board step next.
 *
 * Before that there was a step asking "what kind of source is this" -- a
 * website or a desktop app -- which decided the middle segment of the key, the
 * value stamped onto every event, and which boards were offered. Also gone: a
 * source is one thing that writes events, and what it happens to run on is the
 * customer's business.
 *
 * The install step comes after creation on purpose. The ingest key does not
 * exist until then, and the guide it hands over to is written against a real
 * key rather than a placeholder somebody pastes with the placeholder still in
 * it.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources/new")({
  component: NewSource,
});

/**
 * The step names, by key. Resolved inside the component: a label resolved here
 * would be frozen in whichever locale was active when the module was first
 * evaluated, and switching language would leave the stepper in English.
 */
const STEP_KEYS: SimpleKey[] = ["sources.step_details", "sources.step_install"];

function NewSource() {
  const i18n = useI18n();
  const view = ProjectRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [step, setStep] = createSignal(0);
  const [name, setName] = createSignal("");
  const [assetName, setAssetName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<{ sourceId: string; ingestKey: string } | null>(null);

  const isAdmin = () => view().role === "admin";

  async function create() {
    setBusy(true);
    setError(null);
    const result = await createSourceFn({
      data: {
        workspace: view().workspace.slug,
        project: view().project.slug,
        name: name().trim(),
        ...(assetName().trim() ? { assetName: assetName().trim() } : {}),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated({ sourceId: result.sourceId, ingestKey: result.ingestKey });
    setStep(1);
    // So the list, the tab strip and the sidebar all know about it before the
    // reader gets back to any of them.
    await router.invalidate();
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!name().trim()) return;
    void create();
  }

  // The compact track, the measured 914px one Settings uses, rather than a
  // fourth page width invented here. The shell's own track is the wide one, so
  // this nests: the margins resolve against whatever the pane has left.
  return (
    <div class="page-track page-track-compact">
      <main class="w-full py-6">
        <Show
          when={isAdmin()}
          fallback={
            <Alert variant="destructive">
              <AlertDescription>{i18n.t("sources.admin_only")}</AlertDescription>
            </Alert>
          }
        >
          <ol class="mb-8 flex items-center gap-2 text-caption">
            <For each={STEP_KEYS}>
              {(labelKey, i) => (
                <li class="flex items-center gap-2">
                  {/*
                    The marker and its label move between three states as the
                    reader steps, and they used to snap while every control on
                    the page beneath them faded. `transition-colors` rather than
                    the control convention: nothing here spends a box-shadow,
                    and the weight change on the label cannot be tweened
                    anyway.
                  */}
                  <span
                    class={cn(
                      "flex size-6 items-center justify-center rounded-full border text-caption font-medium",
                      "transition-colors",
                      i() === step() && "border-primary bg-primary text-primary-foreground",
                      i() < step() && "border-primary/40 text-primary",
                      i() > step() && "text-muted-foreground"
                    )}
                  >
                    {i() + 1}
                  </span>
                  <span
                    class={cn(
                      "transition-colors",
                      i() === step() ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {i18n.t(labelKey)}
                  </span>
                  <Show when={i() < STEP_KEYS.length - 1}>
                    <span class="ml-1 h-px w-6 bg-border" />
                  </Show>
                </li>
              )}
            </For>
          </ol>

          <Show
            when={step() === 0}
            fallback={
              <div class="flex flex-col gap-6">
                <div>
                  <h1 class="text-h2">{i18n.t("sources.ready", { name: name() })}</h1>
                  <p class="mt-1 text-body text-muted-foreground">
                    {i18n.t("sources.ready_hint")}
                  </p>
                </div>

                <div>
                  <div class="mb-2 text-caption text-muted-foreground">
                    {i18n.t("sources.key_label")}
                  </div>
                  <CodeBlock code={created()?.ingestKey ?? ""} />
                </div>

                <Show when={created()}>
                  {(source) => <InstallGuideLink sourceId={source().sourceId} />}
                </Show>

                {/*
                  Two ways on, and the board is not made here. The page that
                  makes boards asks the whole question -- name, arrangement, and
                  which source it is about -- and this page has no business
                  asking a third of it on the way past.
                */}
                <div class="flex justify-end gap-2 border-t pt-6">
                  <Link
                    to="/w/$wslug/$pslug/dashboards/new"
                    params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
                    class={buttonVariants({ variant: "outline" })}
                  >
                    {i18n.t("sources.make_board")}
                  </Link>
                  <Link
                    to="/w/$wslug/$pslug/sources"
                    params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
                    class={buttonVariants({})}
                  >
                    {i18n.t("common.done")}
                  </Link>
                </div>
              </div>
            }
          >
            <form onSubmit={submit} class="flex flex-col gap-6">
              {/*
                No wrapper element here, and no fragment either. This used to be
                one of two `<Show>` blocks and is now the only step; a `<>` in
                its place is a compile error under a `<form>` in Solid, and one
                that SSRs perfectly while 500ing the client module -- so the
                page renders correctly and then quietly ignores every keystroke.
              */}
              <div>
                <h1 class="text-h2">{i18n.t("sources.step_details_title")}</h1>
                <p class="mt-1 text-body text-muted-foreground">
                  {i18n.t("sources.step_details_hint")}
                </p>
              </div>

              <Field label={i18n.t("common.name")}>
                <Input
                  // A domain, so it stays as written. It is an example of a
                  // name rather than a claim about what this source is.
                  placeholder="themia.app"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
              </Field>

              {/*
                A label, not a mechanism. It is what the install guides put in
                the SDK snippet's app name, so a reader copying one gets their
                own application named back at them instead of "YourApp".
              */}
              <Field
                label={i18n.t("sources.asset_label")}
                description={i18n.t("sources.asset_hint")}
              >
                <Input
                  placeholder="Themia"
                  value={assetName()}
                  onInput={(e) => setAssetName(e.currentTarget.value)}
                />
              </Field>

              <Show when={error()}>
                {(message) => (
                  <Alert variant="destructive">
                    <AlertDescription>{message()}</AlertDescription>
                  </Alert>
                )}
              </Show>

              <div class="flex items-center justify-end gap-2 border-t pt-6">
                <Link
                  to="/w/$wslug/$pslug/sources"
                  params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
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
                  {busy() ? i18n.t("common.creating") : i18n.t("sources.create")}
                </Button>
              </div>
            </form>
          </Show>
        </Show>
      </main>
    </div>
  );
}
