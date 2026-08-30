# Vercel dashboard structure

Measured live on 2026-08-30 against a signed-in `vercel.com` dashboard, in dark theme, at a
2258px content pane (2560px viewport, dpr 1.5). Every number below is a computed value read off a
real element, not a guess. Token values (colours, type scale, shadows) live in
`geist-reference.md`; this file is structure and density only.

No account content is recorded here. Instances are written `<team>`, `<project>`, `<branch>`.

Scope note: we reimplement the layout language from observation. We do not copy component source.

## Headline correction

The brief assumed Vercel puts a slash-separated scope breadcrumb in the top bar and has no
sidebar. That is the old dashboard. The current one is different in three ways that matter:

1. There **is** a fixed left sidebar, 287px, full viewport height. It carries the scope switcher,
   the search entry point, all contextual navigation, and the account footer.
2. There **is no tab row**. Contextual navigation is the sidebar list, and the list is
   scope-parameterised: the same 22 items appear at team scope and at project scope, only the
   hrefs change.
3. The top bar's centered `nav[aria-label="Breadcrumb"]` is slash-separated, but its segments are
   `[page icon] / [page title]`, not `team / project`. The scope switcher is split across the
   sidebar header (segment 1: team) and the top bar's left cell (segment 2: project).

---

## 1. Wireframes

### 1.1 Global shell, wide (>= 1024px)

```
x=0                 287                                                        2545
┌───────────────────┬──────────────────────────────────────────────────────────┐ y=0
│ SIDEBAR           │ TOP BAR   h 56   sticky top-0   z 50   bg background-200 │
│ w 287             │ grid-cols [minmax(0,1fr)] [minmax(0,2fr)] [minmax(0,1fr)]│
│  = 286 content    │ gap 8   items-center                                     │
│  + 1dp hairline   │ ┌ pl 16 ───────┐  ┌── centered ──┐  ┌──────── pr 16 ────┐│
│    right          │ │ scope seg 2  │  │  breadcrumb  │  │  right actions    ││
│ position: fixed   │ └──────────────┘  └──────────────┘  └───────────────────┘│
│ full height       ├──────────────────────────────────────────────────────────┤ y=56
│ bg background-200 │ CONTENT                                                  │
│                   │ grid-cols: margin | content | margin                     │
│ ┌ header h 92 ──┐ │   margin  = minmax(24px, 1fr)                            │
│ │ scope seg 1   │ │   content = minmax(0, 1620px)  (or 914px "compact")      │
│ │ find row      │ │                                                          │
│ └───────────────┘ │            ┌──────────── 1620 ─────────────┐             │
│ ┌ nav flex-1 ───┐ │            │                               │             │
│ │ 8 items       │ │            │  page heading row             │             │
│ │ ── hr ──      │ │            │  (+ optional filter row)      │             │
│ │ 11 items      │ │            │                               │             │
│ │ ── hr ──      │ │            │  page body                    │             │
│ │ 3 items       │ │            │                               │             │
│ │ (scrolls)     │ │            └───────────────────────────────┘             │
│ └───────────────┘ │                                                          │
│ ┌ footer h 52 ──┐ │                                                          │
│ │ avatar + name │ │                                                          │
│ │ + bell        │ │                                                          │
│ └───────────────┘ │                                                          │
└───────────────────┴──────────────────────────────────────────────────────────┘
```

The top bar does **not** span the sidebar. It starts at x = sidebar width. The sidebar is the
full-height element; the top bar lives inside the right pane.

### 1.2 Sidebar internals

```
┌─ 287 ────────────────────────────────┐
│ pt 4                                 │
│ ┌ scope row  px 8  py 4   h 48 ─────┐│  segment 1: team / workspace
│ │ ┌ h 40 ─────────────────────────┐ ││
│ │ │ [av20] name        [pill] [v] │ ││  av 20 round, gap 8, name 14/500,
│ │ └───────────────────────────────┘ ││  pill 11px, chevron button 28x32
│ └───────────────────────────────────┘│
│ ┌ find row   px 8         h 36 ─────┐│
│ │ [icon 36] Find              [kbd] ││  ring 1px, radius 6, label gray-800
│ └───────────────────────────────────┘│
├──────────────────────────────────────┤  y=92
│ nav   overflow-y auto   pt 10  pb 8  │
│  px 8   flex-col   gap 1px           │
│  ┌ row h 36  radius 6  pl 2 ───────┐ │
│  │ [icon] Label                    │ │  14/400, gray-900; active bg gray-200
│  └─────────────────────────────────┘ │  + gray-1000, pitch 37 (36 + 1 gap)
│  ... 8 rows ...                      │
│  ── hr  h 1  my 4  bg gray-200 ──    │
│  ... 11 rows ...                     │
│  ── hr ──                            │
│  ... 3 rows ...                      │
├──────────────────────────────────────┤
│ footer  p 8   h 52                   │
│ ┌ h 36 pill ────────────┐ ┌ bell 24 ┐│
│ │ [av20] account name   │ │  (o)    ││
│ └───────────────────────┘ └─────────┘│
└──────────────────────────────────────┘
```

