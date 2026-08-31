import { Link, useRouterState } from "@tanstack/solid-router";
import Building2 from "lucide-solid/icons/building-2";
import Database from "lucide-solid/icons/database";
import Layers from "lucide-solid/icons/layers";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import ServerCog from "lucide-solid/icons/server-cog";
import { Show, type Component, type JSX } from "solid-js";
import { cn } from "../lib/cn.js";
import type { AdminContext, SessionInfo } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { ExpandSidebar, UserMenu } from "./app-shell.js";
import {
  Badge,
  Card,
  CardContent,
  ShellTopbar,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarPane,
  SidebarPaneHeader,
  SidebarProvider,
  SidebarRail,
} from "./ui/index.js";

/**
 * The operator's chrome, which is the application's chrome.
 *
 * This page used to have no shell at all, on the argument that the app's shell
 * is scoped to one workspace while this is scoped to all of them, so wrapping
 * it would put a workspace switcher above a table of every workspace. The first
 * half of that was right and the conclusion was wrong: what does not belong
 * here is the workspace SWITCHER, not the sidebar, the topbar, the account
 * footer, the collapse or the breadcrumb. Dropping all of it to avoid one
 * control left the one page in the product with no way back into it, no account
 * menu and no navigation, which is also why it could only ever be one page.
 *
 * So it is the same arrangement the documentation already uses: the same
 * `SidebarProvider`, the same `Sidebar`, the same 36px rows, the same 52px
 * collapsed strip, the same Ctrl+B, the same drawer on a phone, the same
 * `ShellTopbar`, the same scrolling pane and the same 1620px content track.
 * Everything structural comes from `ui/sidebar.tsx`, so there is one set of
 * numbers rather than three that drift apart a pixel at a time.
 *
 * ## What is IN it is different, because the scope is
 *
 * | slot | app | operator |
 * | --- | --- | --- |
 * | header row 1 | workspace switcher | the deployment, with its edition |
 * | header row 2 | Find | nothing |
 * | nav | boards and settings | the operator's four pages |
 * | pane header | the settings back chevron | the way back into the app |
 * | topbar left | project switcher | nothing |
 * | topbar right | reserved | reserved |
 *
 * The header row is not a switcher and does not pretend to be one: there is
 * exactly one deployment and no popover to open, so the row is a link back to
 * the overview with the edition badge where the plan badge sits in the app. A
 * chevron on a control with one option is a control that lies about what it
 * does.
 *
 * There is no `PlanNotice` above the content either. A plan belongs to a
 * workspace, and the operator is not standing in one.
 */
