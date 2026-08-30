import { createFileRoute, redirect } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Brandmark,
  Button,
  Card,
  CodeBlock,
  GithubIcon,
} from "../components/ui/index.js";
import { getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Sign in.
 *
 * Split layout: the form on the left, and the product behind glass on the
 * right. The preview is deliberately inert and very faint -- it says what this
 * is without pretending to be usable, and without inventing numbers convincing
 * enough that someone might read them as their own.
 */
export const Route = createFileRoute("/login")({
  loader: async () => {
    const session = await getSession();
    if (session.user) throw redirect({ to: "/" });
    return session;
  },
  component: Login,
});

/**
 * Five cards of the kind a board is made of.
 *
 * Named after events a customer would have chosen, because that is the claim:
 * nothing here is a built-in step, and none of these names means anything to
 * the server. The source line is there so the point that sources sit side by
 * side lands without a sentence explaining it.
 */
const PREVIEW_CARDS = [
  { label: "page_view", source: "themia.app", value: 3402 },
  { label: "download_clicked", source: "themia.app", value: 891 },
  { label: "app_install", source: "Themia for Windows", value: 446 },
  { label: "project_created", source: "Themia for Windows", value: 132 },
  { label: "checkout_completed", source: "api.themia.app", value: 13 },
];

/** The series the preview's bar chart is captioned with. An event name, not a word. */
const PREVIEW_SERIES = "app_install";

/** Drawn as a bar and printed under it. A fraction, so `percent` writes the sign. */
const PREVIEW_RETENTION = 0.38;

function Login() {
  const session = Route.useLoaderData();
  const i18n = useI18n();

  return (
    /*
      Both auth screens scroll the page itself. Neither sits inside the shell,
      so there is no scroll container above them, and clipping instead would
      put the sign-in button out of reach on a short window. The preview column
      keeps its own `overflow-hidden`, because that one really is a crop.

      The form column is 432px: the content column below plus the measured
      24px page margin on each side, so the split is stated in the same two
      numbers the rest of the port is laid out on.
    */
    <div class="grid h-dvh grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,432px)_1fr]">
      <div class="flex flex-col justify-center px-6 py-10">
        {/* The content column, stated once. Every row used to carry its own
            copy of this width, which is four places to change it. */}
        <div class="w-full max-w-sm">
          <div class="mb-8 flex items-center gap-2 font-semibold">
            <Brandmark class="h-3.5 w-auto" />
            firstrun
          </div>

          <h1 class="text-h2">{i18n.t("auth.sign_in")}</h1>
          <p class="mt-2 text-body text-muted-foreground">{i18n.t("auth.tagline")}</p>

          <Show
            when={session()?.loginConfigured}
            fallback={
              <Alert class="mt-6">
                <AlertTitle>{i18n.t("auth.not_configured")}</AlertTitle>
                <AlertDescription class="flex flex-col gap-2">
                  {/* The two variable names are interpolated rather than left as
                      markup inside the sentence. Keeping the mono `code` spans
                      would have meant three keys and a bare "and" between them,
                      and three fragments do not reassemble into German. */}
                  <span>
                    {i18n.t("auth.not_configured_hint", {
                      first: "GITHUB_CLIENT_ID",
                      second: "GITHUB_CLIENT_SECRET",
                    })}
                  </span>
                  <CodeBlock class="w-full" code="bun run dev:login seed" />
                </AlertDescription>
              </Alert>
            }
          >
            <Button as="a" href="/auth/github" class="mt-6 w-full gap-2">
              <GithubIcon class="size-4" />
              {i18n.t("auth.sign_in_with_github")}
            </Button>
          </Show>

          <p class="mt-6 text-caption text-muted-foreground">{i18n.t("auth.privacy_note")}</p>
        </div>
      </div>

      {/* The preview. Decorative, and told so. */}
      <div
        aria-hidden="true"
        class="relative hidden select-none overflow-hidden border-l bg-sidebar lg:block"
      >
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center p-14 opacity-[0.07]">
          <div class="w-full max-w-3xl">
            {/* `gap-px` over the border colour is what draws the hairlines
                between these five, so the container spends its ring instead of
                a border: one edge, not two. */}
            <div class="grid grid-cols-5 gap-px overflow-hidden rounded-md bg-border shadow-sm">
              <For each={PREVIEW_CARDS}>
                {(card) => (
                  <div class="bg-card p-4">
                    <div class="truncate font-mono text-mono text-muted-foreground">
                      {card.label}
                    </div>
                    <div class="mt-1.5 text-h2">{i18n.num(card.value)}</div>
                    <div class="mt-1.5 text-small uppercase tracking-wider text-muted-foreground">
                      {card.source}
                    </div>
                  </div>
                )}
              </For>
            </div>

            <div class="mt-4 grid grid-cols-3 gap-4">
              <Card class="col-span-2 p-4">
                <div class="text-small font-semibold uppercase tracking-wider text-muted-foreground">
                  {i18n.t("auth.preview_per_day", { name: PREVIEW_SERIES })}
                </div>
                <svg class="mt-4 h-20 w-full" viewBox="0 0 300 72" preserveAspectRatio="none">
                  <For each={[18, 24, 31, 22, 27, 39, 33, 20, 12, 26, 34, 29, 41, 36, 24, 30, 22, 17, 28, 35]}>
                    {(v, i) => (
                      <rect
                        x={i() * 15}
                        y={72 - v * 1.6}
                        width="13"
                        height={v * 1.6}
                        rx="1"
                        class="fill-chart-1"
                      />
                    )}
                  </For>
                </svg>
              </Card>
              <Card class="p-4">
                <div class="text-small font-semibold uppercase tracking-wider text-muted-foreground">
                  {i18n.t("auth.preview_retention")}
                </div>
                {/* One bar, one number. A second tinted segment here used to
                    say how much of the figure was a guess, and no number in
                    this product is a guess any more. */}
                <div class="mt-4 flex h-2 overflow-hidden rounded-full bg-muted">
                  <i class="block h-full w-[38%] bg-chart-1" />
                </div>
                <div class="mt-4 text-h2">{i18n.percent(PREVIEW_RETENTION)}</div>
              </Card>
            </div>
          </div>
        </div>

        {/* Fades the preview out toward the form so the eye lands on the button. */}
        <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-transparent to-transparent" />
      </div>
    </div>
  );
}
