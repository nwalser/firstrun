import { Link, useRouterState } from "@tanstack/solid-router";
import BookOpen from "lucide-solid/icons/book-open";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import FileText from "lucide-solid/icons/file-text";
import LogIn from "lucide-solid/icons/log-in";
import {
  For,
  Show,
  createContext,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../../lib/cn.js";
import type { SessionInfo, DocsContext, DocsSource } from "../../lib/api.js";
import { useI18n } from "../../lib/i18n/index.js";
import { createSelectedSource } from "../../lib/selected-source.js";
import { ExpandSidebar, UserMenu } from "../app-shell.js";
import {
  Brandmark,
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
  hairlineBottom,
  useSidebar,
} from "../ui/index.js";
import { OnThisPage } from "./on-this-page.js";
import {
  buildRenderContext,
  sectionLabel,
  sectionedTopics,
  topicBySlug,
  topicTitle,
  type DocsRenderContext,
} from "./registry.js";
import { PlaceholderNotice, SourcePicker } from "./source-picker.js";

/**
 * The documentation's chrome, which is the application's chrome.
 *
 * Not a second shell that resembles the first one. The same `SidebarProvider`,
 * the same `Sidebar`, the same 92px header band, the same 36px rows, the same
 * 52px collapsed strip, the same Ctrl+B, the same drawer on a phone, the same
 * 56px three-column topbar, the same scrolling pane. Everything structural
 * comes from `ui/sidebar.tsx` and `app-shell.tsx`, so there is one set of
 * numbers rather than two that drift apart a pixel at a time.
 *
 * This used to be a hand-built copy: a bespoke 287px `aside`, its own nav row
 * constants restating the sidebar's 36px and 6px and 38px, and its own mobile
 * drawer. Every one of those was the app's measurement written down a second
 * time, and the second copy is the one that goes stale.
 *
 * ## What changes is what is IN the shell, and how much of it there is
 *
 * The documentation is public, and that is the whole reason it is a different mount
 * rather than a route inside the workspace shell: an evaluator reading the
 * install guide before they have an account is the main audience here, not an
 * edge case. So the slots fill in differently, and some do not fill in at all:
 *
 * | slot | app | documentation, signed in | documentation, signed out |
 * | --- | --- | --- | --- |
 * | header row 1 | workspace switcher | the documentation, linking to its overview | same |
 * | header row 2 | Find | the source picker | a link to sign in |
 * | nav | boards and settings | the contents | same |
 * | footer | the account menu | the account menu | a link to sign in |
 * | topbar left | project switcher | nothing | nothing |
 * | pane header | the settings back chevron | the way back into the app | nothing |
 * | topbar right | reserved | the placeholder notice | the placeholder notice |
 *
 * Nothing is disabled and nothing is a stub: a control a signed-out reader
 * cannot use is simply not drawn, and the row it would have taken is not
 * reserved either. That is what "the same shell with fewer things in it" has to
 * mean, or it is just the app with the lights off.
 *
 * The page does not scroll. The provider is fixed to the viewport and the pane
 * scrolls inside it, so the topbar and the contents stay put the whole way down
 * a guide.
 */

export interface DocsState {
  signedIn: boolean;
  publicOrigin: string;
  sources: Accessor<DocsSource[]>;
  /** The source these pages are currently written for. Null means placeholders. */
  source: Accessor<DocsSource | null>;
  setSource: (source: DocsSource | null) => void;
  clear: () => void;
  /**
   * The values a page substitutes.
   *
   * Call it inside JSX rather than hoisting the result: it reads the selection,
   * so calling it where it is used is what makes a page re-render when the
   * reader picks a different source.
   */
  ctxFor: () => DocsRenderContext;
}

const DocsCtx = createContext<DocsState>();

export function useDocs(): DocsState {
  const state = useContext(DocsCtx);
  if (!state) throw new Error("useDocs() outside <DocsShell>");
  return state;
}

export function DocsShell(props: {
  session: SessionInfo;
  context: DocsContext;
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

  const state: DocsState = {
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
    ctxFor: () =>
      buildRenderContext({
        source: selection.source(),
        signedIn: props.context.signedIn,
        publicOrigin: props.context.publicOrigin,
      }),
  };

  return (
    <DocsCtx.Provider value={state}>
      <SidebarProvider>
        <Sidebar>
          {/*
            One row, not the app's two. The second row is the app's Find, and
            the documentation has nothing to search from the navigation column; a row
            reserved for a control that is not there is the shell with the
            lights off. The header is 48px here and 92px in the app, and both
            are the same header with what they have in them.
          */}
          <SidebarHeader>
            <DocsScope />
          </SidebarHeader>

          <SidebarContent>
            {/*
              One pane, always active. The app pushes a second pane for
              settings; the documentation has nothing to push, and a pane component with
              one pane in it costs nothing while keeping the padding, the
              transition context and the scroll behaviour identical.
            */}
            <SidebarPane side="root" active>
              {/*
                The documentation is a pane you came into, so it leaves the way you came
                out of any other one: the back chevron in the pane header, at the
                top of the column, exactly where Settings puts it. It used to be
                a labelled button in the topbar's left cell, which is the one
                place in the shell that means SCOPE, and a link out of the app
                is not a scope.
              */}
              <Show when={props.session.user}>
                <SidebarPaneHeader
                  as="a"
                  href="/"
                  title={i18n.t("docs.contents")}
                  label={i18n.t("docs.back_to_app")}
                />
              </Show>
              <TableOfContents />
            </SidebarPane>
          </SidebarContent>

          <SidebarFooter class="flex-row items-center gap-2">
            <Show when={props.session.user} fallback={<SignInRow />}>
              <UserMenu session={props.session} />
            </Show>
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          {/*
            The app's topbar, unchanged: 56px, three columns at 1 / 2 / 1 so the
            middle cell is centred on the pane rather than on whatever the left
            cell happens to be wide, and one device pixel of separation from the
            content.
          */}
          <header
            class={cn(
              "@container/bar sticky top-0 z-chrome grid h-14 shrink-0 items-center gap-2",
              "bg-card md:bg-background",
              "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]",
              hairlineBottom
            )}
          >
            {/*
              The cell the app fills with the project switcher stays empty here.
              The documentation has no second scope to switch, and the way back into the
              app is in the sidebar with every other back control. The cell
              itself remains so the centred breadcrumb keeps its centre.
            */}
            <div class="z-10 flex min-w-0 items-center overflow-hidden pl-4">
              <ExpandSidebar />
            </div>

            <DocsBreadcrumb />

            {/*
              The source, and the notice that goes with it, in the topbar's
              trailing cell.

              Not in the navigation column, which is the mistake this replaces.
              The picker is not navigation: it does not change what page you are
              on, it changes what the page in front of you SAYS -- and a control
              that rewrites the thing you are reading belongs next to the thing
              you are reading, not in the list of places you could go instead.
              It also has to stay put while the column is collapsed to a strip,
              and a row that is a 36px square with no label cannot say which
              source is selected.

              The notice is the same idea one step earlier -- these keys are not
              real yet -- so it sits immediately before the control that fixes
              it, and drops off first when the bar runs out of room.
            */}
            <div class="flex min-w-0 items-center justify-self-end gap-2 pr-4">
              <Show when={!selection.source()}>
                <PlaceholderNotice class="hidden @3xl/bar:flex" />
              </Show>
              <SourcePicker
                sources={sources()}
                signedIn={props.context.signedIn}
                selected={selection.source()}
                onSelect={selection.setSource}
              />
            </div>
          </header>

          {/*
            The only scroll container on the page, and the container QUERY
            context for everything inside it -- the app's arrangement exactly.
            Container queries rather than viewport ones because the pane is what
            the content actually has: the sidebar collapsing gives it 235px back
            and the layout inside has to reflow as if the window had grown.
          */}
          <div
            data-docs-scroller
            class={cn(
              "@container/page min-h-0 flex-1 overflow-y-auto overscroll-contain",
              "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]"
            )}
          >
            {/*
              ## The contents is pinned to the window, the page is not

              Two different alignments in one row, and that is the measured
              arrangement rather than an oversight.

              The CONTENTS is a fixed 15rem hard against the right edge of the
              window, at every width. It is chrome: it belongs to the frame the
              same way the navigation on the other side does, and a rail that
              drifts inward as the window grows stops reading as an edge and
              starts reading as a third column of the document.

              The PAGE is centred in whatever is left. Its measure is fixed, so
              past a certain width there is slack, and the slack belongs in the
              margins rather than on one side -- which is why the prose sits
              close to the navigation on a laptop and drifts toward the middle
              on a wide monitor. Both of those are correct and they are the same
              rule.

              This is what was wrong before: the rail was INSIDE the centred
              track, so it inherited the page's centring and floated in from the
              right edge by however much slack the track had. At 1920 that was
              200px of nothing between the contents and the window.

              The rail finds its headings by reading the page column -- hence
              the marker attribute, which is the contract between the two. It
              appears at the first width where the two columns fit together.
            */}
            <div class="flex items-start">
              <div class="page-track min-w-0 flex-1">
                {/* Capped and centred inside the track: the track is as wide as
                    the pane allows, and the measure is a number of characters. */}
                <div data-docs-content class="mx-auto w-full max-w-[48rem]">
                  {props.children}
                </div>
              </div>
              <OnThisPage
                contentSelector="[data-docs-content]"
                scrollSelector="[data-docs-scroller]"
                class="mr-5 hidden @min-[61rem]/page:block"
              />
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DocsCtx.Provider>
  );
}

/**
 * Scope segment 1: the documentation itself, in the sidebar header.
 *
 * The workspace switcher's slot and the workspace switcher's geometry -- a 40px
 * row inside a 48px band, a 20px mark, the name at 14/500 -- with no chevron on
 * it, because there is nothing to switch to. The documentation is not one of
 * several things you could be reading; it is the thing you are in.
 *
 * The mark takes the avatar's 20px square rather than sitting loose in the row,
 * so collapsing to the 52px strip leaves it exactly where a workspace logo
 * would have been.
 */

function DocsScope() {
  const i18n = useI18n();

  return (
    <div class="flex h-12 items-center px-2 py-1">
      <div class="flex h-10 min-w-0 flex-1 items-center rounded-md">
        <Link
          to="/docs"
          class={cn(
            "focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-1 pl-2.5",
            "text-body font-medium outline-none transition-colors hover:bg-sidebar-accent"
          )}
        >
          {/* The product mark. `chart-1` is a data SERIES colour and drawing the
              brand with it means a chart and the logo change together. */}
          <span class="flex size-5 shrink-0 items-center justify-center">
            <Brandmark class="h-3 w-auto" />
          </span>
          <SidebarLabel class="truncate">{i18n.t("docs.title")}</SidebarLabel>
        </Link>
      </div>
    </div>
  );
}

/**
 * The footer, for somebody with no account.
 *
 * The account pill's shape and the account pill's place, because signing in is
 * what a reader with no session has instead of an account. Putting it in the
 * topbar instead would leave the one row in the shell that is always about
 * "you" empty on exactly the pages where the invitation matters most.
 */
function SignInRow() {
  const i18n = useI18n();
  const { state } = useSidebar();

  return (
    <a
      href="/login"
      class={cn(
        "focus-ring flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-2.5",
        "text-body outline-none transition-colors hover:bg-sidebar-accent",
        state() === "collapsed" && "w-9 flex-none justify-center px-0"
      )}
    >
      <span class="bg-secondary text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full">
        <LogIn class="size-3" />
      </span>
      <SidebarLabel class="truncate">{i18n.t("docs.sign_in")}</SidebarLabel>
    </a>
  );
}

/**
 * The page, as an icon and a title, centred in the bar.
 *
 * The app's own breadcrumb, rebuilt for the documentation's routes rather than shared:
 * `components/app-shell.tsx` derives its identity from workspace paths and is
 * mounted inside a workspace, and the documentation renders for somebody who has never
 * signed in. Same anatomy, though -- a 24px icon slot holding a 16px glyph, a
 * drawn slash, and the title at the chrome step in medium.
 */
function DocsBreadcrumb() {
  const i18n = useI18n();
  const routerState = useRouterState();
  const path = () => routerState().location.pathname.replace(/\/+$/, "") || "/";

  const page = (): { icon: (props: { class?: string }) => JSX.Element; title: string } => {
    const slug = path().startsWith("/docs/") ? path().slice("/docs/".length) : "";
    if (!slug) return { icon: BookOpen, title: i18n.t("docs.overview") };
    const topic = topicBySlug(slug);
    // An unknown slug says so rather than naming the slug: the page under it is
    // the not-found state, and a breadcrumb that reads back a dead URL is one
    // more thing claiming that URL means something.
    if (!topic) return { icon: BookOpen, title: i18n.t("docs.not_found") };
    return { icon: topic.icon ?? BookOpen, title: topicTitle(i18n.t, topic) };
  };

  return (
    <nav
      aria-label={i18n.t("docs.breadcrumb")}
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
 * The contents.
 *
 * Every page, always. It used to be filtered by the kind of source the reader
 * had picked; sources have no kind, and the filter was the wrong trade before
 * that anyway (see `sectionedTopics` in the registry).
 *
 * Built out of the shell's own row components rather than out of classes that
 * restate their numbers. That is not tidiness: `SidebarMenuButton` is what
 * knows how to be 36px, how to fill when it is active, how to become a 36px
 * square in the collapsed strip, and how to grow a tooltip once its label is
 * gone. A hand-rolled row got the first two and silently missed the last two.
 *
 * Which is why every topic row carries an icon now. In the 52px strip the glyph
 * IS the row, so a blank leading square would leave the contents a column of
 * identical empty buttons; a topic that declares no icon gets the generic page
 * mark rather than nothing.
 *
 * Sections are told apart by a rule, never by a heading. The reference has no
 * group labels anywhere in navigation, and a row of type in a list whose whole
 * point is that every row is the same height is the thing it removed -- the
 * section name survives as the group's accessible name.
 */
function TableOfContents() {
  const i18n = useI18n();
  const { state } = useSidebar();
  const routerState = useRouterState();
  const path = () => routerState().location.pathname.replace(/\/+$/, "") || "/";
  const groups = () => sectionedTopics();

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              as={Link}
              to="/docs"
              tooltip={i18n.t("docs.overview")}
              isActive={path() === "/docs"}
            >
              <BookOpen />
              <SidebarLabel>{i18n.t("docs.overview")}</SidebarLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <For each={groups()}>
        {(group) => (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              {/*
                The section, named.

                A rule on its own says two lists are different and refuses to
                say how. The reference labels every group in its documentation
                navigation -- Start, Ship and scale, Reference -- because a
                reader scanning for "the install guides" is looking for those
                two words, not for the gap above them, and 30-odd rows in one
                column is exactly where a reader needs to know which part they
                are in without reading every row.

                The label is the 13px nav step at normal weight in the dim
                tone, on the row's own 8/8/4 padding. It is NOT a control: it
                does not link anywhere, and it collapses away with the labels
                beside it, because in a 52px strip a word cannot fit and the
                separator above it still does the grouping.
              */}
              <Show when={state() !== "collapsed"}>
                <div class="text-label-13 text-muted-foreground/80 px-2.5 pt-2 pb-1">
                  {sectionLabel(i18n.t, group.section)}
                </div>
              </Show>
              <SidebarMenu aria-label={sectionLabel(i18n.t, group.section)}>
                <For each={group.topics}>
                  {(topic) => (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        as={Link}
                        to="/docs/$topic"
                        params={{ topic: topic.slug }}
                        tooltip={topicTitle(i18n.t, topic)}
                        isActive={path() === `/docs/${topic.slug}`}
                      >
                        <Dynamic component={topic.icon ?? FileText} />
                        <SidebarLabel>{topicTitle(i18n.t, topic)}</SidebarLabel>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </For>
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </For>
    </>
  );
}

/**
 * The typography a page's own markup lands in.
 *
 * So a content page can write a paragraph, a list or a heading as plain HTML
 * and have it look like the rest of the documentation, instead of every page inventing
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
export function DocsProse(props: { children: JSX.Element; class?: string }) {
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
        // Written as a plain descendant rule this was the documentation's worst-looking
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
 * The vertical rhythm every documentation page is written to.
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
export function DocsPage(props: { children: JSX.Element; class?: string }) {
  return <div class={cn("w-full pt-18 pb-24", props.class)}>{props.children}</div>;
}
