import { Show, createEffect, onCleanup, type JSX } from "solid-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/index.js";
import { PageHeader } from "./page-header.js";
import { useI18n } from "../lib/i18n/index.js";
import { useSettingsNav, type SettingsSectionLink } from "./app-shell.js";

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
 * compact track, and this page publishes its sections into that pane. A rail
 * here would be a second navigation for the same list, on every settings page.
 *
 * The track itself belongs to the shell, so nothing here caps a width. Padding
 * follows the reference's split: horizontal on the container, vertical as a
 * margin on the column inside it.
 */
export function SettingsShell(props: {
  title: string;
  description?: string;
  sections: SettingsSectionLink[];
  children: JSX.Element;
}) {
  const { setSections } = useSettingsNav();

  // From an effect rather than during render: writing a signal a parent reads
  // while that parent is rendering is the loop Solid warns about, and the
  // effect never runs on the server, so the pane fills in on the client. The
  // sections are cleared on the way out or the pane keeps offering anchors for
  // a page nobody is on. Same shape as `useProjectNav` in the project route.
  createEffect(() => setSections(props.sections));
  onCleanup(() => setSections([]));

  return (
    <main class="px-6">
      <div class="my-6 flex min-w-0 flex-col gap-4">
        <PageHeader title={props.title} description={props.description} />
        {props.children}
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
        Same rule as `components/wiki/snippet.tsx`.
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
