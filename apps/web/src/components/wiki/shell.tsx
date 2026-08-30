import { Dialog } from "@kobalte/core/dialog";
import { Link, useRouterState } from "@tanstack/solid-router";
import BookOpen from "lucide-solid/icons/book-open";
import ExternalLink from "lucide-solid/icons/external-link";
import {
  For,
  Show,
  createContext,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import type { Surface } from "@firstrun/schema";
import { cn } from "../../lib/cn.js";
import type { SessionInfo, WikiContext, WikiSource } from "../../lib/api.js";
import { useI18n } from "../../lib/i18n/index.js";
import { createSelectedSource } from "../../lib/selected-source.js";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  ScrollArea,
  SidebarSeparator,
  buttonVariants,
  hairlineBottom,
  hairlineRight,
  initials,
} from "../ui/index.js";
import { OnThisPage } from "./on-this-page.js";
import {
  buildRenderContext,
  sectionLabel,
  sectionedTopics,
  topicBySlug,
  topicTitle,
  type WikiRenderContext,
} from "./registry.js";
import { SourcePicker } from "./source-picker.js";

/**
 * The wiki's own chrome.
 *
 * Deliberately not `AppShell`: that one is built around a workspace, and this
 * has to render for somebody who has never signed in -- an evaluator reading
 * the install guide before they have an account is the main audience, not an
 * edge case. So: a header, a table of contents, and one column of content.
 *
 * The page does not scroll. The document body is fixed to the viewport, and the
 * two things that scroll are the contents and the content column, so the header
 * and the source picker stay on screen the whole way down a guide.
 */

export interface WikiState {
  signedIn: boolean;
  publicOrigin: string;
  sources: Accessor<WikiSource[]>;
  /** The source these pages are currently written for. Null means placeholders. */
  source: Accessor<WikiSource | null>;
  setSource: (source: WikiSource | null) => void;
  clear: () => void;
  /**
   * The values a page substitutes, for a page of the given kind.
   *
   * Call it inside JSX rather than hoisting the result: it reads the selection,
   * so calling it where it is used is what makes a page re-render when the
   * reader picks a different source.
   */
  ctxFor: (kind?: Surface) => WikiRenderContext;
}

const WikiCtx = createContext<WikiState>();

export function useWiki(): WikiState {
  const state = useContext(WikiCtx);
  if (!state) throw new Error("useWiki() outside <WikiShell>");
  return state;
}