### 1.3 Top bar, team scope vs project scope

```
TEAM SCOPE
├ pl 16 ─────────────────┐   ┌──── centered ────┐   ┌───── pr 16 ┐
│  All projects      [v] │   │ [icon] / Overview│   │ [(:)] Agent│
└────────────────────────┘   └──────────────────┘   └────────────┘
   ^ scope segment 2            ^ page breadcrumb      ^ side chat

PROJECT SCOPE
├ pl 16 ──────────────────────────────────┐
│ [av16] <project>  [v] │ [<-]            │   (same centre and right cells)
└──────────────────────────────────────────┘
                    ^ divider + "Back to team view", both revealed on hover

SIDEBAR COLLAPSED (or 768..1023px)
├ pl 16 ────────────────────────────────────────┐
│ [=] │ [av16] <project>  [v] │ [<-]            │
└────────────────────────────────────────────────┘
   ^ "Open sidebar", then a 1px x 24px divider (gray-alpha-300, ml 8 mr 4)
```

### 1.4 Scope popover (identical shell for team and project)

```
   trigger row
   └──────────────────────────────┐
        8px gap below trigger
┌ 384 wide  radius 12  material-modal ──────────────┐
│ ┌ header  h 45  border-b gray-300 ───────────────┐│
│ │ [ input  h 40  px 16  14/400          ] [Esc] ││  placeholder "Find Team…"
│ └────────────────────────────────────────────────┘│              "Find Project…"
│ ┌ scroller  p 2   max ~300  overflow-y auto ─────┐│
│ │ ┌ list  p 4 ─────────────────────────────────┐ ││
│ │ │ row h 36  radius 6  px 8  gap 12           │ ││  data-index 0..n
│ │ │  [av16] name                               │ ││  roving selection,
│ │ │ row h 36 ...                               │ ││  bg gray-alpha-100
│ │ └────────────────────────────────────────────┘ ││
│ └────────────────────────────────────────────────┘│
│ ┌ footer  p 6  border-t gray-400 ────────────────┐│
│ │ [icon20] Create Team                          ││  team: 2 lines, row h 58
│ │          Collaborate with others...           ││  project: 1 line, row h 36
│ └────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────┘
```

### 1.5 Find palette

```
anchored over the sidebar find row (x 4, y 50), w 384, h 345 fixed
┌────────────────────────────────────────────────────┐
│ ┌ header h 49  border-b gray-300 ────────────────┐ │
│ │ [icon 48] [ input h 48  py 16  14/400 ] [Esc]  │ │  placeholder "Find"
│ └────────────────────────────────────────────────┘ │
│ ┌ body  h 296 (18.5rem)  overflow-y auto ────────┐ │
│ │ ┌ list p 4 ──────────────────────────────────┐ │ │
│ │ │ row h 48  radius 6                         │ │ │
│ │ │  [icon 44 slot]  title 13/400 (<strong>    │ │ │  <strong> marks the
│ │ │                  on matched substring)     │ │ │  matched substring
│ │ │                  subtitle 13/400 gray-900  │ │ │
│ │ └────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
no section headings, no footer hint bar, flat result list
```

### 1.6 Settings: sidebar pane swap, not a second nav column

```
BEFORE (any page)                    AFTER (/settings/*)
┌ sidebar ────────┐                  ┌ sidebar ────────┐
│ header          │                  │ header          │
│ ┌ nav ────────┐ │                  │ ┌ nav ────────┐ │
│ │ Overview    │ │   click Settings │ │ [<] Settings│ │  h 40 pane header,
│ │ Deployments │ │  ───────────►    │ │ ───────────  │ │  title centered
│ │ ...         │ │                  │ │ General     │ │  19 sub-items,
│ │ Settings    │ │                  │ │ Build and…  │ │  pl 10, 14/500
│ │             │ │                  │ │ ...         │ │
│ └─────────────┘ │                  │ └─────────────┘ │
└─────────────────┘                  └─────────────────┘
outgoing pane: absolute, opacity 0, blur(2px), translate -8px
transition: transform, translate, opacity, filter   200ms ease
content column narrows to the "compact" 914px track
```

### 1.7 List page

