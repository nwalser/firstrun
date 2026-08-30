import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import BookOpen from "lucide-solid/icons/book-open";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Copy from "lucide-solid/icons/copy";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Gauge from "lucide-solid/icons/gauge";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import LogOut from "lucide-solid/icons/log-out";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Settings from "lucide-solid/icons/settings";
import Trash2 from "lucide-solid/icons/trash-2";
import Users from "lucide-solid/icons/users";
import {
  For,
  Show,
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../lib/i18n/index.js";
import {
  deleteDashboardFn,
  duplicateDashboardFn,
  renameDashboardFn,
  reorderDashboardsFn,
  type DashboardSummary,
  type MemberRole,
  type ProjectSummary,
  type SessionInfo,
  type WorkspaceSummary,
} from "../lib/api.js";
import { LocaleSwitcher } from "./locale-switcher.js";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  ConfirmDelete,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Kbd,
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
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
  SidebarSeparator,
  SidebarSubButton,
  SidebarTrigger,
  hairlineBottom,
  initials,
  toast,
  useSidebar,
} from "./ui/index.js";

/**
 * The application shell, ported to the structure in `docs/vercel-structure.md`.
 *
 * Four things about the arrangement, because each of them replaced something
 * that looked reasonable and was not what the reference does:
 *
 *   1. THE SIDEBAR IS THE FULL-HEIGHT ELEMENT. 287px, and the topbar starts at
 *      its right edge rather than spanning it. The topbar therefore belongs to
 *      the content pane, not to the window.
 *   2. THERE IS NO TAB ROW. All contextual navigation is the sidebar list, and
 *      the list is parameterised by scope: the same three groups at workspace
 *      scope and at project scope, with only the hrefs changing. A project's
 *      boards are rows in the first group -- see the note on `BoardRows`.
 *   3. THE SCOPE SWITCHER IS SPLIT. Workspace lives in the sidebar header,
 *      project lives in the topbar's left cell, and they never appear in the
 *      same container. Both open the identical 384px popover, which is why
 *      there is one `ScopeSwitcher` and two callers.
 *   4. THE CENTRED BREADCRUMB IS THE PAGE, NOT THE SCOPE. Page icon, slash,
 *      page title. Putting workspace/project there would say a third time what
 *      the two switchers already say.
 *
 * Everything in here is chrome, which in this design system means 14px on a
 * 20px line and controls on the 32/36/40 height rhythm. 16px is prose, and the
 * only place the app renders prose is the wiki.
 *
 * Surfaces: the sidebar and the topbar both sit on the PAGE colour, not on a
 * tint of their own, and are cut off by a one-device-pixel hairline. That
 * leaves a content card the only raised thing on screen, which is the whole
 * point of a page that is pure black in the dark theme.
 *
 * The page itself never scrolls -- the provider is `h-dvh overflow-hidden` and
 * the content pane scrolls inside it. A dashboard whose chrome slides away when
 * you scroll a table is a dashboard you have to scroll back up to navigate.
 */

export interface AppShellProps {
  session: SessionInfo;
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  children: JSX.Element;
}

/** What the sidebar shows while a project is open. */
export interface ProjectNav {
  projectSlug: string;
  projectName: string;
  role: MemberRole;
  dashboards: DashboardSummary[];
  /** The board currently on screen. Null on pages under a project that are not a board. */
  activeSlug: string | null;
}

interface ProjectNavStore {
  nav: Accessor<ProjectNav | null>;
  setNav: (nav: ProjectNav | null) => void;
}

const ProjectNavCtx = createContext<ProjectNavStore>();

/** One anchored section of the settings page currently on screen. */
export interface SettingsSectionLink {
  id: string;
  label: string;
}

interface SettingsNavStore {
  sections: Accessor<SettingsSectionLink[]>;
  setSections: (sections: SettingsSectionLink[]) => void;
}

const SettingsNavCtx = createContext<SettingsNavStore>();

/**
 * The sections of the open settings page, published upwards into the pane.
 *
 * The reference's settings pane lists 19 sub-items and the content is one
 * column: the pane IS the section list, which is why a settings page must not
 * grow a rail of its own. Our settings are one page per scope with anchored
 * sections inside it, so the page publishes its anchors and the pane draws
 * them, the same way a project publishes its boards.
 *
 * Same SSR caveat as `useProjectNav`: the path decides which pane is showing,
 * this only fills it in.
 */
export function useSettingsNav(): SettingsNavStore {
  return useContext(SettingsNavCtx) ?? { sections: () => [], setSections: () => {} };
}

/**
 * The open project, published upwards into the sidebar.
 *
 * The shell is mounted by the workspace route and a project's boards are known
 * only one level further down, so this is a signal a child writes into rather
 * than a prop a parent passes.
 *
 * It is NOT what decides the scope. The effect that publishes it does not run
 * during SSR, so a sidebar whose shape came from this value would render at
 * workspace scope on the server and snap to project scope on hydration, on
 * every project page. The scope comes from the path; this fills it in.
 *
 * Falls back to a no-op outside the shell, so a route can register itself
 * without first checking whether it is inside one.
 */
export function useProjectNav(): ProjectNavStore {
  return useContext(ProjectNavCtx) ?? { nav: () => null, setNav: () => {} };
}

