import { Dialog } from "@kobalte/core/dialog";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import PanelLeft from "lucide-solid/icons/panel-left";
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Accessor,
  type ComponentProps,
  type JSX,
  type ValidComponent,
} from "solid-js";
import { cn } from "../../lib/cn.js";
import { createIsMobile } from "../../lib/use-mobile.js";
import { Button } from "./button.js";
import { ScrollArea } from "./scroll-area.js";
import { Tooltip } from "./tooltip.js";

/**
 * The sidebar, sized off `docs/vercel-structure.md`.
 *
 * The measured shape, and the numbers every export below is built around:
 *
 *   pane      287px expanded, 286 of content plus a one-DEVICE-pixel hairline
 *   rows      36px tall on a 37px pitch, 6px radius, 14px/400
 *   icon      a 36px square slot holding a 16px glyph, so labels start at 38
 *   groups    separated by a 1px rule with 4px above and below, never a label
 *   nav       10px above, 8px below, the column itself inset 8px
 *   footer    52px: 8px of padding around a 36px row
 *
 * The collapse model is unchanged -- expanded, or a narrow icon strip, with the
 * state in a cookie so the server renders the right width on the first paint
 * instead of the sidebar snapping shut after hydration.
 */

const SIDEBAR_COOKIE = "fr_sidebar";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

/**
 * The phone drawer opens at the measured width and is not resizable.
 *
 * A drag handle on a touch screen is an edge you cannot hit, and a drawer that
 * covers the page has nothing to trade width with. The pane's own widths live
 * in `styles.css`, so the collapsed 52px and the expanded default each have
 * exactly one declaration.
 */
const SIDEBAR_WIDTH_MOBILE = "287px";

/**
 * The resize limits, which are the same three numbers `styles.css` declares.
 *
 * Stated in both places on purpose: the stylesheet needs them to lay the column
 * out, and the drag handle needs them to clamp a pointer that has run off the
 * side of the screen. Reading them back out of the computed style on every
 * pointermove would be a layout read per frame to learn a constant.
 */
const SIDEBAR_WIDTH_DEFAULT = 287;
const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 480;
const SIDEBAR_WIDTH_COOKIE = "fr_sidebar_w";

/** The width in effect, or the default before anyone has dragged it. */
function currentSidebarWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width");
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : SIDEBAR_WIDTH_DEFAULT;
}

/**
 * Put a width on screen, clamped. Returns what was actually applied.
 *
 * On the document element rather than on the pane, so the value is in scope for
 * the pane, its inner column and anything else that wants to know how wide the
 * column is, and so the head script can set it before any of them exist.
 */
function applySidebarWidth(px: number): number {
  const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  return clamped;
}

/**
 * Remember it.
 *
 * A cookie rather than localStorage, matching the open/closed state next to it:
 * the document can read a cookie before the first paint, and a width restored
 * one frame late is a column that visibly jumps on every navigation.
 */
