import Antenna from "lucide-solid/icons/antenna";
import Building from "lucide-solid/icons/building-2";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import LogIn from "lucide-solid/icons/log-in";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Wand from "lucide-solid/icons/wand-sparkles";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { cn } from "../../lib/cn.js";
import type { DocsSource } from "../../lib/api.js";
import { useI18n } from "../../lib/i18n/index.js";
import {
  Button,
  buttonVariants,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from "../ui/index.js";

/**
 * Who this documentation is currently written for.
 *
 * It lives in the documentation chrome rather than on a page because the selection has
 * to be reachable while the reader is halfway down an install guide -- on one
 * page it would be a setting they have to navigate back to.
 *
 * ## It lives in the topbar, beside the page, and not in the navigation
 *
 * It was briefly a row in the sidebar, in the slot the app fills with Find.
 * That was wrong twice over. The picker is not navigation -- it does not change
 * which page you are on, it changes what the page in front of you says -- and
 * the column collapses to a 52px strip, where a row is a square with no label
 * and cannot show which source is selected. A control whose entire job is to
 * tell you what the snippets are written against has to be able to say so.
 *
 * ## This is the only place the documentation says "placeholder"
 *
 * A reader who copies `fr_web_xxxxxxxxxxxxxxxx`, pastes it, deploys, and waits
 * for events gets no error anywhere: the tag posts, the server rejects an
 * unknown key, and the dashboard stays empty. That has to be said -- but it is
 * one fact about the whole page, not a fact about each snippet, and repeating
 * it under every code block on a guide with eight of them turned the warning
 * into wallpaper. It is said once, here, beside the control that fixes it, and
 * it disappears the moment a source is picked.
 *
 * ## A tree, because the names only mean something in their path
 *
 * Two projects both have a source called "Website", and "Website" on its own
 * picks neither. Workspace > project > source is the hierarchy the rest of the
 * app is built on, so the picker shows it rather than flattening it into one
 * line per source and hoping the label fits. The workspace level is drawn only
 * when there is more than one: a tree with a single root is chrome.
 *
 * The search box is what makes the tree usable once somebody has thirty
 * sources -- it matches on every level of the path, so typing a project name
 * narrows to that project's sources, and while there is a query everything is
 * expanded because a hidden match is a match nobody found.
 */

/**
 * One mark for every source, because there is one kind of source.
 *
 * There used to be five, chosen off the source's surface: a globe, a monitor, a
 * phone, a server rack, a box. Together they read as a taxonomy, and the
 * taxonomy is gone. A source is one thing that writes events, and the mark says
 * only that this row is one of those.
 */
function SourceIcon(props: { class?: string }) {
  return <Antenna class={props.class} />;
}

interface ProjectNode {
  key: string;
  name: string;
  sources: DocsSource[];
}

interface WorkspaceNode {
  key: string;
  name: string;
  projects: ProjectNode[];
}

/**
 * Group a flat source list into the hierarchy it came from.
 *
 * Insertion order is the display order, so the caller sorts first and this does
 * no sorting of its own -- one place decides what "alphabetical" means.
 */
function groupSources(sources: DocsSource[]): WorkspaceNode[] {
  const workspaces = new Map<string, WorkspaceNode>();

  for (const source of sources) {
    let workspace = workspaces.get(source.workspaceSlug);
    if (!workspace) {
      workspace = { key: `w:${source.workspaceSlug}`, name: source.workspaceName, projects: [] };
      workspaces.set(source.workspaceSlug, workspace);
    }

    const projectKey = `p:${source.workspaceSlug}/${source.projectSlug}`;
    let project = workspace.projects.find((candidate) => candidate.key === projectKey);
    if (!project) {
      project = { key: projectKey, name: source.projectName, sources: [] };
      workspace.projects.push(project);
    }

    project.sources.push(source);
  }

  return [...workspaces.values()];
}

/** Everything a query could reasonably be aimed at, in one string. */
const haystack = (source: DocsSource) =>
  `${source.workspaceName} ${source.projectName} ${source.name}`.toLowerCase();

export function SourcePicker(props: {
  sources: DocsSource[];
  signedIn: boolean;
  selected: DocsSource | null;
  onSelect: (source: DocsSource | null) => void;
  class?: string;
}) {
  const i18n = useI18n();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const [active, setActive] = createSignal(0);

  let field: HTMLInputElement | undefined;
  const rows = new Map<string, HTMLButtonElement>();

  const ordered = () =>
    [...props.sources].sort(
      (a, b) =>
        a.workspaceName.localeCompare(b.workspaceName) ||
        a.projectName.localeCompare(b.projectName) ||
        a.name.localeCompare(b.name)
    );

  const searching = () => query().trim().length > 0;
  const showWorkspaces = () => new Set(props.sources.map((s) => s.workspaceSlug)).size > 1;

  const tree = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const matching = needle
      ? ordered().filter((source) => haystack(source).includes(needle))
      : ordered();
    return groupSources(matching);
  });

  // A node the reader collapsed stays collapsed, except while a query is
  // running: a search that leaves its own hits folded away has found nothing as
  // far as the reader is concerned.
  const expanded = (key: string) => searching() || !collapsed().has(key);

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** The rows the arrow keys walk, in the order they are drawn. */
  const flat = createMemo(() => {
    const out: DocsSource[] = [];
    for (const workspace of tree()) {
      if (showWorkspaces() && !expanded(workspace.key)) continue;
      for (const project of workspace.projects) {
        if (!expanded(project.key)) continue;
        out.push(...project.sources);
      }
    }
    return out;
  });

  const indexById = createMemo(() => new Map(flat().map((source, index) => [source.id, index])));

  // A new query is a new list, so the highlight goes back to the top rather
  // than pointing at whatever happens to be in that position now.
  createEffect(() => {
    query();
    setActive(0);
  });

  const move = (delta: number) => {
    const list = flat();
    if (list.length === 0) return;
    const next = (active() + delta + list.length) % list.length;
    setActive(next);
    rows.get(list[next]!.id)?.scrollIntoView({ block: "nearest" });
  };

  const choose = (source: DocsSource | null) => {
    props.onSelect(source);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const target = flat()[active()];
      if (target) {
        event.preventDefault();
        choose(target);
      }
    }
  };

  return (
    <div class={cn("flex min-w-0 items-center", props.class)}>
      <Show when={props.sources.length > 0} fallback={<EmptyPicker signedIn={props.signedIn} />}>
        <Popover
          open={open()}
          onOpenChange={(next) => {
            setOpen(next);
            // The query is a way of getting to a source, not a setting. It
            // resets on close so the next open shows the whole tree.
            if (!next) setQuery("");
          }}
          // Anchored to the trailing edge, because the trigger is at the
          // trailing edge: a 384px panel hung from the left of a control that
          // is 24px from the right of the window opens off the screen.
          placement="bottom-end"
          gutter={8}
        >
          <PopoverTrigger
            as={Button}
            variant="outline"
            size="sm"
            class="min-w-0 max-w-56 gap-1.5"
            aria-label={i18n.t("docs.picker_label")}
          >
            {/*
              The wand is the empty state, and it is the same mark the
              placeholder notice beside it carries: the thing that says "these
              are not real keys" and the control that fixes it read as one idea
              rather than two unrelated bits of chrome.
            */}
            <Show when={props.selected} fallback={<Wand class="size-3.5 shrink-0 opacity-70" />}>
              <SourceIcon class="size-3.5 shrink-0 opacity-70" />
            </Show>
            <span class="truncate">
              {props.selected?.name ?? i18n.t("docs.pick_source")}
            </span>
            <ChevronDown class="size-3.5 shrink-0 opacity-60" />
          </PopoverTrigger>

          {/* 384px, which is the measured switcher popover, and the same panel
              the app's scope switcher opens. A 320px one held the same tree at
              a different width for no reason anybody could name. */}
          <PopoverContent
            class="w-96 p-0"
            // Kobalte focuses the panel itself by default. The search box is
            // the only thing anybody wants to touch first, and typing straight
            // into it is the whole point of having one.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              field?.focus();
            }}
          >
            {/* The measured search header: a 45px band holding a 40px field,
                and a trailing slot for the key that closes the panel. Esc is
                the only way out that costs nothing, and the chip is the only
                place anybody finds out about it. */}
            <div class="flex h-[45px] items-center gap-2.5 border-b py-0.5">
              <div class="relative min-w-0 flex-1">
                <Search class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={field}
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={onKeyDown}
                  placeholder={i18n.t("docs.search_placeholder")}
                  aria-label={i18n.t("docs.search_sources")}
                  class="h-control-lg bg-transparent pr-2 pl-9 shadow-none"
                />
              </div>
              <span class="flex h-control-lg w-12 shrink-0 items-center justify-center">
                <Kbd>Esc</Kbd>
              </span>
            </div>

            <ScrollArea role="tree" aria-label={i18n.t("docs.your_sources")} class="max-h-72 p-1">
              <Show
                when={tree().length > 0}
                fallback={
                  // A popover gets a line; a page gets the tile. The reference
                  // is explicit about the two being different.
                  <div class="grid min-h-[196px] place-items-center px-4 text-body text-muted-foreground">
                    {/* The quotation marks live in the catalogue entry, not
                        here: German writes „…“ and a straight pair in the
                        middle of a German sentence reads as a typo. */}
                    {i18n.t("docs.no_matches", { query: query().trim() })}
                  </div>
                }
              >
                <For each={tree()}>
                  {(workspace) => (
                    <>
                      <Show when={showWorkspaces()}>
                        <BranchRow
                          level={1}
                          label={workspace.name}
                          icon={Building}
                          open={expanded(workspace.key)}
                          onToggle={() => toggle(workspace.key)}
                        />
                      </Show>

                      <Show when={!showWorkspaces() || expanded(workspace.key)}>
                        <div role="group" aria-label={workspace.name}>
                          <For each={workspace.projects}>
                            {(project) => (
                              <>
                                <BranchRow
                                  level={showWorkspaces() ? 2 : 1}
                                  label={project.name}
                                  icon={Folder}
                                  open={expanded(project.key)}
                                  onToggle={() => toggle(project.key)}
                                />

                                <Show when={expanded(project.key)}>
                                  <div role="group" aria-label={project.name}>
                                    <For each={project.sources}>
                                      {(source) => {
                                        const index = () => indexById().get(source.id) ?? -1;
                                        const selected = () => props.selected?.id === source.id;
                                        return (
                                          <button
                                            type="button"
                                            role="treeitem"
                                            aria-level={showWorkspaces() ? 3 : 2}
                                            aria-selected={selected()}
                                            ref={(el) => rows.set(source.id, el)}
                                            onClick={() => choose(source)}
                                            onPointerMove={() => setActive(index())}
                                            class={cn(
                                              "flex h-popover-row w-full cursor-pointer items-center gap-2",
                                              "rounded-md pr-2 text-left text-body transition-colors",
                                              "outline-none",
                                              showWorkspaces() ? "pl-8" : "pl-5",
                                              selected()
                                                ? "font-medium text-accent-foreground"
                                                : "text-muted-foreground",
                                              index() === active()
                                                ? "bg-accent text-accent-foreground"
                                                : "hover:bg-accent hover:text-accent-foreground"
                                            )}
                                          >
                                            {/* No trailing metadata, no
                                                chevron and no keyboard hint:
                                                the reference row carries none
                                                of the three. */}
                                            <SourceIcon class="size-3.5 shrink-0 opacity-70" />
                                            <span class="truncate">{source.name}</span>
                                          </button>
                                        );
                                      }}
                                    </For>
                                  </div>
                                </Show>
                              </>
                            )}
                          </For>
                        </div>
                      </Show>
                    </>
                  )}
                </For>
              </Show>
            </ScrollArea>

            {/*
              Only offered once there is something to undo. With nothing picked
              this row would name the state the reader is already in.
            */}
            <Show when={props.selected}>
              <div class="border-t p-1.5">
                <button
                  type="button"
                  onClick={() => choose(null)}
                  class={cn(
                    "flex h-popover-row w-full cursor-pointer items-center gap-2 rounded-md px-2",
                    "text-left text-body text-muted-foreground transition-colors outline-none",
                    "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Wand class="size-3.5 shrink-0 opacity-70" />
                  {i18n.t("docs.clear_selection")}
                </button>
              </div>
            </Show>
          </PopoverContent>
        </Popover>
      </Show>
    </div>
  );
}

