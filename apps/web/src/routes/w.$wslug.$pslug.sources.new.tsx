import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import Globe from "lucide-solid/icons/globe";
import Monitor from "lucide-solid/icons/monitor";
import { For, Show, createSignal } from "solid-js";
import { InstallGuideLink } from "../components/install-guide.js";
import { TemplatePicker } from "../components/template-picker.js";
import {
  Alert,
  AlertDescription,
  Button,
  CodeBlock,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  RadioCard,
  RadioGroup,
  Spinner,
  Switch,
  buttonVariants,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { createSourceFn } from "../lib/api.js";
import { useI18n, type SimpleKey } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * Adding a source, as a page.
 *
 * Two questions and a handover, none of which fits in a drawer over the list it
 * is about to change.
 *
 * There used to be three, and the first was "what kind of source is this" -- a
 * website or a desktop app. That answer decided the middle segment of the key,
 * the value stamped onto every event, which boards were offered and whether the
 * installer basename was even asked. All of it is gone: a source is one thing
 * that writes events, and what it happens to run on is the customer's business.
 *
 * The last step comes after creation on purpose. The ingest key does not exist
 * until then, and the guide it hands over to is written against a real key
 * rather than a placeholder somebody pastes with the placeholder still in it.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources/new")({
  component: NewSource,
});

/**
 * The step names, by key. Resolved inside the component: a label resolved here
 * would be frozen in whichever locale was active when the module was first
 * evaluated, and switching language would leave the stepper in English.
 */
const STEP_KEYS: SimpleKey[] = [
  "sources.step_details",
  "sources.step_dashboard",
  "sources.step_install",
];

function NewSource() {
  const i18n = useI18n();
  const view = ProjectRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [step, setStep] = createSignal(0);
  const [name, setName] = createSignal("");
  const [assetName, setAssetName] = createSignal("");
  const [wantsBoard, setWantsBoard] = createSignal(true);
  // The overview, because nothing on this page says which board would suit
  // better. It used to be picked from the kind, and there is no kind to pick
  // from: every template is on offer and the reader chooses.
  const [template, setTemplate] = createSignal("overview");
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
        ...(wantsBoard() ? { template: template() } : {}),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated({ sourceId: result.sourceId, ingestKey: result.ingestKey });
    setStep(2);
    // So the list, the tab strip and the sidebar all know about it before the
    // reader gets back to any of them.
    await router.invalidate();
  }

  function submit(e: Event) {
    e.preventDefault();
    if (step() === 0 && !name().trim()) return;
    if (step() < 1) {
      setStep(step() + 1);
      return;
    }
    if (step() === 1) void create();
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
            when={step() < 3}
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

                <div class="flex justify-end gap-2 border-t pt-6">
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
              <Show when={step() === 0}>
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
              </Show>

              <Show when={step() === 1}>
                <div>
                  <h1 class="text-h2">{i18n.t("sources.step_board_title")}</h1>
                  <p class="mt-1 text-body text-muted-foreground">
                    {i18n.t("sources.step_board_hint")}
                  </p>
                </div>

                <Switch
                  checked={wantsBoard()}
                  onChange={setWantsBoard}
                  label={i18n.t("sources.want_board")}
                  description={i18n.t("sources.want_board_hint")}
                />

                <Show when={wantsBoard()}>
                  <Field>
                    <FieldLabel>{i18n.t("sources.template_label")}</FieldLabel>
                    <FieldDescription>{i18n.t("sources.template_hint")}</FieldDescription>
                    <TemplatePicker
                      value={template()}
                      onChange={setTemplate}
                      class="mt-2"
                    />
                  </Field>
                </Show>
              </Show>

              <Show when={error()}>
                {(message) => (
                  <Alert variant="destructive">
                    <AlertDescription>{message()}</AlertDescription>
                  </Alert>
                )}
              </Show>

              <div class="flex items-center justify-between border-t pt-6">
                <Show
                  when={step() > 0}
                  fallback={
                    <Link
                      to="/w/$wslug/$pslug/sources"
                      params={{ wslug: view().workspace.slug, pslug: view().project.slug }}
                      class={buttonVariants({ variant: "ghost" })}
                    >
                      {i18n.t("common.cancel")}
                    </Link>
                  }
                >
                  <Button type="button" variant="ghost" onClick={() => setStep(step() - 1)}>
                    {i18n.t("common.back")}
                  </Button>
                </Show>

                {/* Kobalte renders type="button" unless told otherwise.

                    Spinner and the changed word, the treatment `ConfirmDelete`
                    already uses: a disabled button reading "Creating" is
                    indistinguishable from a disabled button that has stopped.
                    Only the last step can be busy -- the first is a step
                    counter, not a request. */}
                <Button type="submit" disabled={busy() || (step() === 0 && !name().trim())}>
                  <Show when={busy()}>
                    <Spinner />
                  </Show>
                  {step() < 1
                    ? i18n.t("sources.continue")
                    : busy()
                      ? i18n.t("common.creating")
                      : i18n.t("sources.create")}
                </Button>
              </div>
            </form>
          </Show>
        </Show>
      </main>
    </div>
  );
}