```
┌ content track 1620 ────────────────────────────────────────────┐
│ pt 16 (inner p 16/24)                                          │
│ ┌ heading block  pt 16 pb 16  -mt 16   h 112 ─────────────────┐│
│ │ ┌ gap 16 ─────────────────────────────────────────────────┐ ││
│ │ │ row h 32:  H1 24/600 ls -0.96          [icon btn 36]    │ ││
│ │ │ row h 32:  [Add Filter] [Facet: value] [Facet: value]   │ ││  chips h 32,
│ │ └─────────────────────────────────────────────────────────┘ ││  gap 8, wrap
│ └──────────────────────────────────────────────────────────────┘│
│ ┌ table  radius 6  1dp border gray-alpha-400 ─────────────────┐ │
│ │ row h 48  px 12  bg background-100  border-b 1dp            │ │
│ │ row h 48                                                    │ │
│ │ ...                                                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.8 Empty state

```
┌ full content width  radius 6  1dp border gray-200  p 32/16 ────┐
│                          gap 24                                │
│                    ┌ gap 12, centered ┐                        │
│                    │   [ tile 60x60 ] │  radius 12             │
│                    │   gap 8          │                        │
│                    │   title 20/600   │  ls -0.4               │
│                    │   body  14/400   │  gray-900, centered,   │
│                    └──────────────────┘  max ~474 wide         │
│                                                                │
│                    ┌ options block, w 820, gap 12 ┐            │
│                    │  card  title 14/600          │            │
│                    │        body  13/400 gray-900 │            │
│                    │        [Create]              │            │
│                    └──────────────────────────────┘            │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Global chrome

### 2.1 Top bar

| property | value |
|---|---|
| height | 56px (`h-14`) |
| position | `sticky top-0`, `z-index: 50` |
| layout | CSS grid, `grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]`, `gap: 8px`, `items-center` |
| measured columns | 560.4 / 1120.8 / 560.4 at a 2258px pane |
| background | `background-200` (pure black in dark) at `md` and up; `background-100` below `md` |
| separation | `border-bottom`, 1 device pixel (computes to 0.667px at dpr 1.5), colour `rgb(26,26,26)` |
| shadow | none. The separation is a border, not a ring |
| left cell padding | `padding-left: 16px` |
| right cell padding | `padding-right: 16px`, `gap: 4px`, `justify-self: end` |
| spans the sidebar | no |

Left cell (`z-10 flex min-w-0 items-center overflow-hidden pl-4`) contains, in order:

1. Sidebar toggle group, hidden at `lg` unless `html.sidebar-collapsed`: `button[aria-label="Open sidebar"]` then a 1px x 24px divider (`bg-gray-alpha-300`, `ml 8`, `mr 4`).
2. Scope segment 2 (see section 3), capped at `max-w-[clamp(30cqw,36cqw,44cqw)]` of the bar container.

Centre cell is `nav[aria-label="Breadcrumb"]`, `justify-center`, and holds the page breadcrumb
described in 2.2.

Right cell holds a single control in this account: a "Toggle side chat" button labelled Agent,
88x32, radius 6, with an animated 20px dot-matrix glyph. There is **no** help, changelog,
notification or avatar control in the top bar. Those moved: notifications and the account menu are
in the sidebar footer, help/changelog/docs are inside the account menu.

### 2.2 The centered breadcrumb

Not a scope switcher. Structure, left to right:

| part | value |
|---|---|
| icon group | `hidden md:flex shrink-0 items-center gap-2 pr-2.5`, w 50, h 24 |
| page icon | 24px slot, 16px glyph, colour gray-700 |
| separator | 16x16 inline SVG slash, colour `rgba(255,255,255,0.14)` (gray-alpha-300) |
| page title | `text-heading-14`: 14px / 500, line-height 20, letter-spacing -0.28px, gray-1000 |
| gap between title parts | 2px (`gap-0.5`) |

A duplicate copy of the title is rendered `absolute invisible` next to it. That is a width
measuring probe for the enter/exit animation (`motion-safe:animate-in fade-in`). The icon group is
hidden when `html.route-header-title-visible` is set, i.e. the breadcrumb only shows the icon and
slash when the page's own `h1` is scrolled out of view.

### 2.3 Vercel mark

There is no Vercel logo in the top bar and none in the sidebar header. The team avatar occupies
that slot. The mark only appears on marketing and account pages outside the dashboard shell.

### 2.4 Sidebar

| property | value |
|---|---|
| width | 287px (`--sidebar-width`), 286px content + 1dp right hairline `rgb(26,26,26)` |
| position | `fixed` at `lg`; `md:left-0 md:top-0 md:h-screen` |
| z-index | `--header-zindex` + 1 = 76 (top bar is 50) |
| background | `background-200` on the shell, `background-100` on the scrolling nav |
| header height | 92px = pt 4 + scope row 48 + gap 4 + find row 36 |
| nav padding | `padding: 10px 0 8px`, items in a `px-2` column with `gap: 1px` |
| footer | `section` + `div.p-2`, h 52 |
| responsive | hidden below `md` (drawer), hidden `md`..`lg` unless opened, fixed at `lg` |

Sidebar nav row:

