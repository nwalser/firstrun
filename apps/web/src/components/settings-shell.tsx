import { For, Show, type JSX } from "solid-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Skeleton,
} from "./ui/index.js";
import { PageHeader } from "./page-header.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * The frame every settings page shares.
 *
 * Settings pages are where a wrong click is expensive, so their shape is
 * decided once here rather than per route: one column of cards and, via
 * `DangerZone`, destructive actions that never sit in the same visual block as
 * an ordinary Save.
 *
 * There is NO nav column beside the content. Settings reuses the one sidebar:
 * the shell swaps it to the settings pane and narrows the content to the
 * compact track. A rail here would be a second navigation for the same list, on
 * every settings page.
 *
 * The pane lists ROUTES, and this page does not tell it about them. It used to:
 * every settings page published its card anchors up into the pane, which made
 * the pane's rows scroll the page instead of changing it. Each of those cards
 * that is a page now has a page, and a route is something the router already
 * knows about without being told.
 *
 * The track itself belongs to the shell, so nothing here caps a width. Padding
 * follows the reference's split: horizontal on the container, vertical as a
 * margin on the column inside it.
 */
export function SettingsShell(props: {
  title: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <main class="px-6">
      <div class="my-6 flex min-w-0 flex-col gap-4">
        <PageHeader title={props.title} description={props.description} />
        {props.children}
      </div>
    </main>
  );
}

/**
 * What a settings page is while its loader is still running.
 *
 * Every settings route reads a session and then a workspace or a project, so
 * every one of them can hang for a round trip or two. They used to show
 * NOTHING for that time: the router held the previous page on screen and the
 * app looked frozen, which is the same failure on three pages that already
 * share a frame. Sharing the pending state too is why it lives here.
 *
 * Same track, same padding and the same 24/600 heading block as the real page,
 * so nothing shifts when the cards arrive. Three cards is what the shortest of
 * these pages has; a page with more grows into it rather than jumping.
 */
export function SettingsPending() {
  return (
    <main class="px-6">
      <div class="my-6 flex min-w-0 flex-col gap-4">
        <div class="flex flex-none flex-col gap-4 pt-4 pb-4">
          <div class="flex flex-col gap-2">
            <Skeleton class="h-8 w-56" />
            <Skeleton class="h-5 w-full max-w-2xl" />
          </div>
        </div>
        <For each={[0, 1, 2]}>{() => <Skeleton class="h-40 w-full" />}</For>
      </div>
    </main>
  );
}

export function SettingsSection(props: {
  id: string;
  title: string;
  description?: string;
  children: JSX.Element;
  footer?: JSX.Element;
}) {
  return (
    // `scroll-mt` so a pane link lands the heading below the sticky header
    // instead of underneath it.
    <Card id={props.id} class="scroll-mt-4">
      <CardHeader class="flex-col items-stretch gap-1">
        <CardTitle>{props.title}</CardTitle>
        <Show when={props.description}>
          {(description) => <CardDescription>{description()}</CardDescription>}
        </Show>
      </CardHeader>

      <CardContent>{props.children}</CardContent>

      {/*
        Always in the markup, empty when the section has no footer, and out of
        the layout when it is empty.

        `when={props.footer}` would read the prop to test it, and reading a
        markup prop BUILDS its nodes -- before the footer meant to contain them
        exists. During hydration that claims the server's nodes in an order the
        server did not write them in, Solid throws a hydration mismatch, and its
        own error path cannot print itself: the console says
        `template2 is not a function` and the whole page renders a second time.
        Same rule as `components/docs/snippet.tsx`.
      */}
      <CardFooter class="justify-end gap-2 border-t pt-4 empty:hidden">{props.footer}</CardFooter>
    </Card>
  );
}

/**
 * Everything that cannot be undone, behind its own edge.
 *
 * The separation is not decoration. A delete control that sits in the same card
 * as Save is one mis-aimed click away from being pressed, and there is no undo
 * for a deleted workspace -- the rows are gone, not flagged.
 *
 * One 1px layer, not two. The card's own separation is a box-shadow ring, so a
 * ring stacked on top of it composes two 1px shadows into one edge that reads
 * heavier than every other surface on the page and shifts colour where they
 * overlap. Dropping the card's shadow and re-drawing the edge in the
 * destructive tint keeps it at the same weight as the cards above it.
 */
export function DangerZone(props: { id?: string; children: JSX.Element }) {
  const i18n = useI18n();

  return (
    <Card id={props.id ?? "danger"} class="scroll-mt-4 shadow-none ring-1 ring-destructive/40">
      <CardHeader class="flex-col items-stretch gap-1">
        <CardTitle class="text-negative">{i18n.t("settings.danger_zone")}</CardTitle>
        <CardDescription>{i18n.t("settings.danger_zone_hint")}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">{props.children}</CardContent>
    </Card>
  );
}
