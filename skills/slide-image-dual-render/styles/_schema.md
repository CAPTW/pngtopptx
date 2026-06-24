# Style dimension vocabulary

A profile is NOT one opaque "look." It is a set of **independent dimensions** that get
*composed*. Classifying each dimension separately (small answer space → reproducible) and
assembling the config beats matching one monolithic profile: it covers far more of the design
space with fewer library entries, and keeps every decision narrow.

When you classify an input slide, you answer each dimension below, then either (a) snap to the
closest library profile if all dimensions agree, or (b) compose a profile from per-dimension
choices, overriding the closest library entry where dimensions diverge.

| dimension | values seen so far | notes |
|---|---|---|
| `background.type` | `gradient-dark` · `light` | the single strongest idiom signal |
| `background.texture` | `blueprint-faint` · `dots-faint+waves` · `none` | decorative; low fidelity weight |
| `colorTemp` | `cool` · `warm` · `neutral` | |
| `hero` | `photoreal-crop` · `photo-diagonal-crop` · `none` | continuous-tone ⇒ ALWAYS crop, never vectorize |
| `geometry` | `rounded-bordered-panels` · `diagonal-cut + soft-shadow-cards` | panel + cut grammar |
| `panel.fill` | translucent-dark · solid-white · solid-navy | per `components.{default,alt,warn}` |
| `panel.shadow` | `none` · soft drop | light idioms use shadow; dark idioms use border |
| `icon.style` | `line` · `filled-navy` | mixed decks declare per-component |
| `header.style` | `breadcrumb` · `titlebar` | breadcrumb=dark technical, titlebar=corporate |
| `accent.stepStyle` | `numeral` · `circle-fill` | colored numeral (dark) vs filled circle (light) |
| `accent.devices` | chevron-roadmap · diagonal-cut · hexagon-mesh · wave-lines · orange-tick · numbered-circles | the recognizable "signature" marks |
| `footer.style` | `thin-band` (+tag pill) · `wave-silhouette` | |

## Palette roles (semantic, not literal)
Always store palette by **role**, never by raw position, so the renderer is colorblind to the
specific hue:

- `bg`, `ink`, `inkMuted` — surface + text.
- `info` / `blue` / `teal` — primary informational accent.
- `gold` / `orange` — caution / highlight.
- `danger` — alarm / emergency.
- `ok` — pass / in-range.
- `panelFill`, `panelBorder`, plus `cardFill`/`darkPanel` for the contrast component.

## Two axes that actually predict quality (NOT density)
1. **style-fit** — how close the input idiom is to a library entry / the renderer's primitives.
2. **extraction-ambiguity** — gradients, soft shadows, text-on-image, subtle color differences
   are *harder to read* than flat colors and crisp borders, regardless of how much content there is.

A profile match handles axis 1. For axis 2, see `scripts/classify.md` (zoom + explicit
cue extraction) and crop-fallback for genuinely ambiguous continuous-tone regions.

## Generic vs specific (the fidelity rule)
A library profile is the *generic form* of an idiom. Snapping everything to it loses the input's
identity (its exact brand teal, its exact radius). So:

> **The library picks the GRAMMAR (which primitives, which layout idiom). You still EXTRACT the
> specific tokens (exact colors, radii, sizes) from the input and override the profile defaults.**

Structural consistency from the profile + specific fidelity from extraction.