export function WorkspaceLogo(props: { workspace: WorkspaceSummary; class?: string }) {
  return (
    <Avatar class={cn("size-5 rounded-full", props.class)}>
      <AvatarImage
        // The timestamp is the cache key: the URL is stable, so a replaced logo
        // still appears immediately instead of after the cache expires.
        src={
          props.workspace.logoUpdatedAt
            ? `/api/logo/${props.workspace.slug}?v=${new Date(props.workspace.logoUpdatedAt).getTime()}`
            : undefined
        }
        alt=""
      />
      <AvatarFallback class="bg-sidebar-primary text-[9px] font-semibold text-sidebar-primary-foreground">
        {initials(props.workspace.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A project's avatar. 16px and 6px-rounded in the topbar, per the measurement:
 * the workspace avatar is round and this one is not, which is most of what
 * tells the two scope segments apart at a glance.
 */
function ProjectLogo(props: { name: string; class?: string }) {
  return (
    <span
      class={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-md",
        "bg-muted text-[8px] font-semibold text-foreground",
        props.class
      )}
    >
      {initials(props.name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The scope popover, shared by both switcher segments
// ---------------------------------------------------------------------------

/** One selectable row. `go` is client-side; without it the href is followed. */
interface ScopeItem {
  key: string;
  label: string;
  /**
   * A thunk, not an element, because the list is built before the popover is.
   *
   * `ScopeSwitcher` reads `props.groups` from a `createMemo`, which runs the
   * moment the switcher is created -- while the sidebar header is hydrating and
   * long before anyone has opened the popover. A bare `<WorkspaceLogo/>` in the
   * object literal is therefore CONSTRUCTED there: its nodes are built inside
   * the header's hydration context and claim the server's nodes out of order.
   * The server wrote no popover at all (it is closed), so the claim finds
   * nothing and Solid throws a hydration mismatch, which surfaces as
   * `template2 is not a function` and leaves the whole page rendered twice.
   * Deferring the JSX behind a call keeps it inside the row that holds it.
   */
  media: () => JSX.Element;
  current: boolean;
  /** Always set, even when `go` is, so middle-click and copy-link still work. */
  href: string;
  go?: () => void;
}

interface ScopeGroup {
  key: string;
  label: string;
  items: ScopeItem[];
}

interface ScopeCreate {
  label: string;
  description?: string;
  href: string;
  go?: () => void;
}

/**
 * The 384px popover both scope segments open.
 *
 * One component and two callers, because the reference uses the identical shell
 * for team and project and the shell is the part with the behaviour in it:
 *
 *   - the search input takes focus the moment it opens, so the first keystroke
 *     filters instead of being swallowed;
 *   - arrow keys move a roving selection over a FLAT index that runs through
 *     every group and then through the footer action, so "create" is reachable
 *     by holding Down rather than by leaving the keyboard;
 *   - Enter follows whatever is selected, and Esc closes (the header shows the
 *     key, which is the only reason anyone knows).
 *
 * The trigger is deliberately not this component's problem. Both segments split
 * the row in two -- the name navigates, a separate chevron button opens this --
 * and that split is the reason the row feels fast. So the caller passes the row
 * as children and the chevron is the `PopoverTrigger` inside it.
 */
function ScopeSwitcher(props: {
  anchorClass?: string;
  /** The row: a link, then the chevron trigger. */
  children: JSX.Element;
  placeholder: string;
  emptyLabel: string;
  groups: ScopeGroup[];
  create?: ScopeCreate;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;

  /**
   * Keep the roving selection on screen.
   *
   * The scroller is 300px around 36px rows, so it shows eight. Without this the
   * ninth Down keypress selects a row nobody can see, and the list looks like
   * it has stopped responding.
   */
  const reveal = (index: number) =>
    list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });

  const matches = (label: string) => {
    const q = query().trim().toLowerCase();
    return q === "" || label.toLowerCase().includes(q);
  };

  /**
   * The groups, filtered, with the flat roving index stamped on every row.
   *
   * Computed in one pass rather than derived per row: the index has to run
   * across group boundaries, and a per-row `indexOf` would be quadratic and
   * would also disagree with itself while the filter is being typed.
   */
  const indexed = createMemo(() => {
    let n = 0;
    return props.groups
      .map((group) => ({
        key: group.key,
        label: group.label,
        items: group.items.filter((item) => matches(item.label)).map((item) => ({ item, index: n++ })),
      }))
      .filter((group) => group.items.length > 0);
  });

  const listCount = () => indexed().reduce((total, group) => total + group.items.length, 0);
  const createIndex = () => (props.create ? listCount() : -1);
  const total = () => listCount() + (props.create ? 1 : 0);

  const rowAt = (index: number): { href: string; go?: () => void } | null => {
    if (index === createIndex()) return props.create ?? null;
    for (const group of indexed()) {
      const hit = group.items.find((row) => row.index === index);
      if (hit) return hit.item;
    }
    return null;
  };

  function follow(row: { href: string; go?: () => void }) {
    setOpen(false);
    if (row.go) row.go();
    else window.location.assign(row.href);
  }

  /** A modified click is the browser's to handle: it opens a tab, or saves. */
  const passthrough = (e: MouseEvent) =>
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (total() === 0 ? 0 : Math.min(i + 1, total() - 1)));
      reveal(selected());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
      reveal(selected());
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rowAt(selected());
      if (row) follow(row);
    }
  }

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setSelected(0);
        }
      }}
      placement="bottom-start"
      gutter={8}
    >
      {/*
        The anchor is the ROW, not the chevron. The reference aligns the
        popover's left edge with the left edge of the trigger row, so a popover
        hung off the chevron would sit most of a row to the right of where it
        belongs.
      */}
      <PopoverAnchor class={props.anchorClass}>{props.children}</PopoverAnchor>

      <PopoverContent
        class="h-full w-full rounded-none p-0 shadow-modal md:h-auto md:w-96 md:rounded-xl"
        // Kobalte would focus the first tabbable child, which is the first row.
        // The reference focuses the search field, and that is the difference
        // between typing to filter and typing into nothing.
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault();
          input?.focus();
        }}
      >
        <div class="flex h-[45px] items-center gap-2.5 border-b py-0.5">
          <input
            ref={input}
            type="text"
            class="h-10 min-w-0 flex-1 bg-transparent px-4 text-body outline-none placeholder:text-muted-foreground"
            placeholder={props.placeholder}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          {/* A button, not a decoration: the chip is the only thing on screen
              that says how to close this, so it had better be pressable. */}
          <PopoverClose class="flex h-10 w-12 shrink-0 items-center justify-center">
            <Kbd>Esc</Kbd>
          </PopoverClose>
        </div>

        <div ref={list} class="max-h-[300px] overflow-y-auto overscroll-contain p-0.5">
          <Show
            when={listCount() > 0}
            fallback={
              // A popover gets a line; a page gets the tile and the copy. The
              // reference is explicit about the two being different.
              <div class="grid min-h-[196px] place-items-center px-4 text-body text-muted-foreground">
                {props.emptyLabel}
              </div>
            }
          >
            {/*
              ONE container, and no group headings. The reference's switcher
              list is flat: no "Workspaces", no "Recent", no rule between
              blocks. `ScopeGroup` survives as the input shape because it is how
              a caller thinks about its rows, but a group paints nothing.
            */}
            <div class="flex flex-col p-1">
              <For each={indexed()}>
                {(group) => (
                  <For each={group.items}>
                    {(row) => (
                      <a
                        href={row.item.href}
                        data-index={row.index}
                        data-selected={selected() === row.index ? "" : undefined}
                        onMouseEnter={() => setSelected(row.index)}
                        onClick={(e) => {
                          if (passthrough(e)) return;
                          e.preventDefault();
                          follow(row.item);
                        }}
                        class={cn(
                          "flex h-popover-row items-center gap-3 rounded-md px-2 text-body outline-none",
                          selected() === row.index && "bg-accent",
                          // The current row is not marked with a check: the
                          // reference carries no hint, no chevron and no
                          // metadata on a switcher row. It reads one step
                          // stronger and that is the whole signal.
                          row.item.current ? "text-foreground" : "text-foreground/90"
                        )}
                      >
                        <span class="flex size-5 shrink-0 items-center justify-center">
                          {row.item.media()}
                        </span>
                        <span class="min-w-0 flex-1 truncate">{row.item.label}</span>
                      </a>
                    )}
                  </For>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={props.create}>
          {(create) => (
            <div class="border-t p-1.5">
              <a
                href={create().href}
                data-index={createIndex()}
                data-selected={selected() === createIndex() ? "" : undefined}
                onMouseEnter={() => setSelected(createIndex())}
                onClick={(e) => {
                  if (passthrough(e)) return;
                  e.preventDefault();
                  follow(create());
                }}
                class={cn(
                  "flex items-center gap-3 rounded-md px-2 outline-none",
                  // Two measured shapes, not one: a single-line create row is a
                  // 36px list row, and only the two-line form spends the 58.
                  create().description ? "py-2.5" : "h-popover-row",
                  selected() === createIndex() && "bg-accent"
                )}
              >
                <span class="flex size-5 shrink-0 items-center justify-center">
                  <Plus class="size-4 text-muted-foreground" />
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate text-body font-medium">{create().label}</span>
                  <Show when={create().description}>
                    {(description) => (
                      <span class="truncate text-small text-muted-foreground">
                        {description()}
                      </span>
                    )}
                  </Show>
                </span>
              </a>
            </div>
          )}
        </Show>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chevron half of a split scope trigger.
 *
 * 28x32 and its own button, because clicking the name navigates and clicking
 * this opens the switcher. One control doing both is what makes a scope row
 * feel slow: every jump to the thing you are already looking at costs a menu.
 */
function ScopeChevron(props: { label: string; children: JSX.Element }) {
  return (
    <PopoverTrigger
      as="button"
      type="button"
      aria-label={props.label}
      class={cn(
        "flex h-8 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
        "text-muted-foreground transition-colors hover:text-foreground",
        "focus-ring outline-none"
      )}
    >
      {props.children}
    </PopoverTrigger>
  );
}

/**
 * Scope segment 1: the workspace, in the sidebar header.
 *
 * A 40px row inside a 48px band, 20px round avatar, name at 14/500. Collapsed,
 * the label and the chevron go and the avatar alone remains, which is why the
 * avatar is first.
 */
function WorkspaceSwitcher(props: { session: SessionInfo; workspace: WorkspaceSummary }) {
  const { state } = useSidebar();
  const i18n = useI18n();

  const groups = (): ScopeGroup[] => [
    {
      key: "workspaces",
      label: i18n.t("shell.workspaces"),
      items: props.session.workspaces.map((ws) => ({
        key: ws.id,
        label: ws.name,
        media: () => <WorkspaceLogo workspace={ws} class="size-4" />,
        current: ws.slug === props.workspace.slug,
        // A full load on purpose, and unchanged from before this port: the
        // session, the project list and the member count all belong to the
        // workspace, and every one of them is loader data one level above here.
        href: `/w/${ws.slug}`,
      })),
    },
  ];

  return (
    <ScopeSwitcher
      anchorClass="flex h-12 items-center px-2 py-1"
      placeholder={i18n.t("shell.find_workspace")}
      emptyLabel={i18n.t("shell.no_workspaces")}
      groups={groups()}
      create={{
        label: i18n.t("shell.new_workspace"),
        description: i18n.t("shell.new_workspace_hint"),
        href: "/new",
      }}
    >
      <div class="flex h-10 min-w-0 flex-1 items-center rounded-md">
        <Link
          to="/w/$wslug"
          params={{ wslug: props.workspace.slug }}
          class={cn(
            "focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-1 pl-2.5",
            "text-body font-medium outline-none transition-colors hover:bg-sidebar-accent"
          )}
        >
          <WorkspaceLogo workspace={props.workspace} />
          <SidebarLabel class="truncate">{props.workspace.name}</SidebarLabel>
        </Link>
        <Show when={state() === "expanded"}>
          <ScopeChevron label={i18n.t("shell.switch_workspace")}>
            <ChevronDown class="size-4" />
          </ScopeChevron>
        </Show>
      </div>
    </ScopeSwitcher>
  );
}

/**
 * Scope segment 2: the project, in the topbar's left cell.
 *
 * Reads "All projects" when no project is open, which is the reference's own
 * wording for the same state -- the segment never disappears, so the left cell
 * never changes width as you move between scopes.
 *
 * The divider and the back control appear on hover and only once a project is
 * open. They are the way out of project scope, and a permanent button for
 * "leave" next to the name of the thing you are in reads as a close box.
 */
function ProjectSwitcher(props: {
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  project: ProjectSummary | null;
}) {
  const navigate = useNavigate();
  const i18n = useI18n();
  const base = () => `/w/${props.workspace.slug}`;

  const current = () => props.project;

  const groups = (): ScopeGroup[] => [
    {
      key: "projects",
      label: i18n.t("shell.projects"),
      items: props.projects.map((project) => ({
        key: project.id,
        label: project.name,
        media: () => <ProjectLogo name={project.name} />,
        current: project.slug === props.project?.slug,
        href: `${base()}/${project.slug}`,
        // Client-side, unchanged from before this port: everything a project
        // page needs is loaded below the shell, so a full document load here
        // would re-fetch the workspace to show the same sidebar.
        go: () =>
          navigate({
            to: "/w/$wslug/$pslug",
            params: { wslug: props.workspace.slug, pslug: project.slug },
          }),
      })),
    },
  ];

  return (
    <ScopeSwitcher
      anchorClass="group/scope flex min-w-0 max-w-[clamp(30cqw,36cqw,44cqw)] items-center rounded-md"
      placeholder={i18n.t("shell.find_project")}
      emptyLabel={i18n.t("shell.no_projects_yet")}
      groups={groups()}
      create={
        props.workspace.role === "admin"
          ? {
              label: i18n.t("shell.new_project"),
              href: `${base()}/projects/new`,
              go: () =>
                navigate({
                  to: "/w/$wslug/projects/new",
                  params: { wslug: props.workspace.slug },
                }),
            }
          : undefined
      }
    >
      <Show
        when={current()}
        fallback={
          <span class="flex min-w-0 items-center gap-2 py-2 pr-1 pl-2 text-body font-medium text-muted-foreground">
            <span class="truncate capitalize">{i18n.t("shell.all_projects")}</span>
          </span>
        }
      >
        {(project) => (
          <Link
            to="/w/$wslug/$pslug"
            params={{ wslug: props.workspace.slug, pslug: project().slug }}
            class={cn(
              "focus-ring flex min-w-0 items-center gap-2 rounded-md py-2 pr-1 pl-2",
              "text-body font-medium outline-none transition-colors hover:bg-accent"
            )}
          >
            <ProjectLogo name={project().name} />
            <span class="truncate">{project().name}</span>
          </Link>
        )}
      </Show>

      <ScopeChevron label={i18n.t("shell.switch_project")}>
        <ChevronDown class="size-4" />
      </ScopeChevron>

      <Show when={current()}>
        <span
          class={cn(
            "flex items-center opacity-0 transition-opacity",
            "group-hover/scope:opacity-100 focus-within:opacity-100"
          )}
        >
          <span aria-hidden="true" class="mr-1 ml-2 h-6 w-px shrink-0 bg-border" />
          <Link
            to="/w/$wslug"
            params={{ wslug: props.workspace.slug }}
            aria-label={i18n.t("shell.back_to_workspace")}
            title={i18n.t("shell.back_to_workspace")}
            class={cn(
              "focus-ring flex h-8 w-7 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground outline-none"
            )}
          >
            <ChevronLeft class="size-4" />
          </Link>
        </span>
      </Show>
    </ScopeSwitcher>
  );
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

/** One row of the palette. Navigation only for now, so every row is a link. */
interface FindResult {
  key: string;
  title: string;
  subtitle: string;
  media: () => JSX.Element;
  href: string;
  go?: () => void;
}

/**
 * The matched substring, at one weight up.
 *
 * Built by slicing rather than by a regex replace, because a project can be
 * called `C++` or `(draft)`, and escaping the query into a pattern is a step
 * that exists only to undo itself.
 */
function Marked(props: { text: string; query: string }) {
  const trimmed = () => props.query.trim();
  const at = () => {
    const q = trimmed().toLowerCase();
    return q === "" ? -1 : props.text.toLowerCase().indexOf(q);
  };
  const head = () => props.text.slice(0, Math.max(at(), 0));
  const hit = () => props.text.slice(at(), at() + trimmed().length);
  const tail = () => props.text.slice(at() + trimmed().length);

  return (
    <Show when={at() >= 0} fallback={props.text}>
      {head()}
      <strong class="font-medium">{hit()}</strong>
      {tail()}
    </Show>
  );
}

/**
 * Find: the sidebar's search row, and the palette it becomes.
 *
 * Not a centred modal. The reference deleted that one: the row in the sidebar
 * header IS the entry point, it already renders as an input shell, and pressing
 * it expands the same popover geometry the scope switchers use, anchored over
 * the row rather than over the screen.
 *
 * The body is a FIXED height, not a max height. A panel that grows and shrinks
 * per keystroke moves its rows under the pointer while someone is reading them.
 */
function FindPalette(props: {
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  nav: ProjectNav | null;
}) {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;

  const base = () => `/w/${props.workspace.slug}`;

  /**
   * Every destination the shell can reach, flat.
   *
   * Flat on purpose: the reference's palette has no section headings and mixes
   * result kinds in one list, so someone holding Down passes through everything
   * rather than skipping over a heading they cannot select.
   */
  const all = (): FindResult[] => {
    const nav = props.nav;
    const rows: FindResult[] = [
      {
        key: "overview",
        title: i18n.t("shell.overview"),
        subtitle: props.workspace.name,
        media: () => <Gauge class="size-4" />,
        href: base(),
      },
      ...props.projects.map((project) => ({
        key: `project:${project.id}`,
        title: project.name,
        subtitle: i18n.t("shell.projects"),
        media: () => <ProjectLogo name={project.name} />,
        href: `${base()}/${project.slug}`,
        go: () =>
          navigate({
            to: "/w/$wslug/$pslug",
            params: { wslug: props.workspace.slug, pslug: project.slug },
          }),
      })),
    ];

    if (nav) {
      for (const board of nav.dashboards) {
        rows.push({
          key: `board:${board.id}`,
          title: board.name,
          subtitle: `${nav.projectName} / ${i18n.t("shell.boards")}`,
          media: () => <LayoutGrid class="size-4" />,
          href: `${base()}/${nav.projectSlug}/dashboards/${board.slug}`,
        });
      }
      rows.push({
        key: "sources",
        title: i18n.t("shell.sources"),
        subtitle: nav.projectName,
        media: () => <Antenna class="size-4" />,
        href: `${base()}/${nav.projectSlug}/sources`,
      });
    }

    rows.push(
      {
        key: "people",
        title: i18n.t("shell.people"),
        subtitle: props.workspace.name,
        media: () => <Users class="size-4" />,
        href: `${base()}/members`,
      },
      {
        key: "settings",
        title: i18n.t("shell.settings"),
        subtitle: props.workspace.name,
        media: () => <Settings class="size-4" />,
        href: `${base()}/settings`,
      },
      {
        key: "docs",
        title: i18n.t("shell.documentation"),
        subtitle: "firstrun",
        media: () => <BookOpen class="size-4" />,
        href: "/wiki",
      }
    );

    return rows;
  };

  const results = createMemo(() => {
    const q = query().trim().toLowerCase();
    const rows = all();
    if (q === "") return rows;
    return rows.filter(
      (row) => row.title.toLowerCase().includes(q) || row.subtitle.toLowerCase().includes(q)
    );
  });

  const reveal = (index: number) =>
    list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });

  /** A modified click is the browser's to handle: it opens a tab, or saves. */
  const passthrough = (e: MouseEvent) =>
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

  function follow(row: FindResult) {
    setOpen(false);
    if (row.go) row.go();
    else window.location.assign(row.href);
  }

  function onKeyDown(e: KeyboardEvent) {
    const rows = results();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (rows.length === 0 ? 0 : Math.min(i + 1, rows.length - 1)));
      reveal(selected());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
      reveal(selected());
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[selected()];
      if (row) follow(row);
    }
  }

  /**
   * The shortcut the row advertises.
   *
   * Ignored while a field has focus, because the character is also a character:
   * a shortcut that eats a slash out of a URL somebody is pasting is worse than
   * no shortcut at all.
   */
  onMount(() => {
    const onWindowKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onWindowKey);
    onCleanup(() => window.removeEventListener("keydown", onWindowKey));
  });

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setSelected(0);
        }
      }}
      placement="bottom-start"
      gutter={2}
    >
      <PopoverAnchor class="px-2">
        {/*
          The row renders as an input shell rather than as a button, because
          that is what it becomes: pressing it does not open a dialog somewhere
          else on the screen, it expands this row in place.
        */}
        <PopoverTrigger
          as="button"
          type="button"
          class={cn(
            "focus-ring flex h-9 w-full cursor-pointer items-center rounded-md pr-2",
            "bg-card text-body text-muted-foreground shadow-xs outline-none",
            "transition-colors hover:text-foreground"
          )}
        >
          <span class="flex size-9 shrink-0 items-center justify-center">
            <Search class="size-4" />
          </span>
          {/* Collapsed, the row is the icon square alone, the same way every
              other row in this column collapses. The shortcut still opens it,
              which is why the component stays mounted rather than the row being
              conditional on the state. */}
          <Show when={state() === "expanded"}>
            <span class="min-w-0 flex-1 truncate text-left">{i18n.t("shell.find")}</span>
            <Kbd>/</Kbd>
          </Show>
        </PopoverTrigger>
      </PopoverAnchor>

      <PopoverContent
        class="h-full w-full rounded-none p-0 shadow-modal md:h-auto md:w-96 md:rounded-xl"
        onOpenAutoFocus={(e: Event) => {
          e.preventDefault();
          input?.focus();
        }}
      >
        <div class="flex h-[49px] items-center border-b">
          <span class="flex size-12 shrink-0 items-center justify-center text-muted-foreground">
            <Search class="size-4" />
          </span>
          <input
            ref={input}
            type="text"
            class={cn(
              "h-12 min-w-0 flex-1 bg-transparent pr-4 text-body outline-none",
              "placeholder:text-muted-foreground"
            )}
            placeholder={i18n.t("shell.find_placeholder")}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <PopoverClose class="flex h-12 w-12 shrink-0 items-center justify-center">
            <Kbd>Esc</Kbd>
          </PopoverClose>
        </div>

        {/* 296px, fixed. See the note on the component. */}
        <div ref={list} class="h-[18.5rem] overflow-y-auto overscroll-contain">
          <Show
            when={results().length > 0}
            fallback={
              <div class="grid h-full place-items-center px-4 text-body text-muted-foreground">
                {i18n.t("shell.no_results")}
              </div>
            }
          >
            <div class="flex flex-col p-1">
              <For each={results()}>
                {(row, index) => (
                  <a
                    href={row.href}
                    data-index={index()}
                    data-selected={selected() === index() ? "" : undefined}
                    onMouseEnter={() => setSelected(index())}
                    onClick={(e) => {
                      if (passthrough(e)) return;
                      e.preventDefault();
                      follow(row);
                    }}
                    class={cn(
                      "flex h-12 items-center rounded-md outline-none",
                      selected() === index() && "bg-accent"
                    )}
                  >
                    <span class="flex w-11 shrink-0 items-center justify-center text-muted-foreground">
                      {row.media()}
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col pr-3">
                      <span class="truncate text-label-13 text-foreground">
                        <Marked text={row.title} query={query()} />
                      </span>
                      <span class="truncate text-label-13 text-muted-foreground">
                        {row.subtitle}
                      </span>
                    </span>
                  </a>
                )}
              </For>
            </div>
          </Show>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The centred breadcrumb