function storeSidebarWidth(px: number) {
  document.cookie =
    `${SIDEBAR_WIDTH_COOKIE}=${px}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * The width, restored before the first paint.
 *
 * Rendered into the document head as a plain string. It has to run before the
 * sidebar is laid out, which rules out an effect, a mount handler and anything
 * else that waits for hydration -- all three would show the default width for a
 * frame and then snap. Kept to one statement with its own try/catch so a
 * malformed cookie cannot take the page down with it.
 */
export const SIDEBAR_WIDTH_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${SIDEBAR_WIDTH_COOKIE}=(\\d+)/);if(m){var w=Math.min(${SIDEBAR_WIDTH_MAX},Math.max(${SIDEBAR_WIDTH_MIN},+m[1]));document.documentElement.style.setProperty('--sidebar-width',w+'px')}}catch(e){}`;

/**
 * A chrome edge, at one DEVICE pixel rather than one CSS pixel.
 *
 * Every border in the reference computes to 0.667px at a 1.5x display: the
 * chrome is drawn a display pixel thick, not a layout pixel thick, so it stays
 * a hairline at 150% and 200% scaling instead of thickening with the zoom.
 *
 * The colour is `chrome-border`, not `border`: these two edges separate two
 * different surfaces, and the reference draws that seam with an opaque step
 * rather than with the alpha hairline it uses for a rule inside a surface.
 *
 * Exported as strings because both edges in the shell -- the sidebar's right and
 * the topbar's bottom -- have to agree, and because the media queries are the
 * one piece of this file that cannot be checked by eye.
 */
export const hairlineRight = [
  "border-r border-chrome-border",
  "[@media(min-resolution:1.5dppx)]:border-r-[0.667px]",
  "[@media(min-resolution:2dppx)]:border-r-[0.5px]",
].join(" ");

export const hairlineBottom = [
  "border-b border-chrome-border",
  "[@media(min-resolution:1.5dppx)]:border-b-[0.667px]",
  "[@media(min-resolution:2dppx)]:border-b-[0.5px]",
].join(" ");

interface SidebarContext {
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  openMobile: Accessor<boolean>;
  setOpenMobile: (open: boolean) => void;
  isMobile: Accessor<boolean>;
  state: Accessor<"expanded" | "collapsed">;
  toggle: () => void;
}

const SidebarCtx = createContext<SidebarContext>();

export function useSidebar(): SidebarContext {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return ctx;
}

export function SidebarProvider(props: {
  defaultOpen?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  const isMobile = createIsMobile();
  const [open, setOpenState] = createSignal(props.defaultOpen ?? true);
  const [openMobile, setOpenMobile] = createSignal(false);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    // A cookie, not localStorage: the server can read this one, so the first
    // paint is already the right width.
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  const toggle = () => (isMobile() ? setOpenMobile(!openMobile()) : setOpen(!open()));

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === SIDEBAR_KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const state = () => (open() ? ("expanded" as const) : ("collapsed" as const));

  return (
    <SidebarCtx.Provider
      value={{ open, setOpen, openMobile, setOpenMobile, isMobile, state, toggle }}
    >
      {/*
        A flex row, and the element the collapsed state is announced on.

        Note for anyone documenting a Tailwind class in a comment here: the
        scanner reads comments too. An earlier version of this note quoted an
        arbitrary width utility built on a custom property, and Tailwind
        dutifully emitted a real rule for it pointing at a token that no longer
        exists -- a dead declaration in the production stylesheet, generated
        entirely by prose. Describe such classes, do not spell them.
      */}
      <div
        data-sidebar-state={state()}
        class={cn(
          "group/shell relative flex h-dvh w-full overflow-hidden bg-background",
          props.class
        )}
      >
        {props.children}
      </div>
    </SidebarCtx.Provider>
  );
}

export function Sidebar(props: { class?: string; children: JSX.Element }) {
  const { isMobile, openMobile, setOpenMobile, state } = useSidebar();

  return (
    <>
      {/* Phones get a drawer. A 52px icon strip on a 375px screen is a waste of
          an eighth of the viewport and reads nothing. */}
      <Dialog open={isMobile() && openMobile()} onOpenChange={setOpenMobile}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-overlay bg-black/40 backdrop-blur-[1px] md:hidden dark:bg-black/60" />
          <Dialog.Content
            class={cn(
              "fixed inset-y-0 left-0 z-overlay flex flex-col bg-sidebar text-sidebar-foreground md:hidden",
              hairlineRight
            )}
            style={{ width: SIDEBAR_WIDTH_MOBILE }}
          >
            {props.children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>

      {/*
        The two widths.

        Both live in `styles.css` as two attribute selectors on `data-slot` and
        `data-state`, and NOT here. There were briefly two declarations of the
        same two numbers, one of them wrong; the stylesheet now carries the
        measured 287px and 52px and this component only flips the attribute.

        They are real CSS rather than utility classes because the utility form
        is where this went wrong before: expressed as a named-group arbitrary
        variant the collapse emitted nothing while `data-state` flipped
        correctly on every toggle. Expressed as a basis rather than a width
        because the element IS a flex item -- its parent is the shell's flex row
        -- and `flex: 0 0 <size>` states the main size in the terms flex layout
        actually reads.

        The pane is the full-height element and the topbar lives inside the pane
        NEXT to it, so the topbar does not span the sidebar. That is the
        reference's arrangement; it gets there with `position: fixed` and we get
        there with a flex row, which is the same picture without taking the
        sidebar out of flow.
      */}
      <div
        data-slot="sidebar"
        data-state={state()}
        class={cn(
          // Above the topbar, not below it: the measured pair is 76 and 50.
          // Every portalled overlay sits above BOTH, which is the whole reason
          // the ladder is three named numbers in `styles.css` rather than a 50
          // repeated everywhere.
          "relative z-sidebar hidden h-full overflow-hidden md:block",
          // One device pixel, and the global border colour rather than the
          // sidebar's own: this edge separates two surfaces and has to be seen
          // doing it, while the sidebar token is a hairline meant for rules
          // *inside* the sidebar. (Naming the utility here would emit it -- the
          // scanner reads comments. See the note in SidebarProvider.)
          hairlineRight,
          "bg-sidebar text-sidebar-foreground"
        )}
      >
        {/*
          Held at the EXPANDED width, whatever the reader has dragged that to,
          so the contents slide out of view behind the overflow rather than
          re-wrapping while the sidebar narrows. Reading the custom property
          rather than a constant is what makes the rows follow the drag; reading
          it here rather than rendering a number is what keeps the value out of
          the server's HTML. The 1px is the hairline the pane spends on its edge.
        */}
        <div
          class={cn("flex h-full flex-col", props.class)}
          style={{ width: "calc(var(--sidebar-width) - 1px)" }}
        >
          {props.children}
        </div>
      </div>
    </>
  );
}

/**
 * The header: 4px of lead-in, then the scope row.
 *
 * 92px: 4px of lead-in, the 48px scope band, the 4px column gap, then the 36px
 * Find row. Both rows are the shell's, and the header reserves the height for
 * them rather than letting the second one push the nav down when it appears.
 */
export function SidebarHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col gap-1 pt-1", local.class)} {...rest} />;
}

/** 8px around a 36px row, which is the measured 52. */
export function SidebarFooter(props: ComponentProps<"section">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <section class={cn("mt-auto flex flex-col p-2", local.class)} {...rest} />;
}

/**
 * The scrolling nav.
 *
 * `relative` because the settings pane swap positions the outgoing pane
 * absolutely inside this box. 10px above and 8px below, measured; the 8px
 * column inset is on the panes so a pane can bleed a rule to the full width.
 */
export function SidebarContent(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <ScrollArea
      class={cn("relative flex min-h-0 flex-1 flex-col px-2 pt-2.5 pb-2", local.class)}
      {...rest}
    />
  );
}

/**
 * One pane of the sidebar nav.
 *
 * Settings does not get a second nav column beside the content: the one sidebar
 * swaps what it is showing. The outgoing pane is taken out of flow, faded,
 * blurred and pushed 8px in the direction it is leaving; the incoming pane is
 * the only thing left in flow, so the box never has two panes' worth of height.
 *
 * `side` says which way this pane travels when it is not the active one. The
 * root pane leaves to the left and the pushed pane arrives from the right, so
 * opening settings reads as going one level deeper rather than as a crossfade.
 */
export function SidebarPane(props: {
  active: boolean;
  side: "root" | "pushed";
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      data-active={props.active ? "" : undefined}
      aria-hidden={props.active ? undefined : "true"}
      inert={props.active ? undefined : true}
      class={cn(
        "flex flex-col transition-[transform,translate,opacity,filter] duration-200 ease-[ease]",
        props.active
          ? "static opacity-100"
          : [
              "pointer-events-none absolute inset-x-2 top-2.5 opacity-0 blur-[2px]",
              props.side === "root" ? "-translate-x-2" : "translate-x-2",
            ],
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * The header of a pushed pane: a back chevron, a centred title, and a spacer.
 *
 * The spacer is not decoration. Without a 36px block on the trailing side the
 * title centres on the space left over by the chevron and sits visibly off the
 * middle of a 270px row.
 */
type SidebarPaneHeaderProps = {
  /** The name of the pane, centred. */
  title: string;
  /** The accessible name of the control, which is the whole row. */
  label: string;
  class?: string;
  /** Almost always a router `Link`. Same reasoning as `SidebarMenuButton`. */
  as?: ValidComponent;
  [key: string]: unknown;
};

/**
 * The pushed pane's header, which IS the way back.
 *
 * The measured shape is a 40px band holding one 36px BUTTON, and the button
 * spans the row: a 36px chevron slot, the centred title, then a 36px spacer
 * that exists only so the title is centred on the row rather than on the space
 * left over after the chevron.
 *
 * The whole row being the control is the part worth getting right. A 36px
 * square hit target on the left of an otherwise inert title reads as a
 * decoration with a small button stuck to it, and it is a quarter of the target
 * the reference actually gives you. The title is not a label next to the back
 * button; it is inside it.
 */
export function SidebarPaneHeader(props: SidebarPaneHeaderProps) {
  const [local, rest] = splitProps(props, ["title", "label", "class"]);
  return (
    <div class={cn("flex h-10 w-full items-center pb-1", local.class)}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={local.label}
        class={cn(
          "h-9 w-full justify-start gap-0 overflow-hidden rounded-md px-0",
          "text-body font-medium text-muted-foreground hover:text-foreground"
        )}
        {...rest}
      >
        <span class="flex size-9 shrink-0 items-center justify-center">
          <ChevronLeft class="size-4" />
        </span>
        <span class="min-w-0 flex-1 truncate text-center">{local.title}</span>
        {/* The counterweight. Without it the title centres on what is left of
            the row and sits visibly right of centre. */}
        <span aria-hidden="true" class="size-9 shrink-0" />
      </Button>
    </div>
  );
}

export function SidebarGroup(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex w-full flex-col", local.class)} {...rest} />;
}

/**
 * The rule between groups.
 *
 * The reference has no group labels at all: a 1px rule with 4px above and below
 * is the entire separator, and it runs the full 270px of the column. A label
 * would add a row of type to a list whose whole point is that every row is the
 * same height.
 */
export function SidebarSeparator(props: ComponentProps<"hr">) {
  const [local, rest] = splitProps(props, ["class"]);
  // gray-200, which is `secondary` here: the measured group rule sits one step
  // in from the chrome seam, so it reads as a divider rather than as an edge.
  return <hr class={cn("my-1 h-px w-full border-0 bg-secondary", local.class)} {...rest} />;
}

/** 1px of gap on a 36px row is the measured 37px pitch. */
export function SidebarMenu(props: ComponentProps<"ul">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <ul class={cn("flex w-full min-w-0 flex-col gap-px", local.class)} {...rest} />;
}

export function SidebarMenuItem(props: ComponentProps<"li">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <li class={cn("group/menu-item relative", local.class)} {...rest} />;
}

/**
 * A row in the sidebar.
 *
 * 36px tall, 6px radius, 14px at weight 400, 2px of padding on the leading edge
 * and a 36px square slot for the icon -- which is what puts every label at 38px
 * from the row's left edge whether or not the icon is there.
 *
 * `size="sm"` is deliberate and is not about the height, which is overridden
 * anyway. It is the one Button size with no `has-[>svg]` padding rule on it,
 * and that rule outranks a plain `pl-*` on specificity: picked any other size
 * and every row with an icon in it quietly gets the button's padding back.
 *
 * Collapsed, the label is hidden and the row becomes a 36px square; the tooltip
 * carries the name so the strip stays usable rather than becoming a guessing
 * game.
 */
type SidebarMenuButtonProps = {
  children: JSX.Element;
  tooltip?: string;
  isActive?: boolean;
  class?: string;
  /**
   * Almost always a router `Link`. This is not `PolymorphicProps<T>` because
   * every caller here passes `as` along with that component's own props, and
   * threading a generic through two layers of polymorphism makes the props of
   * the *inner* Button unresolvable -- the error is four hundred lines of
   * union and says nothing. The row is a wrapper; the type that matters is
   * Button's, one level down.
   */
  as?: ValidComponent;
  [key: string]: unknown;
};

export function SidebarMenuButton(props: SidebarMenuButtonProps) {
  const { state, isMobile } = useSidebar();
  const [local, rest] = splitProps(props, ["children", "tooltip", "isActive", "class"]);

  const content = (
    <Button
      variant="ghost"
      size="sm"
      data-active={local.isActive ? "" : undefined}
      class={cn(
        "h-9 w-full justify-start gap-0 overflow-hidden rounded-md pr-2 pl-0.5",
        "text-body font-normal",
        // The 36px icon slot: 10 + 16 + 10.
        "[&>svg]:mx-2.5 [&>svg]:size-4 [&>svg]:shrink-0",
        // Active and idle are two branches rather than one base plus attribute
        // overrides. The ghost variant brings its own hover background, and a
        // hover rule and an attribute rule have the same specificity -- which
        // one won on an active row being hovered came down to stylesheet order.
        // Each branch states its own hover, tailwind-merge drops the variant's,
        // and there is nothing left to race.
        //
        // Active is a FILLED ROW: the accent fill at full foreground. No left
        // bar, no underline, no shadow, and not an inverted pill -- a row that
        // inverts to near-white on black is louder than anything else on
        // screen, and the reference does not do it.
        local.isActive && [
          "bg-sidebar-accent text-sidebar-accent-foreground",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        ],
        // Idle is gray-900, which is `muted-foreground` here. Hover is a weaker
        // mix of the active fill, so the two states are one gesture at two
        // strengths and the selected row is still the stronger of them while
        // the pointer is over its neighbour.
        !local.isActive && [
          "text-muted-foreground",
          "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        ],
        // Collapsed, the row also has to stop being full width. The pane keeps
        // its 287px layout and is clipped to the 52px strip, so a full-width
        // row centres its icon far past the visible edge, which is how the icon
        // strip once ended up showing no icons at all.
        state() === "collapsed" && "w-9 justify-center px-0 [&>svg]:mx-0",
        local.class
      )}
      {...rest}
    >
      {local.children}
    </Button>
  );

  return (
    <Tooltip
      label={local.tooltip ?? ""}
      disabled={!local.tooltip || state() === "expanded" || isMobile()}
    >
      {content}
    </Tooltip>
  );
}

/**
 * A row one level in, inside a pushed pane.
 *
 * No icon, 10px of leading padding, and 14px at weight 500 rather than 400 --
 * the measured difference between a top-level row and a sub-item, and the only
 * thing distinguishing the two lists once the pane has swapped.
 */
export function SidebarSubButton(props: SidebarMenuButtonProps) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <SidebarMenuButton
      class={cn("pl-2.5 font-medium", local.class)}
      {...(rest as SidebarMenuButtonProps)}
    />
  );
}

/** Hidden when collapsed, so the icon strip stays a strip. */
export function SidebarLabel(props: ComponentProps<"span">) {
  const { state } = useSidebar();
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <span
      class={cn(
        "min-w-0 flex-1 truncate text-left",
        local.class,
        // Last, so a caller's own display utility cannot win the merge and
        // leave a label showing in a 52px strip.
        state() === "collapsed" && "hidden"
      )}
      {...rest}
    />
  );
}

export function SidebarTrigger(props: { class?: string; label?: string }) {
  const { toggle } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={props.label ?? "Open sidebar"}
      class={props.class}
      onClick={toggle}
    >
      <PanelLeft class="size-4" />
    </Button>
  );
}

/**
 * The thin grab strip on the sidebar's edge.
 *
 * A wide invisible hit area over a 1px visible line: the line is the affordance,
 * the hit area is what makes it clickable without precision aiming.
 */
/**
 * The rail: drag to resize, click to collapse.
 *
 * One control with two gestures, because it is one edge and both gestures are
 * about the same thing. A press that moves is a resize; a press that does not
 * is a toggle. The threshold is what separates them, and without it every
 * attempt to drag would also collapse the column on release.
 *
 * The width is written to the DOCUMENT ELEMENT rather than into this component's
 * markup, and read back from a cookie by a script in the document head. See the
 * long note in `styles.css`: a width in the markup is a hydration mismatch for
 * anybody who has ever dragged it.
 *
 * It is a `separator` and it takes focus, because a control you can only operate
 * with a pointer is a control half the people using this cannot operate at all.
 * Arrow keys move it a row's worth at a time, Home and End go to the two limits,
 * Enter collapses.
 */
export function SidebarRail() {
  const { toggle, state } = useSidebar();

  /** A press becomes a resize once it has travelled far enough to mean it. */
  const DRAG_THRESHOLD = 4;
  /** One arrow press moves the edge by a row's height, so it feels quantised. */
  const KEY_STEP = 36;

  let startX = 0;
  let startWidth = 0;
  let pressing = false;
  let dragged = false;

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;

    // Collapsed, the rail is a toggle and nothing else: there is no width to
    // drag, and dragging the 52px strip wider would silently expand it. The
    // press is still recorded, because `pressing` is what lets the release
    // toggle -- an early return here is how the rail lost its one job and a
    // collapsed sidebar could not be reopened from its own edge.
    pressing = true;
    dragged = false;
    startX = event.clientX;
    startWidth = state() === "collapsed" ? 0 : currentSidebarWidth();

    // Capture keeps the gesture coming even when the pointer leaves the window.
    // It throws on a pointer id that is not active -- a synthetic event, a
    // pointer already released -- and that is not a reason to abandon the drag.
    try {
      event.currentTarget instanceof Element &&
        event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* proceed without capture */
    }
  }

  function onPointerMove(event: PointerEvent) {
    // No width to drag while collapsed, so a move there stays a press.
    if (!pressing || !startWidth) return;
    const delta = event.clientX - startX;
    if (!dragged) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      dragged = true;
      document.documentElement.setAttribute("data-sidebar-resizing", "");
      // A press that became a drag may have started a text selection first.
      document.getSelection()?.removeAllRanges();
    }
    applySidebarWidth(startWidth + delta);
  }

  function onPointerUp(event: PointerEvent) {
    if (!pressing) return;
    try {
      event.currentTarget instanceof Element &&
        event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* it was never captured */
    }
    pressing = false;
    startWidth = 0;
    document.documentElement.removeAttribute("data-sidebar-resizing");
    if (dragged) storeSidebarWidth(currentSidebarWidth());
    else toggle();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (state() === "collapsed") return;
    const step =
      event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (step) {
      event.preventDefault();
      storeSidebarWidth(applySidebarWidth(currentSidebarWidth() + step));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const limit = event.key === "Home" ? SIDEBAR_WIDTH_MIN : SIDEBAR_WIDTH_MAX;
      storeSidebarWidth(applySidebarWidth(limit));
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Back to the measured width, which is the only way out of a column
      // dragged somewhere unusable without hunting for the exact pixel.
      onDblClick={() => storeSidebarWidth(applySidebarWidth(SIDEBAR_WIDTH_DEFAULT))}
      onKeyDown={onKeyDown}
      class={cn(
        "absolute inset-y-0 right-0 z-20 hidden w-4 translate-x-1/2 md:block",
        "outline-none",
        state() === "collapsed" ? "cursor-pointer" : "cursor-ew-resize",
        // The line the reader actually aims at: invisible until the pointer is
        // near it, then the focus blue. A rail that is always visible is a
        // second border down the side of the column.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2",
        "after:bg-transparent after:transition-colors",
        "hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring"
      )}
    />
  );
}

/** Everything that is not the sidebar. Scrolls on its own; the page never does. */
export function SidebarInset(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex h-full min-w-0 flex-1 flex-col overflow-hidden", local.class)}
      {...rest}
    />
  );
}