| property | value |
|---|---|
| height | 36px, pitch 37px (36 + 1px gap) |
| width | 270px (286 - 2 x 8) |
| radius | 6px |
| padding-left | 2px on the row; the icon sits in a 36px square slot |
| type | 14px / 400 |
| idle colour | gray-900 `rgb(161,161,161)` |
| active | `background: gray-200 #1f1f1f`, colour gray-1000 `#ededed`. No left bar, no underline |
| group separator | `hr`, h 1px, `margin: 4px 0`, `bg-gray-200`, full 270px width |

Sidebar footer row: 20px round avatar, gap 8, account name 14/400, a 24px circular button with a
1px `gray-alpha-400` border, then a 24px notification bell with an unseen indicator. The account
row is a `button[aria-expanded]` opening a menu containing Account Settings, Home Page, Changelog,
Help, Docs, and a status link.

---

## 3. The scope switcher

Vercel splits scope across two triggers that never appear in the same container.

| segment | lives in | trigger shape | opens |
|---|---|---|---|
| 1. team / personal account | sidebar header, row 1 | 20px round avatar + name (14/500) + plan pill + chevron | team switcher popover |
| 2. project | top bar, left cell | 16px rounded-6 avatar + name (14/500) + chevron | project switcher popover |

There is no visible "/" between them, because they are in different regions. Segment 2 reads
"All projects" when no project is selected.

### 3.1 Trigger anatomy

| part | segment 1 (sidebar) | segment 2 (top bar) |
|---|---|---|
| container | `h-10` row inside `py-1 px-2` | `flex items-center rounded-md` |
| link area | `a`, padding `8px 4px 8px 10px`, `gap: 8px` | `a`, `gap: 8px` |
| avatar | 20px, `border-radius: 50%` | 16px, `border-radius: 6px` |
| label | 14px / 500, `truncate` | 14px / 500, `truncate`, `capitalize` at team scope |
| trailing badge | plan pill, 11px / 500, `py 2 px 8`, fully rounded | none |
| chevron | separate `button`, 28x32, `px-1.5` grid, 16px glyph, colour gray-900, hover gray-1000 | same, 28x32 |
| extra, project scope only | n/a | 1px x 24px divider + `a[aria-label="Back to team view"]` 28x32, `opacity-0 group-hover:opacity-100` |

The avatar in segment 1 is the team avatar (an `img` inside `span[data-geist-avatar]`), not the
user avatar. The user avatar is separately present in the sidebar footer.

The chevron is a **separate button from the link**. Clicking the name navigates; clicking the
chevron opens the switcher. Copy that split, it is the reason the row feels fast.

### 3.2 Popover

Both segments open the same shell.

| property | value |
|---|---|
| width | 384px (`md:w-96`) |
| radius | 12px (`material-modal`) |
| background | `background-100` `#0a0a0a` |
| shadow | `--ds-shadow-modal`: `0 0 0 1px #ffffff25` ring plus `0 1px 1px`, `0 4px 8px -4px`, `0 16px 24px -8px` |
| ring implementation | a sibling `div.absolute.-inset-px` carries the shadow, so the ring sits outside the content box |
| positioning | anchored to the **row**, not the chevron: left edge aligns with the trigger row's left edge (x 8 in the sidebar, x 303 in the top bar), top = trigger bottom + 8px |
| role | `role="dialog"` inside a fixed wrapper with a `transform` offset |
| mobile | `h-full w-full`, i.e. it becomes a full-screen sheet below `md` |

Internal structure, top to bottom:

| block | value |
|---|---|
| search header | `label`, h 45, `border-bottom` gray-300, `gap: 10px`, `py-0.5` |
| search input | h 40, `padding: 8px 16px`, 14px / 400, transparent background, no border |
| placeholder | "Find Team…" / "Find Project…" |
| header trailing | 48x40 button holding a `kbd` "Esc": h 20, radius 4, 12px text, `px 4`, background-100 with a ring |
| list scroller | `p-0.5` (2px), `overflow-y: auto`, `overscroll-contain`, max height about 300px |
| list container | `flex flex-col`, `p-1` (4px), no gap |
| row | h 36, w 372, radius 6, `padding: 0 8px`, `gap: 12px` |
| row content | 20px icon slot containing a 16px avatar (radius 4), then the name in `text-label-14` |
| row right hint | none. No keyboard hint, no chevron, no metadata on the row |
| footer | `p-1.5` (6px), `border-top` gray-400 |
| footer row (project) | single line, h 36, same anatomy as a list row |
| footer row (team) | two lines, h 48 content in a 58px row, `padding: 10px 8px`, `gap: 12px`: title 14/500 gray-1000, description 13/400 gray-900, `gap-0.5` between them |

### 3.3 Behaviour

