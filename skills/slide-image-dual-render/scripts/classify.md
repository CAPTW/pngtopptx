# Style classification (run once per input image)

This is the step that kills style-variance: convert open-ended style **authoring** into a
constrained **classification + frozen-profile lookup**. Do this per image, in its own context.

In the local environment parallel worker mode, the mapper writes its result to
`work/slideXX/profile_override.json` and optional measured evidence to `work/slideXX/measurements.json`.
It must not edit shared `styles/*.json`; adding or changing a shared profile is an integrator or
main-thread decision.

## Step 1 — characterize each dimension
`view` the image. For each row in `styles/_schema.md`, write down the observed value. Keep it to
the allowed vocabulary; if a dimension is genuinely new, name it and flag it (it may need a new
profile or a new renderer primitive).

Output a small block, e.g.:

```
background.type   = gradient-dark
hero              = photoreal-crop (ship deck + anatomy, top-right)
geometry          = rounded-bordered-panels
icon.style        = line
header.style      = breadcrumb
accent.stepStyle  = numeral
accent.devices    = [chevron-roadmap, colored-numerals]
palette.info      ~ #33A9E0   palette.gold ~ #E8B23C   palette.danger ~ #E5484D
```

## Step 2 — match to the library, WITH a confidence
Compare against each profile in `styles/`. Score how many dimensions agree.

- **High confidence** (background.type + geometry + header.style + stepStyle all agree): use that
  profile as the base.
- **Partial**: use the closest profile but **compose** — override the diverging dimensions from
  your Step-1 read (e.g. base `corporate-light` but `icon.style=line` because this deck uses line
  icons in its stat band, like sample 8).
- **Low / no confident match (OOD)**: DO NOT force the nearest profile. A whole wrong design system
  applied confidently is worse than an honest open extraction. Take the fallback (Step 4).

State the decision explicitly: `MATCH clinical-dark (high)` or `MATCH corporate-light + override[icon.style=line] (partial)` or `NO MATCH → fallback`.

## Step 3 — extract the SPECIFIC tokens
Even on a high-confidence match, read the input's *actual* values and override the profile
defaults: exact title KR/EN colors, exact accent hexes, exact corner radius, exact panel fill.
The profile gives grammar; these give fidelity. Write them into a per-slide profile override.

Recommended `profile_override.json` shape:

```json
{
  "profileId": "clinical-dark",
  "confidence": "high",
  "decision": "MATCH clinical-dark (high)",
  "overrides": {
    "palette": {
      "info": "33A9E0",
      "gold": "E8B23C"
    },
    "geometry": {
      "panelRadiusPx": 18
    }
  },
  "exceptions": [
    {
      "region": "right hero",
      "component": "photoreal-crop",
      "notes": "crop; do not vectorize"
    }
  ]
}
```

## Step 4 — fallback path (only when Step 2 = NO MATCH)
Pick one, in order of preference:
1. **Open extraction** — characterize all dimensions from scratch into a one-off profile, run
   `preview.js` on it, eyeball, tune. (Higher variance — this is the regime we are trying to avoid,
   so prefer promoting it to a real library entry if the style recurs.)
2. **Crop-heavy** — if the slide is mostly photoreal/continuous-tone, crop the un-recreatable
   regions and rebuild only the chrome.
3. **Flag** — surface to the user: "this style isn't in the library; add a profile?" and stop,
   rather than guessing.

## Per-region note
Real slides blend idioms (a light deck with one dark hero panel; sample 8 = corporate-light chrome
+ a dark feature panel). Classify a **primary** style for the slide, then mark exception regions and
apply the matching `components.alt` / a per-region override. Do not force one whole-slide label.

## Why a confidence threshold is mandatory
The library is a **closed set**; inputs are an **open distribution**. An out-of-library style WILL
arrive. The threshold + fallback is the single thing that separates "robust" from "confidently
wrong." Never skip it.