/**
 * A workspace or a project: a label that opens and closes, never a value.
 *
 * Only sources are selectable. A workspace is not something a snippet can be
 * written for, so clicking one folds it rather than half-choosing it.
 */
function BranchRow(props: {
  level: number;
  label: string;
  icon: (iconProps: { class?: string }) => ReturnType<typeof Antenna>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={props.level}
      aria-expanded={props.open}
      onClick={props.onToggle}
      class={cn(
        "flex h-popover-row w-full cursor-pointer items-center gap-1.5 rounded-md pr-2",
        "text-left text-body font-medium text-foreground transition-colors outline-none",
        "hover:bg-accent hover:text-accent-foreground",
        props.level === 1 ? "pl-1" : "pl-4"
      )}
    >
      <ChevronRight
        class={cn("size-3.5 shrink-0 opacity-60 transition-transform", props.open && "rotate-90")}
      />
      {props.icon({ class: "size-3.5 shrink-0 opacity-60" })}
      <span class="truncate">{props.label}</span>
    </button>
  );
}

/**
 * The other half of the story.
 *
 * Two different problems get two different links: somebody with no session
 * needs to sign in, and somebody signed in with no sources needs to make one.
 * Telling both of them the same thing wastes the one line either will read.
 * Never an empty dropdown: a control that opens onto nothing reads as broken.
 */
