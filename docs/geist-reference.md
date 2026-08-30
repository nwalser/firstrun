# Geist reference

Values read out of the live Geist design system at `vercel.com/geist/colors` by enumerating the
custom properties in effect on `:root` in both themes, plus computed styles off real elements on
the page. This is measurement, not recollection. When the port and this file disagree, this file
is right.

Scope note: we reimplement the visual language from Vercel's published design documentation. We
do not copy their component source.

## Surfaces

Two background steps, and the naming is the opposite of what you would guess: `background-100` is
the RAISED surface (cards, popovers) and `background-200` is the page behind them.

| token | dark | light |
|---|---|---|
| `--ds-background-100` | `hsla(0,0%,4%,1)` #0a0a0a | `hsla(0,0%,100%,1)` #ffffff |
| `--ds-background-200` | `hsla(0,0%,0%,1)` #000000 | `hsla(0,0%,98%,1)` #fafafa |

**The dark page is pure black** and cards sit 4% above it. The separation between page and card is
tiny; the 1px ring is what actually separates them.

## Gray scale

| step | dark | light |
|---|---|---|
| 100 | `hsla(0,0%,10%,1)` | `hsla(0,0%,95%,1)` |
| 200 | `hsla(0,0%,12%,1)` | `hsla(0,0%,92%,1)` |
| 300 | `hsla(0,0%,16%,1)` | `hsla(0,0%,90%,1)` |
| 400 | `hsla(0,0%,18%,1)` | `hsla(0,0%,92%,1)` |
| 500 | `hsla(0,0%,27%,1)` | `hsla(0,0%,79%,1)` |
| 600 | `hsla(0,0%,53%,1)` | `hsla(0,0%,66%,1)` |
| 700 | `hsla(0,0%,56%,1)` | `hsla(0,0%,56%,1)` |
| 800 | `hsla(0,0%,49%,1)` | `hsla(0,0%,49%,1)` |
| 900 | `hsla(0,0%,63%,1)` | `hsla(0,0%,30%,1)` |
| 1000 | `hsla(0,0%,93%,1)` | `hsla(0,0%,9%,1)` |

The scale is NOT monotonic: 700 and 800 are identical across themes, and dark 800 (49%) is darker
than dark 700 (56%). Reproduce it as measured. Do not "fix" it into a smooth ramp.

Primary text is gray-1000: `#ededed` dark, `#171717` light.

## Gray alpha

Used for borders and hairlines, so a rule composites over whatever it sits on.

| step | dark | light |
|---|---|---|
| 100 | `#ffffff0f` | `#0000000d` |
| 200 | `#ffffff17` | `#00000014` |
| 300 | `#ffffff21` | `#0000001a` |
| 400 | `#ffffff24` | `#00000014` |
| 500 | `#ffffff3d` | `#00000036` |
| 600 | `#ffffff82` | `#00000057` |
| 700 | `#ffffff8a` | `#00000070` |
| 800 | `#ffffff78` | `#00000082` |
| 900 | `#ffffff9c` | `#000000b3` |
| 1000 | `#ffffffeb` | `#000000e8` |

**The default hairline is `gray-alpha-400`.**

## Accents

Only the steps a UI actually reaches for. Full scales are on the page if more are needed.

| | dark | light |
|---|---|---|
| blue 700 (action) | `hsla(212,100%,48%,1)` | `hsla(212,100%,48%,1)` |
| blue 900 (focus) | `hsla(210,100%,66%,1)` | `hsla(211,100%,42%,1)` |
| red 800 (destructive) | `hsla(358,69%,52%,1)` | `hsla(358,70%,52%,1)` |
| red 900 | `hsla(358,100%,69%,1)` | `hsla(358,66%,48%,1)` |
| amber 800 | `hsla(35,100%,52%,1)` | `hsla(35,100%,52%,1)` |
| green 800 | `hsla(132,43%,39%,1)` | `hsla(132,43%,39%,1)` |
| green 900 | `hsla(131,43%,57%,1)` | `hsla(133,50%,32%,1)` |