| question | answer |
|---|---|
| searchable | yes, filters the list live |
| what is focused on open | the search input, immediately |
| keyboard navigable | yes. Arrow keys move a roving selection; the selected row takes `background: rgba(255,255,255,0.06)` (gray-alpha-100) |
| does the footer action join the roving index | yes. The footer "Create" row carries the next `data-index` after the last list row |
| section headings | none. The list is flat, no "Teams" / "Recent" groups |
| empty state | a centred `min-h-[196px]` grid with a single gray-900 line, e.g. "No projects, yet!" |
| loading state | same centred slot, e.g. "Loading teams..." |
| close | Esc, and the header shows the `kbd` for it |

Truncation trick worth copying: each row name renders three stacked spans in an
`inline-grid` (two invisible measuring copies plus the visible one) so the label can truncate
without the row reflowing.

---

## 4. Contextual navigation

**There is no tab row.** Nothing in the DOM under the top bar is a `tablist`, and a scan for any
horizontal nav strip between the top bar and the content returns nothing at either scope.

Contextual navigation is the sidebar list, and its **shape does not change with scope**. Same 22
items, same 3 groups, same order. Only the href segment changes.

| # | group | item | team href | project href |
|---|---|---|---|---|
| 1 | primary | Projects / Overview | `/<team>` | `/<team>/<project>` |
| 2 | primary | Deployments | `/<team>/~/deployments` | `/<team>/<project>/deployments` |
| 3 | primary | Logs | `/~/logs` | `/<project>/logs` |
| 4 | primary | Analytics | `/~/analytics` | `/<project>/analytics` |
| 5 | primary | Speed Insights | `/~/speed-insights` | `/<project>/speed-insights` |
| 6 | primary | Observability | `/~/observability` | `/<project>/observability` |
| 7 | primary | Firewall | `/~/firewall` | `/<project>/firewall` |
| 8 | primary | CDN | `/~/cdn` | `/<project>/cdn` |
| 9 | resources | Environment Variables | `/~/settings/environment-variables` | `/<project>/settings/environment-variables` |
| 10 | resources | Domains | `/~/domains` | `/<project>/settings/domains` |
| 11 | resources | Connect | `/~/connect` | `/<project>/connect` |
| 12 | resources | Integrations | `/~/integrations` | `/<project>/settings/integrations` |
| 13 | resources | Storage | `/~/stores` | `/<project>/stores` |
| 14 | resources | Flags | `/~/experimentation/collections` | `/<project>/flags` |
| 15 | resources | Agent | `/~/agent` | `/<project>/agent` |
| 16 | resources | AI Gateway | `/~/ai-gateway` | `/<project>/ai-gateway` |
| 17 | resources | Sandboxes | `/~/sandboxes` | `/<project>/sandboxes` |
| 18 | resources | Workflows | `/~/workflows` | `/<project>/workflows` |
| 19 | resources | Images | `/~/images` | `/<project>/images` |
| 20 | account | Usage | `/~/usage` | `/<project>/usage` |
| 21 | account | Support | `/~/support` | `/<project>/support` |
| 22 | account | Settings | `/~/settings` | `/<project>/settings` |

Only item 1 renames (Projects at team scope, Overview at project scope). The `~` segment is
Vercel's literal "team-wide, all projects" placeholder in the URL.

A second, shorter nav variant is present in the DOM but not rendered at this viewport: 12 items
grouped as Projects, Deployments, Observability, Security, CDN, Compute | Configuration,
Integrations, AI Gateway | Billing, Support, Settings. That is the condensed sidebar. Treat it as
evidence that they keep two densities of the same list rather than two different lists.

| tab-row property the brief asked for | answer |
|---|---|
| active treatment | filled row (`bg gray-200`), not an underline |
| height | 36px rows |
| gap | 1px |
| font size | 14px / 400 (sub-items 14 / 500) |
| horizontal overflow | not applicable. The list scrolls **vertically** inside the sidebar |

---

## 5. Page layout

| property | value |
|---|---|
| grid | `grid-template-columns: minmax(24px, 1fr) minmax(0, W) minmax(24px, 1fr)` |
| W standard | 1620px (`--dashboard-layout-width-standard`) |
| W compact | 914px (`--dashboard-layout-width-compact`), used by Settings |
| W unbounded | `calc(100% - 48px)` |
| horizontal margin | 24px (`--geist-page-margin`) |
| non-dashboard pages | `--geist-page-width: 1200px` |
| vertical padding, dashboard sections | `padding: 24px 0` (`paddingSm`); `paddingMd` 32, `paddingLg` 40 |
| list-page inner wrapper | `w-(--geist-page-width-with-margin)`, `padding: 16px 24px`, `mx-auto` |
| section background | `background-200` |

Breakpoints are **container queries** on the content pane, not viewport media queries. The class
prefixes are `@smd-page`, `@md-page`, `@lg-page`, `@xl-page`, plus `@max-lg-page`. This matters:
the layout responds to the pane width, so opening the side chat panel (which sets
`--omniagent-panel-width`) reflows the content as if the window had shrunk. Copy this. It is the
reason the sidebar and the agent panel can both take space without breaking the grid.