export function WikiShell(props: {
  session: SessionInfo;
  context: WikiContext;
  /** `?source=<id>`, if the reader arrived on a link that named one. */
  requestedSourceId?: string | null;
  children: JSX.Element;
}) {
  const i18n = useI18n();
  const sources = () => props.context.sources;
  const selection = createSelectedSource(sources);

  /**
   * A source named in the URL wins over the remembered one, once, on arrival.
   *
   * The in-app source pages link here, and the reader has already said which
   * source they mean by being on its page -- landing them on a generic guide
   * throws that away and asks them to pick it back out of a list.
   *
   * On mount rather than in an effect, and after `createSelectedSource`'s own
   * mount handler so this overrides the stored id rather than racing it. After
   * the page is open the picker is the authority: an effect watching the URL
   * would drag the selection back every time they chose something else.
   *
   * SSR-safe by construction -- `onMount` never runs on the server, so the
   * server's HTML and the first client render agree and the selection arrives
   * one tick later. Adopting it also writes it to storage, so it survives the
   * query parameter falling off the next navigation.
   */
  onMount(() => {
    const id = props.requestedSourceId;
    if (!id || selection.source()?.id === id) return;
    // An id that resolves to nothing is ignored in silence: it means the link
    // was shared with somebody who cannot see that source, and the honest
    // answer there is the placeholder guide, not an error they cannot act on.
    const match = sources().find((source) => source.id === id);
    if (match) selection.setSource(match);
  });

  const state: WikiState = {
    get signedIn() {
      return props.context.signedIn;
    },
    get publicOrigin() {
      return props.context.publicOrigin;
    },
    sources,
    source: selection.source,
    setSource: selection.setSource,
    clear: selection.clear,
    ctxFor: (kind) =>
      buildRenderContext({
        source: selection.source(),
        signedIn: props.context.signedIn,
        publicOrigin: props.context.publicOrigin,
        kind,
      }),
  };

  const [contentsOpen, setContentsOpen] = createSignal(false);

  return (
    <WikiCtx.Provider value={state}>
      <div class="flex h-dvh flex-col overflow-hidden">
        {/*
          The same 56px three-column bar the app draws, and for the same reason:
          the centre cell is centred on the WINDOW rather than on whatever the
          left cell happens to be wide. This was a wrapping flex row, which grew
          a second line as soon as the picker held a long source name and left
          the bar a different height on different pages.
        */}
        <header
          class={cn(
            "z-50 grid h-14 shrink-0 items-center gap-2 bg-background",
            "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]",
            hairlineBottom
          )}
        >
          <div class="z-10 flex min-w-0 items-center pl-4">
            {/* The wordmark takes the 16px lead step: it is the one piece of
                marketing type in a bar that is otherwise chrome. */}
            <Link
              to="/wiki"
              class="focus-ring flex shrink-0 items-center gap-2 rounded-sm text-lead"
            >
              <span class="size-2 rounded-[3px] bg-chart-1 shadow-[0_0_12px_var(--color-chart-1)]" />
              firstrun
              <span class="text-muted-foreground font-normal">wiki</span>
            </Link>

            <ContentsDrawer
              open={contentsOpen()}
              onOpenChange={setContentsOpen}
              kind={selection.source()?.kind ?? null}
            />
          </div>

          <WikiBreadcrumb />

          <div class="flex min-w-0 items-center justify-self-end gap-1 pr-4">
            <SourcePicker
              sources={sources()}
              signedIn={props.context.signedIn}
              selected={selection.source()}
              onSelect={selection.setSource}
            />

            <Show
              when={props.session.user}
              fallback={
                <a href="/login" class={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
                  {i18n.t("wiki.sign_in")}
                </a>
              }
            >
              {(user) => (
                <a
                  href="/"
                  class={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "shrink-0 text-muted-foreground"
                  )}
                >
                  <Avatar class="size-5">
                    <AvatarImage src={user().avatarUrl ?? undefined} alt="" />
                    <AvatarFallback class="text-[9px]">
                      {initials(user().name?.trim() || user().login)}
                    </AvatarFallback>
                  </Avatar>
                  <span class="hidden sm:inline">{i18n.t("wiki.open_app")}</span>
                  <ExternalLink class="size-3.5" />
                </a>
              )}
            </Show>
          </div>
        </header>

        <div class="flex min-h-0 flex-1">
          {/*
            The contents column at the measured 287px: 286 of content plus the
            hairline, which the border sits inside.

            Its visibility is a viewport breakpoint rather than a container
            query, exactly as `ui/sidebar.tsx` keys the app sidebar. This column
            is what SETS the content pane's width, so asking the pane how wide
            it is would be asking it about itself. Everything INSIDE the pane is
            keyed off the pane.
          */}
          <aside class={cn("hidden w-[287px] shrink-0 flex-col lg:flex", hairlineRight)}>
            <TableOfContents kind={selection.source()?.kind ?? null} />
          </aside>

          {/*
            The content pane: the other of the page's two scroll containers, and
            the container QUERY context for everything in it. A container rather
            than viewport breakpoints because the pane is what the content
            actually has -- the contents column appearing at `lg` takes 287px
            away from it, and the layout inside has to reflow as if the window
            had narrowed by that much.
          */}
          <ScrollArea
            role="main"
            data-wiki-scroller
            class="@container/page min-h-0 min-w-0 flex-1"
          >
            {/*
              The page grid, the same `margin | content | margin` every other
              surface hangs on. `page-track` places its own child, so there is
              no column to name here.

              Inside it, two columns of fixed widths rather than one that grows:
              a measure is a number of characters, and a column that keeps
              widening past it makes a line the eye loses its place returning
              from. 40rem of prose, 15rem of contents, 3rem between them.

              The rail is a sibling of the page rather than something the page
              renders, so a topic file stays a topic file. It finds the headings
              by reading this column -- hence the marker attribute, which is the
              contract between the two. It appears at the first standard step at
              or above the 61rem the two columns need together.
            */}
            <div class="page-track">
              <div class="flex justify-center gap-12">
                <div data-wiki-content class="w-full max-w-[40rem] min-w-0">
                  {props.children}
                </div>
                <OnThisPage
                  contentSelector="[data-wiki-content]"
                  scrollSelector="[data-wiki-scroller]"
                  class="hidden @5xl/page:block"
                />
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </WikiCtx.Provider>
  );
}