// ---------------------------------------------------------------------------

/**
 * The page, as an icon and a title.
 *
 * NOT the scope. The two switchers already say which workspace and which
 * project, in two different regions, and a third statement of the same fact in
 * the middle of the topbar is the thing the reference deliberately removed.
 *
 * Derived from the path rather than published by each route, because a route
 * that forgets to publish leaves a hole in the middle of the chrome, and the
 * only page whose title is not a constant is a board -- which the sidebar's own
 * nav data already knows.
 */
function pageIdentity(
  path: string,
  nav: ProjectNav | null,
  t: (key: never) => string
): { icon: Component<{ class?: string }>; title: string } {
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean);
  const label = (key: string) => t(key as never);

  if (seg[0] === "wiki") return { icon: BookOpen, title: label("shell.documentation") };

  if (seg[0] === "w") {
    if (seg.length <= 2) return { icon: LayoutGrid, title: label("shell.projects") };
    if (seg[2] === "members") return { icon: Users, title: label("shell.people") };
    if (seg[2] === "settings") return { icon: Settings, title: label("shell.settings") };
    if (seg[2] === "projects") return { icon: Plus, title: label("shell.new_project") };

    // Project scope from here down.
    if (seg.length === 3) return { icon: LayoutGrid, title: label("shell.overview") };
    if (seg[3] === "sources") return { icon: Antenna, title: label("shell.sources") };
    if (seg[3] === "settings") return { icon: Settings, title: label("shell.settings") };
    if (seg[3] === "dashboards") {
      if (seg[4] === "new" || seg.length === 4)
        return { icon: Plus, title: label("shell.new_board") };
      const board = nav?.dashboards.find((d) => d.slug === seg[4]);
      return { icon: Gauge, title: board?.name ?? label("shell.boards") };
    }
  }

  return { icon: LayoutGrid, title: nav?.projectName ?? label("shell.overview") };
}