### Page heading composition

| variant | shape |
|---|---|
| list page | `flex-none flex flex-col pt-4 pb-4 -mt-4`, h 112, containing a `gap-4` column of a 32px title row and a 32px filter row |
| title row | `flex items-center justify-between gap-4 h-8 leading-[2rem]` |
| `h1` | `text-heading-24`: 24px / 600, line-height 32, letter-spacing -0.96px |
| actions | right-aligned in the same row; icon buttons 36x36 radius 6, primary button h 36 `px 10` with a gray-1000 fill |
| filter row | horizontal scroller, `flex-wrap gap-2`, chips h 32 (`Add Filter`, then one chip per active facet) |
| dashboard page | no `h1`. A `gap-6` column: a 36px toolbar row, then the body |

### Body composition, team overview

`flex w-full flex-col gap-4 @smd-page:flex-row @smd-page:gap-6`

| column | width |
|---|---|
| rail | `@smd-page:w-[320px] @lg-page:w-[404px]` |
| main | `min-w-0 flex-1` |

### Body composition, project overview

`mt-4 grid grid-cols-1 gap-4 @lg-page:grid-cols-3`, cards `h-[240px]`, `material-small`.

### Toolbar row (team projects)

`flex flex-row items-center gap-2`, h 36:

| control | size |
|---|---|
| search input | flex-1, h 36, radius 6, ring `0 0 0 1px var(--ds-gray-alpha-400)`, placeholder mentions the `/` shortcut |
| filter/sort | 36x36 icon button, radius 6, background-100 |
| view toggle | 72x36 segmented control, `p-1`, radius 6, ring, two icon buttons (grid, list) |
| primary action | h 36, w about 115, `px 10`, fill gray-1000, radius 6 |

---

## 6. Settings

Settings does **not** get a left nav column next to the content. It reuses the one sidebar.

| property | value |
|---|---|
| mechanism | the sidebar nav swaps panes. Root pane slides out, settings pane slides in |
| outgoing pane | `position: absolute`, `opacity: 0`, `filter: blur(2px)`, translated -8px |
| incoming pane | `position: static`, `opacity: 1`, no filter |
| transition | `transition-[transform,translate,opacity,filter] 200ms ease` |
| pane header | `w-full px-2 pb-1`, h 40. A 36px button: 36px back-chevron slot, centred title (`text-label-14`, 14/500, gray-900), 36px spacer to keep the title optically centred |
| sub-item rows | h 36, pitch 37, radius 6, `padding-left: 10px`, no icon |
| sub-item type | `text-heading-14`: 14px / **500** (top-level rows are 400). Idle gray-900, active `bg gray-200` + gray-1000 |
| item count, project settings | 19 |
| parent row while open | stays visible in the root pane and is also highlighted |
| content width | narrows from 1620 to the 914px compact track (`dashboard-width-compact`) |
| content padding | `px-6` on the container, `my-6` on the column |

Project settings items observed, in order: General, Build and Deployment, Environments, Git,
Deployment Protection, Passport, Functions, Sandboxes, Cron Jobs, Microfrontends, Project Members,
Webhooks, Drains, Alerts, Tracing, Security, Networking, Activity, Advanced.

---

## 7. Command palette

Vercel no longer has a centred modal palette. It has **Find**, which expands the sidebar search
row in place into the same 384px popover shell used by the scope switchers.

| property | value |
|---|---|
| entry point | the sidebar find row, which morphs; the row already renders as an input shell (`absolute inset-0 rounded-full bg-background-100 outline outline-1`) |
| keyboard hint on the row | a single `kbd`, not a chord |
| position | anchored over the find row, x 4, y 50. Not centred, not full-screen |
| width | 384px |
| height | 345px fixed (49 header + 296 body), independent of result count |
| header | h 49, `border-bottom` gray-300, 48px leading icon slot, input h 48 `py-4 pl-0 pr-4` 14/400, 48px trailing button with `kbd` "Esc" |
| body | `h-[18.5rem]` = 296px, `overflow-y: auto` |
| list | `flex flex-col p-1` |
| row | h 48, radius 6, roving `data-index` |
| row anatomy | 44px icon slot (16px glyph), then a two-line column: title `text-label-13` 13/400 with a `<strong>` (500) wrapping the matched substring, subtitle `text-label-13` 13/400 gray-900 |
| section headings | none |
| footer hints | none |
| mixed result kinds | yes. Navigation results are `a`, actions are `button` in the same list; an action row wraps the query in curly quotes |

I did not press Enter on any result, so I did not observe what a run command looks like after
selection.

---

## 8. Lists, rows and empty states

### 8.1 Table-style list (deployments)