## Typography

Fonts, verbatim:

```
--font-sans: "Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
             "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans",
             "Helvetica Neue", sans-serif
--font-mono: "Geist Mono", Menlo, Monaco, Lucida Console, Liberation Mono,
             DejaVu Sans Mono, Bitstream Vera Sans Mono, Courier New, monospace
```

Size scale: `xs .75rem`, `sm .875rem`, `base 1rem`, `lg 1.125rem`, `xl 1.25rem`, with line heights
`1/.75`, `1.25/.875`, `1.5/1`, `1.75/1.125`, `1.75/1.25`.

**Negative tracking on anything large. This is the most recognisable single property of the look
and the thing a port usually misses.** Measured off real elements:

| element | size | line-height | weight | letter-spacing |
|---|---|---|---|---|
| h1 | 40px | 48px | 600 | `-2.4px` (-0.06em) |
| h2 | 24px | 32px | 600 | `-0.96px` (-0.04em) |
| lead p | 16px | 24px | 600 | `-0.32px` (-0.02em) |
| UI body / controls | 14px | 20px | 400 | normal |

**Application chrome is 14px, not 16px.** 16px is marketing prose.

## Controls

```
--geist-form-small-height: 32px   font .875rem  line-height .875rem
--geist-form-height:       36px   font .875rem  line-height 1.25rem
--geist-form-large-height: 40px   font 1rem     line-height 1.5rem
--ds-popover-row-height:   36px
```

A real button measured on the page: 32px tall, 14px/400, radius 4px, padding `0 8px`, 1px border.

## Radius

`--geist-radius: 6px`, `--ds-popover-row-radius: 6px`, marketing 8px. Buttons were observed at
4px. Use 6px for surfaces and popover rows, 4px for small controls and chips.

## Borders and shadows

Vercel separates with **1px rings drawn as box-shadow**, not with `border`, so the ring never
takes part in layout:

```
--ds-shadow-border-base:   0 0 0 1px #ffffff25
--ds-shadow-border-small:  0 0 0 1px #ffffff25, 0px 1px 2px #00000029
--ds-shadow-border-medium: 0 0 0 1px #ffffff25, 0px 2px 2px #00000052, 0px 8px 8px -8px #00000029
--ds-shadow-border-large:  0 0 0 1px #ffffff25, 0px 2px 2px #0000000a, 0px 8px 16px -4px #0000000a
--ds-shadow-menu:          0 0 0 1px #ffffff25, 0px 1px 1px #00000005,
                           0px 4px 8px -4px #0000000a, 0px 16px 24px -8px #0000000f
--ds-shadow-modal:         0 0 0 1px #ffffff25, 0px 1px 1px #00000005,
                           0px 8px 16px -4px #0000000a, 0px 24px 32px -8px #0000000f
--ds-shadow-tooltip:       0 0 0 1px #ffffff25, 0px 1px 1px #00000005, 0px 4px 8px #0000000a
--ds-shadow-small:         0px 1px 2px #00000029
--ds-shadow-medium:        0px 2px 2px #00000052, 0px 8px 8px -8px #00000029
```

Shadows are many-layered and very low alpha. Flat surfaces with a ring, lifted things get a soft
multi-layer shadow ON TOP of the ring.

## Focus

```
--ds-focus-color:       hsla(210,100%,66%,1)   (dark)   hsla(211,100%,42%,1) (light)
--ds-focus-ring:        0 0 0 2px <page bg>, 0 0 0 4px <focus color>
--ds-focus-ring-outline: 2px solid <focus color>
```

**Focus is BLUE, not monochrome**, and it is a two-stop ring: a 2px gap in the page colour, then
2px of blue. Our previous port used the foreground colour for the ring, which is wrong.

## Spacing

4px base (`--geist-space: 4px`), scaling 4/8/12/16/24/32/40/64/96/128/192/256. Standard gap 24px,
half 12px, quarter 8px.