function PageBreadcrumb(props: { path: string }) {
  const i18n = useI18n();
  const { nav } = useProjectNav();
  const page = () => pageIdentity(props.path, nav(), i18n.t as (key: never) => string);

  return (
    <nav
      aria-label={i18n.t("shell.breadcrumb")}
      class="flex min-w-0 items-center justify-center gap-0.5 text-body"
    >
      {/*
        The icon and the slash appear only once the page's own heading has
        scrolled out of view, which is what stops a page saying its title twice
        at rest. The state is an attribute on the document element, set by
        `page-header.tsx` from an observer on its own heading, and the rule that
        reads it lives in `styles.css`: a class rather than a signal, because
        the two ends of it are in different subtrees and a context would make
        every page depend on the shell to render a heading.
      */}
      <span class="route-title-icons hidden shrink-0 items-center gap-2 pr-2.5 md:flex">
        <span class="flex size-6 items-center justify-center text-muted-foreground">
          {(() => {
            const Icon = page().icon;
            return <Icon class="size-4" />;
          })()}
        </span>
        {/* The slash is drawn, not typed: a text slash inherits the label's
            colour and weight, and the separator is meant to sit well below
            both. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          class="size-4 shrink-0 text-border"
          fill="none"
        >
          <path d="M4.5 13.5L11.5 2.5" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </span>
      <span class="truncate font-medium tracking-snug text-foreground">{page().title}</span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Contextual navigation
// ---------------------------------------------------------------------------

/**
 * The boards of the open project, as sidebar rows.
 *
 * WHERE BOARDS GO WAS A GENUINE CHOICE, and this is the one that was made:
 * boards are contextual navigation under project scope, so they belong in the
 * sidebar next to Sources. `docs/vercel-structure.md` lists three shapes for
 * this (rows here, a third topbar scope segment, or the project's index page)
 * and says the reference cannot settle it, because the reference has no third
 * scope level. The reason for this one is that the sidebar holds ALL contextual
 * nav in this port; splitting boards out into a second mechanism would mean two
 * places to look. It is worth revisiting if a project ever holds enough boards
 * to push Sources and Settings below the fold, which is the known cost.
 *
 * The tab strip these rows replaced owned rename, duplicate, delete and
 * reorder. All four moved here rather than being dropped: the strip was the
 * only place to reorder a board from a keyboard, and Alt+Arrow is the only
 * reason that was true.
 */
function BoardRows(props: { workspaceSlug: string; nav: ProjectNav }) {
  const router = useRouter();
  const navigate = useNavigate();
  const i18n = useI18n();

  const [order, setOrder] = createSignal<string[] | null>(null);
  const [dragging, setDragging] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const canEdit = () => props.nav.role === "admin";
  const workspace = () => props.workspaceSlug;
  const project = () => props.nav.projectSlug;

  /** Server order, unless a drag in progress has proposed a different one. */
  const boards = (): DashboardSummary[] => {
    const proposed = order();
    if (!proposed) return props.nav.dashboards;
    const byId = new Map(props.nav.dashboards.map((d) => [d.id, d]));
    const moved = proposed.map((id) => byId.get(id)).filter((d): d is DashboardSummary => !!d);
    return moved.length === props.nav.dashboards.length ? moved : props.nav.dashboards;
  };

  function propose(id: string, targetId: string) {
    if (id === targetId) return;
    const ids = boards().map((d) => d.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setOrder(ids);
  }

  // Alt+Arrow can outrun the round trip. One in flight at a time, and the
  // request carries the whole order, so the last one to leave is authoritative.
  let saving = false;

  async function commitOrder() {
    const ids = order();
    setDragging(null);
    if (!ids || saving) return;
    if (ids.join() === props.nav.dashboards.map((d) => d.id).join()) {
      setOrder(null);
      return;
    }
    saving = true;
    try {
      const result = await reorderDashboardsFn({
        data: { workspace: workspace(), project: project(), ids },
      });
      if (!result.ok) toast.error(result.error);
      await router.invalidate();
      setOrder(null);
    } finally {
      saving = false;
    }
  }

  /** Alt+Arrow moves a board one place, then saves. Same path as a drop. */
  function nudge(id: string, step: -1 | 1) {
    const ids = boards().map((d) => d.id);
    const from = ids.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setOrder(ids);
    void commitOrder();
  }

  function beginRename(board: DashboardSummary) {
    setDraft(board.name);
    setEditing(board.id);
  }

  /**
   * Renaming happens in the row itself.
   *
   * A dialog for one text field is a whole layer of chrome asking a question
   * the label was already showing you the answer to -- and it hid the row it
   * was about behind an overlay while you retyped it. Enter and blur commit,
   * Escape abandons; nothing is saved until one of those three.
   */
  async function commitRename(board: DashboardSummary) {
    if (editing() !== board.id) return;
    const name = draft().trim();
    setEditing(null);
    if (!name || name === board.name) return;

    // Read before the round trip. Renaming re-slugs, so once the board is
    // renamed the slug in the URL names nothing and this comparison would be
    // asking about the wrong board.
    const wasOpen = props.nav.activeSlug === board.slug;

    setBusy(true);
    const result = await renameDashboardFn({
      data: { workspace: workspace(), project: project(), dashboardId: board.id, name },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await router.invalidate();
    // The slug is derived from the name, so the old one in the URL now points
    // at nothing. Follow it rather than leaving a link that 404s on reload --
    // and say so, because the person who just shared that link cannot see it.
    if (wasOpen) {
      navigate({
        to: "/w/$wslug/$pslug/dashboards/$dslug",
        params: { wslug: workspace(), pslug: project(), dslug: result.slug },
      });
    }
    if (result.slug !== board.slug) {
      toast.success(
        `Renamed. Its address is now /dashboards/${result.slug}, so the old link stops resolving.`
      );
    }
  }

  /**
   * Duplicate: one call.
   *
   * This used to read the source board, create a blank one and write the layout
   * into it -- three round trips, and a failure between the last two left an
   * empty board named after the one somebody meant to copy. The server does the
   * copy in a transaction now, so it either exists complete or not at all.
   */
  async function duplicate(board: DashboardSummary) {
    setBusy(true);
    try {
      const created = await duplicateDashboardFn({
        data: { workspace: workspace(), project: project(), dashboardId: board.id },
      });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      await router.invalidate();
      navigate({
        to: "/w/$wslug/$pslug/dashboards/$dslug",
        params: { wslug: workspace(), pslug: project(), dslug: created.slug },
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(board: DashboardSummary) {
    const wasOpen = props.nav.activeSlug === board.slug;
    const result = await deleteDashboardFn({
      data: { workspace: workspace(), project: project(), dashboardId: board.id },
    });
    // The server refuses to delete the last board. The option stays visible and
    // says why, because a menu item that is missing teaches nothing.
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await router.invalidate();
    if (wasOpen) {
      navigate({
        to: "/w/$wslug/$pslug",
        params: { wslug: workspace(), pslug: project() },
      });
    }
  }

  return (
    <For each={boards()}>
      {(board) => {
        const active = () => props.nav.activeSlug === board.slug;
        const renaming = () => editing() === board.id;
        return (
          <SidebarMenuItem
            class={cn("group/board", dragging() === board.id && "opacity-40")}
            // Dragging is off while the label is an input, or selecting text
            // inside it starts a row drag instead.
            draggable={canEdit() && !renaming()}
            onDragStart={(e: DragEvent) => {
              setDragging(board.id);
              e.dataTransfer?.setData("text/plain", board.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e: DragEvent) => {
              if (!dragging()) return;
              e.preventDefault();
              propose(dragging()!, board.id);
            }}
            // Only `dragend` commits. It fires whether the drop landed on a row
            // or in the gutter, so committing from `drop` as well would post the
            // same order twice.
            onDrop={(e: DragEvent) => e.preventDefault()}
            onDragEnd={() => void commitOrder()}
            onKeyDown={(e: KeyboardEvent) => {
              if (!canEdit() || !e.altKey || renaming()) return;
              if (e.key === "ArrowUp") {
                e.preventDefault();
                nudge(board.id, -1);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                nudge(board.id, 1);
              }
            }}
          >
            <Show
              when={renaming()}
              fallback={
                <SidebarMenuButton
                  as={Link}
                  to="/w/$wslug/$pslug/dashboards/$dslug"
                  params={{ wslug: workspace(), pslug: project(), dslug: board.slug }}
                  tooltip={board.name}
                  isActive={active()}
                  title={canEdit() ? i18n.t("shell.reorder_hint") : undefined}
                  onDblClick={(e: MouseEvent) => {
                    if (!canEdit()) return;
                    e.preventDefault();
                    beginRename(board);
                  }}
                >
                  <Gauge />
                  <SidebarLabel>{board.name}</SidebarLabel>
                </SidebarMenuButton>
              }
            >
              {/* 32px plus 2px of margin top and bottom is exactly the 36px the
                  row occupies, so the list does not twitch when editing starts. */}
              <Input
                class="my-0.5 h-8 w-full px-2 py-0 text-body shadow-none"
                aria-label={`Rename ${board.name}`}
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitRename(board);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
                // `commitRename` is a no-op once `editing` has moved on, so
                // Escape-then-blur and Enter-then-blur each save once.
                onBlur={() => void commitRename(board)}
                // The dropdown restores focus to its trigger as it closes; a
                // frame later is after that, and after Solid has inserted this
                // input.
                ref={(el) => {
                  requestAnimationFrame(() => {
                    el.focus();
                    el.select();
                  });
                }}
              />
            </Show>

            <Show when={canEdit() && !renaming()}>
              <BoardActions
                board={board}
                busy={busy()}
                onRename={() => beginRename(board)}
                onDuplicate={() => void duplicate(board)}
                onDelete={() => remove(board)}
              />
            </Show>
          </SidebarMenuItem>
        );
      }}
    </For>
  );
}

/**
 * The per-board menu, and the confirmation it opens.
 *
 * The confirmation is a sibling of the menu rather than an item inside it. A
 * dropdown unmounts its contents when it closes, and selecting "Delete" is what
 * closes it -- a dialog mounted in there would be torn down in the same frame it
 * was asked to open. The menu item reaches the trigger through a ref instead,
 * on the next tick so the menu has finished restoring focus before the dialog
 * takes it.
 */
function BoardActions(props: {
  board: DashboardSummary;
  busy: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const i18n = useI18n();
  const { state } = useSidebar();
  let confirmTrigger: HTMLButtonElement | undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          as="button"
          aria-label={i18n.t("shell.board_options", { name: props.board.name })}
          class={cn(
            "absolute top-1/2 right-1 -translate-y-1/2 cursor-pointer rounded-sm p-1",
            "text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground",
            "focus-visible:opacity-100 group-hover/board:opacity-100 data-[expanded]:opacity-100",
            // There is no room for it beside a 36px icon, and no hover target
            // that is not the row itself.
            state() === "collapsed" && "hidden"
          )}
        >
          <Ellipsis class="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-40">
          {/* Same next-tick dance as Delete: the menu restores focus to its
              trigger on close, which would take it straight back off the input
              the rename is about to open. */}
          <DropdownMenuItem class="gap-2" onSelect={() => setTimeout(props.onRename, 0)}>
            <Pencil class="size-4" />
            {i18n.t("common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2" disabled={props.busy} onSelect={props.onDuplicate}>
            <Copy class="size-4" />
            {i18n.t("shell.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="gap-2 text-destructive"
            onSelect={() => setTimeout(() => confirmTrigger?.click(), 0)}
          >
            <Trash2 class="size-4" />
            {i18n.t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        The one overlay in this list that earns it. Deleting a board is
        irreversible, and a confirmation you can navigate away from -- or leave
        open in another tab -- is not a confirmation.
      */}
      <ConfirmDelete
        trigger={
          <button ref={confirmTrigger} type="button" tabindex={-1} class="sr-only">
            {i18n.t("shell.delete_board_named", { name: props.board.name })}
          </button>
        }
        title={i18n.t("shell.delete_board_title", { name: props.board.name })}
        description={i18n.t("shell.delete_board_description")}
        actionLabel={i18n.t("shell.delete_board")}
        onConfirm={props.onDelete}
      />
    </>
  );
}

/**
 * The root nav pane: three groups, two rules, and the same SHAPE at both scopes.
 *
 * The reference's list does not change shape when scope narrows -- same groups,
 * same order, only the hrefs move -- and the first item renames rather than
 * disappearing, which is what keeps the row count stable. Ours matches that as
 * far as our routes allow: we have no workspace-wide view of sources, so the
 * middle group is boards-and-sources at project scope and people at workspace
 * scope rather than the same two rows twice.
 */
function RootNav(props: {
  workspace: WorkspaceSummary;
  project: ProjectSummary | null;
  path: string;
}) {
  const i18n = useI18n();
  const { nav } = useProjectNav();
  const base = () => `/w/${props.workspace.slug}`;

  // The scope comes from the PATH, and the published nav only fills the scope
  // in. The project route publishes itself from an effect, which does not run
  // during SSR, so a sidebar that decided its shape from the published value
  // would render at workspace scope on the server and snap to project scope on
  // hydration -- on every project page, on every load.
  const boards = () => (nav()?.projectSlug === props.project?.slug ? nav() : null);

  const isActive = (href: string, exact = false) =>
    exact ? props.path === href : props.path === href || props.path.startsWith(href + "/");

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <Show
            when={props.project}
            fallback={
              <SidebarMenuItem>
                <SidebarMenuButton
                  as={Link}
                  to="/w/$wslug"
                  params={{ wslug: props.workspace.slug }}
                  tooltip={i18n.t("shell.projects")}
                  isActive={isActive(base(), true)}
                >
                  <LayoutGrid />
                  <SidebarLabel>{i18n.t("shell.projects")}</SidebarLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            }
          >
            {(project) => (
              <>
                {/*
                  Item 1 RENAMES rather than disappearing when the scope
                  narrows: Projects at workspace scope, Overview at project
                  scope. That is what keeps the row count -- and with it every
                  row's position -- stable across the switch.
                */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    as={Link}
                    to="/w/$wslug/$pslug"
                    params={{ wslug: props.workspace.slug, pslug: project().slug }}
                    tooltip={i18n.t("shell.overview")}
                    isActive={isActive(`${base()}/${project().slug}`, true)}
                  >
                    <LayoutGrid />
                    <SidebarLabel>{i18n.t("shell.overview")}</SidebarLabel>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <Show when={boards()}>
                  {(open) => <BoardRows workspaceSlug={props.workspace.slug} nav={open()} />}
                </Show>

                <Show when={boards()?.role === "admin"}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      as={Link}
                      to="/w/$wslug/$pslug/dashboards/new"
                      params={{ wslug: props.workspace.slug, pslug: project().slug }}
                      tooltip={i18n.t("shell.new_board")}
                      isActive={isActive(`${base()}/${project().slug}/dashboards/new`)}
                    >
                      <Plus />
                      <SidebarLabel>{i18n.t("shell.new_board")}</SidebarLabel>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Show>
              </>
            )}
          </Show>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarMenu>
          <Show
            when={props.project}
            fallback={
              <SidebarMenuItem>
                <SidebarMenuButton
                  as={Link}
                  to="/w/$wslug/members"
                  params={{ wslug: props.workspace.slug }}
                  tooltip={i18n.t("shell.people")}
                  isActive={isActive(`${base()}/members`)}
                >
                  <Users />
                  <SidebarLabel>{i18n.t("shell.people")}</SidebarLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            }
          >
            {(project) => (
              <SidebarMenuItem>
                <SidebarMenuButton
                  as={Link}
                  to="/w/$wslug/$pslug/sources"
                  params={{ wslug: props.workspace.slug, pslug: project().slug }}
                  tooltip={i18n.t("shell.sources")}
                  isActive={isActive(`${base()}/${project().slug}/sources`)}
                >
                  <Antenna />
                  <SidebarLabel>{i18n.t("shell.sources")}</SidebarLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </Show>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarMenu>
          <Show
            when={props.project}
            fallback={
              <Show when={props.workspace.role === "admin"}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    as={Link}
                    to="/w/$wslug/settings"
                    params={{ wslug: props.workspace.slug }}
                    tooltip={i18n.t("shell.settings")}
                    isActive={isActive(`${base()}/settings`)}
                  >
                    <Settings />
                    <SidebarLabel>{i18n.t("shell.settings")}</SidebarLabel>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Show>
            }
          >
            {(project) => (
              <SidebarMenuItem>
                <SidebarMenuButton
                  as={Link}
                  to="/w/$wslug/$pslug/settings"
                  params={{ wslug: props.workspace.slug, pslug: project().slug }}
                  tooltip={i18n.t("shell.settings")}
                  isActive={isActive(`${base()}/${project().slug}/settings`)}
                >
                  <Settings />
                  <SidebarLabel>{i18n.t("shell.settings")}</SidebarLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </Show>

          {/*
            The wiki is not part of this workspace -- it is the same pages for
            everyone and reads fine with no session at all -- but it is still an
            account-level destination, which is the group the reference puts
            Support and Settings in.
          */}
          <SidebarMenuItem>
            <SidebarMenuButton
              as={Link}
              to="/wiki"
              tooltip={i18n.t("shell.documentation")}
              isActive={props.path === "/wiki" || props.path.startsWith("/wiki/")}
            >
              <BookOpen />
              <SidebarLabel>{i18n.t("shell.documentation")}</SidebarLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

/**
 * The settings pane.
 *
 * Settings does NOT get a second nav column beside the content: the one sidebar
 * swaps what it is showing, and the content column narrows to the compact track
 * at the same time. Both halves of that are the reference's mechanism.
 *
 * The routes are thin because our settings are thin -- one page per scope. The
 * sections INSIDE the open page are the rest of the list: the page publishes
 * its anchors through `useSettingsNav` and they are drawn here, under a rule,
 * so the pane names every place a setting can be rather than making a reader
 * scroll the content to find out.
 */
function SettingsNav(props: {
  workspace: WorkspaceSummary;
  project: ProjectSummary | null;
  path: string;
  sections: SettingsSectionLink[];
}) {
  const i18n = useI18n();
  const base = () => `/w/${props.workspace.slug}`;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Show
          when={props.project}
          fallback={
            <>
              <SidebarMenuItem>
                <SidebarSubButton
                  as={Link}
                  to="/w/$wslug/settings"
                  params={{ wslug: props.workspace.slug }}
                  isActive={props.path === `${base()}/settings`}
                >
                  <SidebarLabel>{i18n.t("shell.general")}</SidebarLabel>
                </SidebarSubButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarSubButton
                  as={Link}
                  to="/w/$wslug/members"
                  params={{ wslug: props.workspace.slug }}
                  isActive={props.path === `${base()}/members`}
                >
                  <SidebarLabel>{i18n.t("shell.people")}</SidebarLabel>
                </SidebarSubButton>
              </SidebarMenuItem>
            </>
          }
        >
          {(project) => (
            <SidebarMenuItem>
              <SidebarSubButton
                as={Link}
                to="/w/$wslug/$pslug/settings"
                params={{ wslug: props.workspace.slug, pslug: project().slug }}
                isActive={props.path === `${base()}/${project().slug}/settings`}
              >
                <SidebarLabel>{i18n.t("shell.general")}</SidebarLabel>
              </SidebarSubButton>
            </SidebarMenuItem>
          )}
        </Show>
      </SidebarMenu>

      {/*
        The open page's own sections. An anchor rather than a route, because
        every one of them is already on screen: the shell owns the only scroll
        container, so the browser scrolls that one.
      */}
      <Show when={props.sections.length > 0}>
        <SidebarSeparator />
        <SidebarMenu>
          <For each={props.sections}>
            {(section) => (
              <SidebarMenuItem>
                <SidebarSubButton as="a" href={`#${section.id}`}>
                  <SidebarLabel>{section.label}</SidebarLabel>
                </SidebarSubButton>
              </SidebarMenuItem>
            )}
          </For>
        </SidebarMenu>
      </Show>
    </SidebarGroup>
  );
}

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

export function AppShell(props: AppShellProps) {
  const routerState = useRouterState();
  const i18n = useI18n();
  const path = () => routerState().location.pathname.replace(/\/+$/, "") || "/";
  const [nav, setNav] = createSignal<ProjectNav | null>(null);
  const [sections, setSections] = createSignal<SettingsSectionLink[]>([]);
  const base = () => `/w/${props.workspace.slug}`;

  /**
   * Which project the URL is inside, or none.
   *
   * Matched against the loaded projects rather than parsed out of the path:
   * `/w/acme/members` and `/w/acme/projects/new` have the same shape as a
   * project URL, and only the list can tell them apart.
   */
  const project = () =>
    props.projects.find(
      (p) => path() === `${base()}/${p.slug}` || path().startsWith(`${base()}/${p.slug}/`)
    ) ?? null;

  /** Settings is the one route that pushes a pane and narrows the content. */
  const onSettings = () =>
    /^\/w\/[^/]+(\/[^/]+)?\/settings(\/|$)/.test(path() + "/") ||
    /^\/w\/[^/]+\/members$/.test(path());

  return (
    <ProjectNavCtx.Provider value={{ nav, setNav }}>
      <SettingsNavCtx.Provider value={{ sections, setSections }}>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <WorkspaceSwitcher session={props.session} workspace={props.workspace} />
            {/* The second header row, which is what makes the header the
                measured 92 rather than 52. */}
            <FindPalette workspace={props.workspace} projects={props.projects} nav={nav()} />
          </SidebarHeader>

          <SidebarContent>
            <SidebarPane side="root" active={!onSettings()}>
              <RootNav workspace={props.workspace} project={project()} path={path()} />
            </SidebarPane>

            <SidebarPane side="pushed" active={onSettings()}>
              <SidebarPaneHeader
                title={i18n.t("shell.settings")}
                back={
                  <BackToRoot
                    workspace={props.workspace}
                    project={project()}
                    label={i18n.t("common.back")}
                  />
                }
              />
              <SettingsNav
                workspace={props.workspace}
                project={project()}
                path={path()}
                sections={sections()}
              />
            </SidebarPane>
          </SidebarContent>

          {/*
            The account, in the footer.

            The reference has no avatar and no account control in the topbar at
            all: notifications and the account menu are down here, and help and
            docs are inside the menu. That also frees the topbar's right cell,
            which is what keeps the centred breadcrumb actually centred.
          */}
          {/*
            One control, not two. The reference's footer is an account pill plus
            a notification bell, and we have no notification feed: a bell that
            can never ring is chrome pretending to be a feature. The row is a
            flex row so the second control can drop in beside the pill the day
            there is something for it to say.
          */}
          <SidebarFooter class="flex-row items-center gap-2">
            <UserMenu session={props.session} />
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          {/*
            The topbar. 56px, three columns at 1 / 2 / 1 so the middle cell is
            centred on the pane rather than on whatever the left cell happens to
            be wide, and one device pixel of separation from the content.
          */}
          <header
            class={cn(
              "@container/bar sticky top-0 z-50 grid h-14 shrink-0 items-center gap-2",
              "bg-card md:bg-background",
              "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]",
              hairlineBottom
            )}
          >
            <div class="z-10 flex min-w-0 items-center overflow-hidden pl-4">
              <ExpandSidebar />
              <ProjectSwitcher
                workspace={props.workspace}
                projects={props.projects}
                project={project()}
              />
            </div>

            <PageBreadcrumb path={path()} />

            {/* Reserved. The reference puts one control here and we have none
                yet; the cell stays so the breadcrumb keeps its centre. */}
            <div class="flex items-center justify-self-end gap-1 pr-4" />
          </header>

          {/*
            The only scroll container on the page, and the container QUERY
            context for everything inside it. Container queries rather than
            viewport media queries, because the pane is what the content
            actually has: the sidebar collapsing, or a panel opening beside the
            content, must reflow the page as if the window had changed size.
          */}
          <div class="@container/page min-h-0 flex-1 overflow-y-auto">
            <div
              class={cn(
                "grid",
                onSettings()
                  ? "grid-cols-[minmax(24px,1fr)_minmax(0,914px)_minmax(24px,1fr)]"
                  : "grid-cols-[minmax(24px,1fr)_minmax(0,1620px)_minmax(24px,1fr)]"
              )}
            >
              <div class="col-start-2 min-w-0">{props.children}</div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
      </SettingsNavCtx.Provider>
    </ProjectNavCtx.Provider>
  );
}

/**
 * The topbar's sidebar toggle, and the divider after it.
 *
 * Present below `md`, where the sidebar is a drawer and there is no other way
 * to open it, and above `md` only while the sidebar is collapsed. With the
 * sidebar open the rail on its edge is the affordance, and Ctrl+B works
 * throughout -- a permanent toggle for a panel that is visibly already open is
 * a control whose state you have to read the rest of the screen to know.
 */
function ExpandSidebar() {
  const { state } = useSidebar();
  return (
    <div class={cn("flex items-center", state() === "expanded" && "lg:hidden")}>
      <SidebarTrigger />
      <span aria-hidden="true" class="mr-1 ml-2 h-6 w-px bg-border" />
    </div>
  );
}

/** The settings pane's back chevron. Leaves settings for the workspace root. */
function BackToRoot(props: {
  workspace: WorkspaceSummary;
  project: ProjectSummary | null;
  label: string;
}) {
  return (
    <Show
      when={props.project}
      fallback={
        <Link
          to="/w/$wslug"
          params={{ wslug: props.workspace.slug }}
          aria-label={props.label}
          class="focus-ring flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground"
        >
          <ChevronLeft class="size-4" />
        </Link>
      }
    >
      {(project) => (
        <Link
          to="/w/$wslug/$pslug"
          params={{ wslug: props.workspace.slug, pslug: project().slug }}
          aria-label={props.label}
          class="focus-ring flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground"
        >
          <ChevronLeft class="size-4" />
        </Link>
      )}
    </Show>
  );
}

/**
 * The signed-in user, in the sidebar footer.
 *
 * Shows the display name, falling back to the login when GitHub has no name on
 * file. The avatar is always present -- the image when there is one, initials
 * when there is not -- so the corner never has a hole in it.
 */
export function UserMenu(props: { session: SessionInfo }) {
  const user = () => props.session.user!;
  const displayName = () => user().name?.trim() || user().login;
  const i18n = useI18n();
  const { state } = useSidebar();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        as="button"
        class={cn(
          "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pr-2 pl-2.5",
          "text-body text-left transition-colors hover:bg-sidebar-accent",
          "focus-ring outline-none",
          state() === "collapsed" && "w-9 flex-none justify-center px-0"
        )}
      >
        <Avatar class="size-5 shrink-0">
          <AvatarImage src={user().avatarUrl ?? undefined} alt="" />
          <AvatarFallback class="text-[9px]">{initials(displayName())}</AvatarFallback>
        </Avatar>
        <SidebarLabel class="truncate">{displayName()}</SidebarLabel>
      </DropdownMenuTrigger>

      <DropdownMenuContent class="min-w-52">
        <div class="flex items-center gap-2 px-2 py-1.5">
          <Avatar class="size-8">
            <AvatarImage src={user().avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{initials(displayName())}</AvatarFallback>
          </Avatar>
          <div class="min-w-0">
            <div class="truncate text-body font-medium">{displayName()}</div>
            <div class="truncate text-small text-muted-foreground">@{user().login}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        {/*
          The language lives here rather than in workspace settings because it
          belongs to the person, not to the workspace: the same account reading
          two workspaces reads both in the language they picked, and a reader
          with no admin rights anywhere still gets to choose.
        */}
        <LocaleSwitcher />
        <DropdownMenuSeparator />
        <DropdownMenuItem as="a" href="/new" class="gap-2">
          <Plus class="size-4" />
          {i18n.t("shell.new_workspace")}
        </DropdownMenuItem>
        <DropdownMenuItem as="a" href="/auth/logout" class="gap-2">
          <LogOut class="size-4" />
          {i18n.t("shell.sign_out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