| property | value |
|---|---|
| container | a CSS grid with a fixed column template, e.g. `697.8px 136px 100px 80px 348.9px 128px 32px`, `column-gap: 16px` |
| container chrome | `border-radius: 6px`, 1dp border `gray-alpha-400` |
| row | h 48, `padding: 0 12px`, `background: background-100` |
| row separator | `border-bottom` 1dp `rgba(255,255,255,0.14)` |
| first row | `border-radius: 4px 4px 0 0` |
| row pitch | 48, no gap |
| below `@smd-page` | the grid collapses to `flex flex-col gap-3` and each row becomes a card |

### 8.2 Card-style list (projects)

| property | value |
|---|---|
| container | `ul.material-small`: background-100, `--ds-shadow-border-small` ring, radius 6, `divide-y` |
| row | `li`, `padding: 16px`, `gap: 12px`, h 75 (74 + 1px divider), `@xl-page:flex-row` |
| left block | `mr-24 flex gap-4 @xl-page:w-[calc(25%+48px)]`: avatar plus a name/subtitle stack |
| middle block | `order-2 flex-1 flex-col gap-0.5`, secondary metadata |
| right block | `absolute right-4 top-[21px] flex gap-4`, about 48px of icon actions |
| section label above | `flex h-8 items-center px-1.5 justify-between`, label `text-label-14` 14/500 gray-1000 |
| gap label to list | 12px (`gap-3` at `@smd-page`) |

### 8.3 Empty state

| property | value |
|---|---|
| container | full content width, radius 6, 1dp border gray-200, `padding: 32px 16px`, `gap: 24px`, centred both axes |
| icon tile | 60x60, radius 12 |
| gap tile to text | 12px |
| title | `text-heading-20`: 20px / 600, line-height 26, letter-spacing -0.4 |
| body | `text-copy-14`: 14px / 400, gray-900, `text-align: center`, block max about 474px |
| gap title to body | 8px |
| optional CTA block | a separate 820px column below, `gap: 12px`, each option a card with a 14/600 title, 13/400 gray-900 body, and its own button |

### 8.4 Popover empty state

Centred `min-h-[196px]` grid, one line of gray-900 text, no icon, no CTA. Different from the page
empty state above, and much lighter. Worth matching: popovers get a line, pages get the tile.

---

## 9. Type and hairline notes

Class-to-value mapping observed, useful because the class names show up everywhere above:

| class | size / weight | line-height | letter-spacing |
|---|---|---|---|
| `text-heading-24` | 24 / 600 | 32 | -0.96 |
| `text-heading-20` | 20 / 600 | 26 | -0.4 |
| `text-heading-14` | 14 / 600 (500 when paired with `font-medium`) | 20 | -0.28 |
| `text-label-14` | 14 / 400 | 20 | normal |
| `text-label-13` | 13 / 400 | 16 | normal |
| `text-copy-14` | 14 / 400 | 20 | normal |
| `text-copy-13` | 13 / 400 | 18 | normal |
| `text-button-14` | 14 / 500 | 24 | normal |

Every border in the chrome computes to 0.667px at dpr 1.5, that is one **device** pixel, not one
CSS pixel. Reproduce it as a hairline that thins on high-density displays rather than a fixed 1px
rule, otherwise our chrome will read heavier than theirs at 150% and 200% scaling.

Materials:

| class | definition |
|---|---|
| `material-modal` | `background-100`, `--ds-shadow-modal`, radius 12 |
| `material-small` | `background-100`, `--ds-shadow-border-small`, radius 6 |

Both are applied to a `-inset-px` sibling in popovers so the ring paints outside the content.

---

## 10. Mapping onto our hierarchy

Ours: `workspace > project > dashboard(board) > sources`. Theirs: `team > project > sections`.
They have two scope levels, we have three or four. The first two map cleanly. The rest does not,
and this section says where the choice actually is.

### 10.1 Clean mappings

| ours | theirs | verdict |
|---|---|---|
| workspace | team | segment 1, sidebar header. Avatar + name + chevron. Chevron opens a 384px popover with a search field, a flat list, and a "Create workspace" footer row |
| project | project | segment 2, top bar left cell. Reads "All projects" at workspace scope. Chevron opens the same popover shell |
| account | account | sidebar footer, plus a bell |
| project settings | project settings | a slide-in pane in the sidebar, content narrows to the compact track |

### 10.2 Scope switcher segments, concrete

Build exactly two switcher triggers:

1. **Sidebar header, row 1.** Workspace. 20px round avatar, name at 14/500, optional pill,
   separate 28x32 chevron button. Row 40px inside a 48px `px-2 py-1` band.
2. **Top bar, left cell.** Project. 16px rounded-6 avatar, name at 14/500, separate 28x32 chevron,
   plus a hover-revealed divider and "Back to workspace" button once a project is selected.