export function AdminShell(props: {
  session: SessionInfo;
  context: AdminContext;
  children: JSX.Element;
}) {
  const i18n = useI18n();
  const routerState = useRouterState();
  const path = () => routerState().location.pathname.replace(/\/+$/, "") || "/";

  return (
    <SidebarProvider>
      <Sidebar>
        {/*
          One row, not the app's two. The second row is the app's Find, and
          there are four pages here: a search over four rows is a control with
          nothing to do. The header is 48px here and 92px in the app, and both
          are the same header with what they have in them.
        */}
        <SidebarHeader>
          <AdminScope context={props.context} />
        </SidebarHeader>

        <SidebarContent>
          {/*
            One pane, always active. The app pushes a second pane for settings;
            there is nothing to push here, and a pane component with one pane in
            it costs nothing while keeping the padding, the transition context
            and the scroll behaviour identical.
          */}
          <SidebarPane side="root" active>
            {/*
              The operator pages are a pane you came into, so they leave the way
              you came out of any other one: the back chevron at the top of the
              column, exactly where Settings and the documentation put it.

              A plain `href` rather than a `Link`, and to `/` rather than to a
              workspace: this session may operate a deployment it is not a
              member of anything on, so the root is the only destination that is
              certainly right. It resolves to whichever workspace this account
              actually has.
            */}
            <SidebarPaneHeader
              as="a"
              href="/"
              title={i18n.t("admin.nav")}
              label={i18n.t("admin.back_to_app")}
            />
            <AdminNav path={path()} />
          </SidebarPane>
        </SidebarContent>

        <SidebarFooter class="flex-row items-center gap-2">
          <UserMenu session={props.session} />
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <ShellTopbar leading={<ExpandSidebar />}>
          <AdminBreadcrumb path={path()} />
        </ShellTopbar>

        {/*
          The only scroll container on the page, and the container QUERY context
          for everything inside it. The app's arrangement exactly, including the
          1620px track: these pages carry wide tables, and a table that has to
          agree with the workspace list beside it wants the same measure.
        */}
        <div class="@container/page min-h-0 flex-1 overflow-y-auto">
          <div class="grid grid-cols-[minmax(24px,1fr)_minmax(0,1620px)_minmax(24px,1fr)]">
            <div class="col-start-2 min-w-0">{props.children}</div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * The deployment, in the sidebar header.
 *
 * The shape of the app's workspace row: a 20px mark, the name, and a badge
 * pushed to the end. The badge is the EDITION rather than a plan, because that
 * is the one fact about a deployment that changes what every page under it
 * means: on a self-hosted install the plans and limits below are recorded and
 * ignored, and an operator who does not know which install they are looking at
 * will read the workspaces table as a bill.
 */
function AdminScope(props: { context: AdminContext }) {
  const i18n = useI18n();

  return (
    <div class="flex h-12 items-center px-2 py-1">
      <div class="flex h-10 min-w-0 flex-1 items-center rounded-md">
        <Link
          to="/admin"
          class={cn(
            "focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-2 pl-2.5",
            "text-body font-medium outline-none transition-colors hover:bg-sidebar-accent"
          )}
        >
          <span class="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            <ServerCog class="size-4" />
          </span>
          <SidebarLabel class="truncate">{i18n.t("admin.nav")}</SidebarLabel>
          {/* Where the app puts the plan badge, and the same shape. */}
          <Badge variant="secondary" class="ml-auto shrink-0 text-caption">
            {props.context.cloud ? i18n.t("admin.edition_cloud") : i18n.t("admin.edition_self")}
          </Badge>
        </Link>
      </div>
    </div>
  );
}

/**
 * The operator's pages, as one group.
 *
 * One group and no rule, because they are all the same scope's destinations:
 * this deployment, its customers, its storage. The app splits its column
 * because half of it is the data you came to read and half is not, and there is
 * no such split here.
 *
 * The rows are written out rather than mapped over a table, for the reason
 * `RootNav` writes its rows out: the router's `to` is a typed literal, and
 * anything that hands it a widened string gives up the one property worth
 * having from a typed router, that a renamed route is a compile error rather
 * than a dead link. Four rows is a cheap price for that.
 */
function AdminNav(props: { path: string }) {
  const i18n = useI18n();

  const isActive = (href: string, exact = false) =>
    exact ? props.path === href : props.path === href || props.path.startsWith(href + "/");

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{i18n.t("admin.group_instance")}</SidebarGroupLabel>
      <SidebarMenu aria-label={i18n.t("admin.group_instance")}>
        <SidebarMenuItem>
          <SidebarMenuButton
            as={Link}
            to="/admin"
            tooltip={i18n.t("admin.nav_overview")}
            /* Exact. The overview is the index of this area, so a prefix test
               would leave it marked while every other page is open. */
            isActive={isActive("/admin", true)}
          >
            <LayoutGrid />
            <SidebarLabel>{i18n.t("admin.nav_overview")}</SidebarLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton
            as={Link}
            to="/admin/workspaces"
            tooltip={i18n.t("admin.nav_workspaces")}
            isActive={isActive("/admin/workspaces")}
          >
            <Building2 />
            <SidebarLabel>{i18n.t("admin.nav_workspaces")}</SidebarLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton
            as={Link}
            to="/admin/database"
            tooltip={i18n.t("admin.nav_database")}
            isActive={isActive("/admin/database")}
          >
            <Database />
            <SidebarLabel>{i18n.t("admin.nav_database")}</SidebarLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>

        <SidebarMenuItem>
          <SidebarMenuButton
            as={Link}
            to="/admin/partitions"
            tooltip={i18n.t("admin.nav_partitions")}
            isActive={isActive("/admin/partitions")}
          >
            <Layers />
            <SidebarLabel>{i18n.t("admin.nav_partitions")}</SidebarLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The page, as an icon and a title, centred in the bar.
 *
 * The app's own breadcrumb rebuilt for these four routes rather than shared:
 * `pageIdentity` in `app-shell.tsx` derives its answer from workspace paths and
 * is mounted inside a workspace. Same anatomy though, and deliberately without
 * the app's scroll-linked reveal: these pages are short enough that their own
 * heading is usually still on screen, and a slash that never appears is worse
 * than one that is always there.
 */
function AdminBreadcrumb(props: { path: string }) {
  const i18n = useI18n();

  const page = (): { icon: Component<{ class?: string }>; title: string } => {
    const path = props.path;
    const at = (href: string) => path === href || path.startsWith(href + "/");
    if (at("/admin/workspaces"))
      return { icon: Building2, title: i18n.t("admin.nav_workspaces") };
    if (at("/admin/database")) return { icon: Database, title: i18n.t("admin.nav_database") };
    if (at("/admin/partitions")) return { icon: Layers, title: i18n.t("admin.nav_partitions") };
    return { icon: LayoutGrid, title: i18n.t("admin.nav_overview") };
  };

  return (
    <nav
      aria-label={i18n.t("shell.breadcrumb")}
      class="flex min-w-0 items-center justify-center gap-0.5 text-body"
    >
      <span class="hidden shrink-0 items-center gap-2 pr-2.5 md:flex">
        <span class="flex size-6 items-center justify-center text-muted-foreground">
          {(() => {
            const Icon = page().icon;
            return <Icon class="size-4" />;
          })()}
        </span>
        {/* The slash is drawn, not typed: a text slash inherits the label's
            colour and weight, and the separator is meant to sit well below
            both. */}
        <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4 shrink-0 text-border" fill="none">
          <path d="M4.5 13.5L11.5 2.5" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </span>
      <Show when={page().title} keyed>
        {(title) => (
          <span
            class={cn(
              "truncate font-medium tracking-snug text-foreground",
              "motion-safe:animate-in motion-safe:fade-in"
            )}
          >
            {title}
          </span>
        )}
      </Show>
    </nav>
  );
}

/**
 * One number and what it is, in the strip above a page.
 *
 * The app's own summary anatomy: a 12px caption over a 24/600 number, and
 * `tabular-nums` so a row of them does not shuffle sideways as a loader
 * reloads. `hint` is for the number that needs a caveat attached to it rather
 * than buried in a paragraph below, which on these pages is usually the word
 * "estimated".
 */
export function Fact(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="min-w-0">
      <div class="text-caption text-muted-foreground">{props.label}</div>
      <div class="text-h2 tabular-nums">{props.children}</div>
      <Show when={props.hint}>
        {(hint) => <div class="truncate text-caption text-muted-foreground">{hint()}</div>}
      </Show>
    </div>
  );
}

/**
 * The strip itself.
 *
 * A column on a narrow pane and a row on a wide one, on the pane's own
 * container query rather than the viewport's: collapsing the sidebar gives the
 * content 235px back, and a strip that only reflows when the WINDOW changes
 * would sit in one column beside 200px of empty space.
 */
export function FactRow(props: { children: JSX.Element }) {
  return (
    <Card>
      <CardContent class="flex flex-col gap-4 @md-page/page:flex-row @md-page/page:gap-10">
        {props.children}
      </CardContent>
    </Card>
  );
}
