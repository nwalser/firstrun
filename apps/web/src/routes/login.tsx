import { createFileRoute, redirect } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Brandmark,
  Button,
  CodeBlock,
  GithubIcon,
} from "../components/ui/index.js";
import { LoginPreview } from "../components/login-preview.js";
import { getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * Sign in.
 *
 * Split layout: the form on the left, and the product RUNNING on the right.
 * The preview is a live-looking instance of firstrun (entries landing, the edge
 * accepting them, meters rolling, the window sliding) because somebody signing
 * in is about to look at a board, and showing them one working says what this
 * is better than any sentence on the left could. It is inert, `aria-hidden` and
 * deterministic, its numbers are badged as sample data, and it can be stopped
 * by a real control that remembers the choice in the browser.
 *
 * It lives in `components/login-preview.tsx` rather than here: it is several
 * hundred nodes and one clock, and this route is a form and a button.
 */
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

      {/*
        The preview column.

        Its own `overflow-hidden` is a real crop: the tail runs off the bottom
        edge on purpose, because a log that ends in white space looks finished
        and a log that runs off the screen looks like it is still arriving.
      */}
      <div class="relative hidden overflow-hidden border-l border-chrome-border bg-background lg:block">
        <LoginPreview />

        {/*
          The board sits BEHIND the form, and this is what puts it there.

          One flat translucent black over the whole column. The edge fade that
          used to be here was a gradient, and neither design reference contains
          a gradient anywhere: measured, it painted the page colour over the
          page colour in light (so it did nothing at all) and dragged card text
          toward pure black in dark. The seam between the two panes is the
          column's own left border, which is what a border is for.
        */}
        <div aria-hidden="true" class="fr-scrim" />
      </div>
    </div>
  );
}