function EmptyPicker(props: { signedIn: boolean }) {
  const i18n = useI18n();

  // A link rather than a disabled control. A button that cannot be pressed and
  // does not say why is the empty dropdown wearing a different costume.
  return (
    <a
      href={props.signedIn ? "/" : "/login"}
      class={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "min-w-0 max-w-56 gap-1.5 text-muted-foreground"
      )}
    >
      <Show when={props.signedIn} fallback={<LogIn class="size-3.5 shrink-0" />}>
        <Plus class="size-3.5 shrink-0" />
      </Show>
      <span class="truncate">
        {props.signedIn ? i18n.t("docs.add_source_to_fill") : i18n.t("docs.sign_in_to_fill")}
      </span>
    </a>
  );
}

/**
 * The one placeholder notice in the documentation.
 *
 * A reader who copies a placeholder key, pastes it, deploys and waits for
 * events gets no error anywhere: the tag posts, the server rejects an unknown
 * key, and the dashboard stays empty. That has to be said -- once, as a fact
 * about the whole page, and not under each of the eight code blocks on it.
 *
 * Separate from the picker because the two live in different parts of the
 * shell: the control is a row in the sidebar, and this sits in the topbar,
 * where somebody reading the page rather than the navigation will see it. The
 * caller decides when it shows, which is whenever nothing is picked.
 */
export function PlaceholderNotice(props: { class?: string }) {
  const i18n = useI18n();
  return (
    <span class={cn("flex min-w-0 items-center gap-1.5 text-small text-warning", props.class)}>
      <Wand class="size-3.5 shrink-0" />
      <span class="truncate">{i18n.t("docs.placeholder_badge")}</span>
    </span>
  );
}