/**
 * The page, as an icon and a title, centred in the bar.
 *
 * The app's own breadcrumb, rebuilt for the wiki's routes rather than shared:
 * `components/app-shell.tsx` derives its identity from workspace paths and is
 * mounted inside a workspace, and the wiki renders for somebody who has never
 * signed in. Same anatomy, though -- a 24px icon slot holding a 16px glyph, a
 * drawn slash, and the title at the chrome step in medium.
 */
function WikiBreadcrumb() {
  const i18n = useI18n();
  const routerState = useRouterState();
  const path = () => routerState().location.pathname.replace(/\/+$/, "") || "/";

  const page = (): { icon: (props: { class?: string }) => JSX.Element; title: string } => {
    const slug = path().startsWith("/wiki/") ? path().slice("/wiki/".length) : "";
    if (!slug) return { icon: BookOpen, title: i18n.t("wiki.overview") };
    const topic = topicBySlug(slug);
    // An unknown slug says so rather than naming the slug: the page under it is
    // the not-found state, and a breadcrumb that reads back a dead URL is one
    // more thing claiming that URL means something.
    if (!topic) return { icon: BookOpen, title: i18n.t("wiki.not_found") };
    return { icon: topic.icon ?? BookOpen, title: topicTitle(i18n.t, topic) };
  };

  return (
    <nav
      aria-label={i18n.t("wiki.breadcrumb")}
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

/**
 * The contents, as a drawer, below the width the column appears at.
 *
 * Between 0 and `lg` the only navigation used to be a link back to the index,
 * which is one page of the wiki offering to show you the list of pages. Same
 * Kobalte dialog the app sidebar opens on a phone, at the same width, holding
 * the same list the column holds -- so there is one table of contents and two
 * places it can be.
 */
function ContentsDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Surface | null;
}) {
  const i18n = useI18n();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <div class="flex items-center lg:hidden">
        <span aria-hidden="true" class="mr-1 ml-3 h-6 w-px bg-border" />
        <Dialog.Trigger
          class={cn(
            "focus-ring flex h-control-sm shrink-0 cursor-pointer items-center gap-1.5",
            "rounded-md px-2 text-body text-muted-foreground outline-none",
            "transition-colors hover:text-foreground"
          )}
        >
          <BookOpen class="size-4" />
          {i18n.t("wiki.contents")}
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] lg:hidden dark:bg-black/60" />
        <Dialog.Content
          aria-label={i18n.t("wiki.contents")}
          class={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[287px] flex-col lg:hidden",
            "bg-sidebar text-sidebar-foreground",
            hairlineRight
          )}
        >
          <TableOfContents kind={props.kind} onNavigate={() => props.onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

/**
 * One row of the contents.
 *
 * 36px tall on a 37px pitch, 6px radius, the chrome text step, 2px of padding
 * on the leading edge and a 36px square slot for the glyph -- which is what
 * puts every label at 38px from the row's left edge whether the row carries an
 * icon or not. Same numbers as `ui/sidebar.tsx`, because it is the same list in
 * a different shell.
 *
 * The current page is marked by fill and by colour, and NOT by weight. Bolding
 * the active row reflows the list a hair every time it moves, and next to a
 * stack of regular rows the fill is already unmissable.
 */
const NAV_ROW = [
  "focus-ring flex h-control-md items-center rounded-md pr-2 pl-0.5",
  "text-body transition-colors",
].join(" ");

const navRowState = (current: boolean) =>
  current ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground";

/** 1px of gap on a 36px row is the measured 37px pitch. */
const NAV_LIST = "flex w-full min-w-0 flex-col gap-px";

/**
 * The contents.
 *
 * Filtered by the kind of source the reader picked, because a Tauri page in the
 * list while somebody is installing a website tag is a page they have to decide
 * to ignore. With nothing picked, everything shows -- somebody evaluating the
 * product should see that both surfaces are covered.
 *
 * Rendered into the column at `lg` and into the drawer below it, so it draws
 * the list and nothing around it: 10px above and 8px below inside an 8px column
 * inset, which is the measured nav padding.
 */
function TableOfContents(props: { kind: Surface | null; onNavigate?: () => void }) {
  const i18n = useI18n();
  const routerState = useRouterState();
  const path = () => routerState().location.pathname;
  const groups = () => sectionedTopics(props.kind);

  return (
    <ScrollArea class="flex min-h-0 flex-1 flex-col px-2 pt-2.5 pb-2">
      <ul class={NAV_LIST}>
        <li>
          <Link
            to="/wiki"
            onClick={() => props.onNavigate?.()}
            class={cn(NAV_ROW, navRowState(path() === "/wiki"))}
          >
            <BookOpen class="mx-2.5 size-4 shrink-0" />
            <span class="truncate">{i18n.t("wiki.overview")}</span>
          </Link>
        </li>
      </ul>

      {/* Groups are told apart by a rule at 4px, full row width, and never by a
          heading: the reference has no group labels anywhere in navigation, and
          a row of type in a list whose whole point is that every row is the
          same height is the thing it removed. */}
      <For each={groups()}>
        {(group) => (
          <>
            <SidebarSeparator />
            <ul class={NAV_LIST} aria-label={sectionLabel(i18n.t, group.section)}>
              <For each={group.topics}>
                {(topic) => (
                  <li>
                    <Link
                      to="/wiki/$topic"
                      params={{ topic: topic.slug }}
                      onClick={() => props.onNavigate?.()}
                      class={cn(NAV_ROW, navRowState(path() === `/wiki/${topic.slug}`))}
                    >
                      {/* Stands in for the icon slot, so a row without a glyph
                          starts its label at the same 38px as the one above it
                          that has one. */}
                      <span aria-hidden="true" class="w-9 shrink-0" />
                      <span class="truncate">{topicTitle(i18n.t, topic)}</span>
                    </Link>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </For>
    </ScrollArea>
  );
}

/**
 * The typography a page's own markup lands in.
 *
 * So a content page can write a paragraph, a list or a heading as plain HTML
 * and have it look like the rest of the wiki, instead of every page inventing
 * its own text sizes. Direct children only: a nested component -- a step, a
 * snippet, a callout -- has already decided how it looks, and prose rules
 * reaching into it would win on specificity and undo that.
 *
 * ## Prose is 16px at full contrast; the app around it is 14px and quieter
 *
 * Both numbers are measured, and the split is not ours: 14px on a 20px line is
 * application chrome, 16px on a 27px line is prose. A guide is read start to
 * finish, so it takes the prose step; a dashboard is scanned for a number, so
 * it keeps the chrome step.
 *
 * The COLOUR follows the same split, and this is the change that makes a page
 * read as documentation rather than as a long tooltip. Body copy here is the
 * foreground tone, not the muted one. Muted is for text beside something else
 * -- a label, a caption, a hint under a field -- and a paragraph somebody is
 * meant to read every word of is not beside anything. The muted tone stays on
 * the chrome around the prose: the contents, the section labels, the note under
 * a snippet.
 *
 * The headings come off the same measured ladder, and each one carries its own
 * NEGATIVE TRACKING -- roughly -0.04em at 24px, -0.03em at 20px. That is the
 * property that makes a heading read as this design system rather than as a
 * generic sans, and it is the usual thing a port drops.
 *
 * Every step is a type token defined in `styles.css`, so this component names
 * the step it wants and says nothing about how big that step is. Do not put a
 * pixel size back in here.
 *
 * ## Rhythm is margins, not a flex gap
 *
 * A gap is one number between every pair of things, and a page does not want
 * one number: a heading needs a lot of air above it and very little below,
 * because the space under a heading is what attaches it to the section it
 * names. Written as a gap, a heading floats exactly halfway between the
 * paragraph it follows and the paragraph it introduces, and the page reads as
 * an undifferentiated column.
 *
 * So this is a block, and the spacing is vertical margins that COLLAPSE: a
 * paragraph's 16px against a heading's 36px is 36px, not 52px. Getting that
 * addition wrong is what a stack of gap utilities is really protecting against,
 * and collapsing is the correct behaviour here rather than the hazard.
 *
 * ## The measure is the column
 *
 * Text stops at roughly 70 characters because a longer line loses the reader
 * between the end of one and the start of the next. That limit is enforced by
 * the width of the column this renders into, not by a cap on each paragraph:
 * capping per element would also squeeze the things that are not prose, and a
 * code block narrowed to a reading measure just gains a horizontal scrollbar.
 */
export function WikiProse(props: { children: JSX.Element; class?: string }) {
  return (
    <div
      class={cn(
        "text-prose text-foreground",
        // The default rhythm, which everything that is not a heading or a list
        // takes: a snippet, a callout, a set of steps, a paragraph.
        "[&>*]:my-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Each heading step brings its own size, line height, weight and
        // negative tracking with it, so nothing here restates any of them.
        // What is set is the asymmetry: a lot of space above, a little below.
        "[&>h2]:mt-9 [&>h2]:mb-3 [&>h2]:scroll-mt-6 [&>h2]:text-h2 [&>h2]:text-foreground",
        "[&>h3]:mt-8 [&>h3]:mb-3 [&>h3]:scroll-mt-6 [&>h3]:text-h3 [&>h3]:text-foreground",
        "[&>ul]:my-3 [&>ul]:list-disc [&>ul]:pl-6",
        "[&>ol]:my-3 [&>ol]:list-decimal [&>ol]:pl-6",
        // The marker is chrome; the item is prose. Nudging the text off the
        // marker is what stops a bullet reading as part of the first word.
        "[&_li]:pl-1 [&_li]:my-1 [&_li::marker]:text-muted-foreground",
        "[&_strong]:font-medium [&_strong]:text-foreground",
        // A link is the same colour as the text it sits in, told apart by
        // weight and by an underline drawn at half strength: full-strength on
        // 16px prose is a row of hard lines the eye reads before the words.
        "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline",
        "[&_a]:decoration-foreground/50 [&_a]:underline-offset-4",
        "[&_a:hover]:decoration-foreground",
        // Inline code only, which is what the exclusion is for.
        //
        // Written as a plain descendant rule this was the wiki's worst-looking
        // bug: a code block renders a code element inside a pre that already
        // has its own fill, border and padding, so every block got a second,
        // differently shaded, padded, rounded rectangle painted behind the text
        // inside it. That is the "different background of the text" the report
        // was about, and it was one selector.
        //
        // The exclusion has to be a descendant test rather than a child test.
        // Inline code turns up inside a paragraph, a list item, a heading and
        // occasionally as a direct child of this element, so there is no single
        // parent to name; what every block has and no inline chip has is a pre
        // somewhere above it.
        //
        // Relative to the text it sits in, so inline code tracks the body size
        // and stays a touch under it, which is where a mono face reads level
        // with the sans around it. The hairline edge is what makes the chip an
        // object rather than a smudge: on a dark ground a fill this close to
        // the page has no shape without one.
        "[&_code:not(pre_*)]:rounded-sm [&_code:not(pre_*)]:border [&_code:not(pre_*)]:bg-muted",
        "[&_code:not(pre_*)]:px-[0.3125rem] [&_code:not(pre_*)]:py-px",
        "[&_code:not(pre_*)]:font-mono [&_code:not(pre_*)]:text-[0.9em]",
        "[&_code:not(pre_*)]:text-foreground",
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * The vertical rhythm every wiki page is written to.
 *
 * Vertical only. Width is decided by the shell: the page grid is `page-track`
 * on the content pane, the measure is the column inside it, and the right-hand
 * contents is that column's sibling. A page that set its own width would either
 * overlap that rail or leave a gap beside it, and a page that faked its margin
 * as padding would be the one surface in the app not on the grid.
 *
 * The tail is deliberately long. A reader at the bottom of a guide is usually
 * still reading, and a last paragraph pinned to the bottom edge of the window
 * is one nobody can put in the middle of their screen.
 */
export function WikiPage(props: { children: JSX.Element; class?: string }) {
  return <div class={cn("w-full pt-12 pb-24", props.class)}>{props.children}</div>;
}