Both open the identical popover: 384px, radius 12, ring plus elevation, header search focused on
open, flat 36px rows with a 16px avatar, roving arrow-key selection at `rgba(255,255,255,0.06)`,
Esc chip in the header, and a footer create row that participates in the same roving index.

Do not build a single combined `workspace / project` breadcrumb. Vercel deliberately split it, and
the split is what lets the project name stay readable while the workspace name stays pinned.

### 10.3 The tab row question

Vercel deleted the tab row. Two options for us:

- **Option A, no tab row.** Contextual navigation lives entirely in the sidebar, and the sidebar
  list is parameterised by the current scope, exactly as theirs is. Same items at workspace and
  project scope, only the href prefix changes. Deeper levels (settings) push a pane.
- **Option B, keep a tab row for the level below project.** Sidebar carries workspace and project
  navigation; a tab row under the top bar carries board-level sections.

Option A is what the observed design does and it scales to more items without horizontal
overflow. Option B is a real choice only if boards have several sibling sections. If a board has
one view, a tab row with one tab is noise.

### 10.4 Where boards go, genuinely ambiguous

Vercel has no third scope level, so there is nothing to copy. Three viable shapes:

- **B1. Boards as sidebar items under project scope.** The sidebar's primary group becomes the
  board list, one 36px row per board, with a "New board" row or a header action. Sources then live
  as a fixed sidebar item alongside boards, or one group down.
  Cost: the board list and the fixed project sections compete for the same column, and a project
  with many boards pushes the fixed items below the fold.

- **B2. Boards as a third scope segment in the top bar.** Top bar left cell becomes
  `[project v] [board v]`, and the sidebar shows board-level sections. This is the only shape that
  gets a searchable board switcher for free, which matters if a project can hold many boards.
  Cost: it invents a segment Vercel does not have, and the top bar left cell is already capped at
  about 36% of the bar width. Two segments plus avatars will truncate hard on narrow panes.

- **B3. Boards as the project's index page.** Project scope opens on a board list (their
  `/<team>` is exactly this: the workspace's index is the project list). A board is then a page,
  not a scope, and the sidebar stays project-level throughout.
  Cost: no fast board-to-board switch without going back to the index.

B3 is the closest structural analogue to what they actually do, since their project list is a page
and not a switcher, and the switcher is an accelerator layered on top. B2 is the better fit if
boards are the thing users live inside all day. Pick on that basis, not on aesthetics.

### 10.5 Where sources go, genuinely ambiguous

Depends on whether a source belongs to the project or to the board.

- **If sources are project-scoped** (a board reads from a shared pool): sources is a sidebar item
  at project scope, in the second group, next to whatever our equivalents of Environment Variables
  and Integrations are. That is exactly where Vercel puts project-level resources.
- **If sources are board-scoped**: sources is a section inside the board, reached from the board
  page, and it is a list page with the 48px row treatment.
- **If both** (project-level pool, board-level selection): put the pool at project scope in the
  sidebar, and put the selection inline in the board as a filter chip row, matching their
  `Add Filter` + facet chip pattern at 32px.

I cannot resolve this from Vercel. It is a question about our domain, not about their layout.

### 10.6 Suggested sidebar contents, if we take option A

| scope | group | items |
|---|---|---|
| workspace | primary | Projects (index), plus any cross-project views we have |
| workspace | resources | Sources (if project-scoped, the workspace view is the union), Integrations, Members |
| workspace | account | Usage, Support, Settings |
| project | primary | Overview, Boards, plus per-project views |
| project | resources | Sources, Integrations |
| project | account | Usage, Support, Settings |

Same three groups, same two `hr` separators, same 36px rows, same 1px gap. The rename of item 1
from "Projects" to "Overview" when scope narrows is worth copying; it keeps the row count stable.

---

## 11. Not observed

Things I could not check without a state-changing click, plus one load failure:

| item | why |
|---|---|
| team switcher list rows | the popover stayed on "Loading teams..." for the whole session. The shell, header, footer and empty-state slot were measured; the populated row anatomy was not. Assume it matches the project rows plus a right-hand hint if any |
| section headings in a populated team switcher | same reason. The project switcher has none, so probably none |
| create-team and create-project flows | the footer rows are the only entry points and clicking them creates or navigates into a creation flow |
| what a Find result does on Enter | selecting a row navigates or runs an action |
| the condensed 12-item sidebar variant, rendered | it exists in the DOM but does not render at this viewport. Measured only as markup |
| the collapsed-sidebar top bar, live | the toggle button and its divider were measured from the DOM at 0x0. Clicking it would change a persisted UI setting |
| the notification panel, the account menu panel, the filter/sort popover, the "Add New" menu | all are triggered by buttons whose panels I did not open, either because the trigger also mutates state or because the panel was not needed for structure |
| light theme | the session is in dark. All colours above are dark-theme values |
| narrow viewports | measured at one pane width. Breakpoint names are recorded from class prefixes, not from resizing |
