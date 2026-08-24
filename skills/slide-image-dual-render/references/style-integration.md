# Integration, orchestration, gates, and scope

## How a profile feeds the renderer  (implemented)
This renderer is **already wired** to read its design system from a profile — you don't re-improvise
it. `lib/profile.js` loads `DECK_PROFILE` (a `styles/*.json`) and maps it onto the kit's tokens; with
`DECK_PROFILE` unset it returns the original built-in palette **byte-for-byte**, so existing decks are
unchanged. The mapping (profile → renderer):

  - `typography.family` → `FONT` (first family name).
  - `palette.{bg,ink,inkMuted,info,gold,danger,ok,panelBorder,…}` → the kit `C` palette keys (same key
    names as before — only the values move with the profile).
  - `components.default.fill` (incl. translucent `rgba()`) → `C.panel`, alpha-composited over `palette.bg`.
  - `components.default.badge` / `accent.stepNumberColor` → `C.badge` / `C.chevOn`.
  - `components.warn.badge` / `icon.dangerColor` → `C.badgeRed` / `C.red`; `palette.ok` → `C.green`.
  - a few former in-helper literals (eyebrow, tag-pill fill, banner fill, chevron gold/danger chips,
    row divider) are now derived `C.*` keys, so they track the profile too (and a profile may override
    any of them by adding the matching key).
  - `dimensions.background.{type,from,to,base}` → `make_bg.py` (gradient-dark stops vs light base).
  - `palette` roles → `make_icons.js` recolor targets, keeping the color **names**
    (`white lblue cyan red green gold blue`) stable so `icon(s,concept,color,…)` calls never change.
  - light/dark detection → `build.js` page background behind the slides.

`preview.js` stays a **verification** renderer: it proves a profile renders and lets you tune tokens by
eye, independent of a full deck — use it in Phase 0.5 before committing a profile. To author a brand-new
idiom you still extend the kit primitives, not `preview.js`.

The rule holds: **profile = grammar/tokens; per-slide extraction = specific values + content;
deterministic code = composition.**

## Per-image isolation (the consistency architecture)
Quality collapses when many slides share one model context (attention dilution, template-collapse,
cross-slide averaging). So the unit of model work is **one image in a clean context**, never a big
batch. Two ways to run it in Codex Desktop or a compatible agentic coding environment:

- **Sub-agent fan-out** — dispatch one sub-task per image, each fresh, each loading: this SKILL +
  the frozen `styles/` library + that single image. Parallelizable; faster than one long context.
- **Driver loop** — a script that iterates images and invokes the per-image flow one at a time.

Cross-slide consistency does NOT come from the model remembering other slides — it comes from every
isolated run importing the **same frozen `styles/` profiles** and from deterministic merge rules
that assemble reviewed fragments in numeric slide order. Keep the organizational batch separate from
the model-context unit (1 image).

In Codex Desktop, prefer the explicit topology in `codex-subagents.md`:

- `slide_profile_mapper` writes `work/slideXX/profile_override.json`.
- `slide_reconstruct_worker` writes `work/slideXX/sN.fragment.js`, `crop_plan.json`, notes, and
  editability inventory.
- `slide_render_integrator` is the only fan-in role that writes shared files such as
  `lib/slides.js` or the integrated crop plan.
- `slide_qa_gate` writes `work/slideXX/qa_report.md` with targeted fixes from source-vs-render
  comparison.

Parallel workers must not directly edit `lib/slides.js`, `make_crops.py`, `build.js`, or
`styles/*.json`. This keeps one worker's local inference from corrupting the shared renderer or
another slide's work.

Install project-scoped agent templates with `scripts/install_codex_subagents.js` when you want Codex
App / Codex CLI to expose these roles as custom agents. Validate with
`scripts/validate_agent_work.js`, merge with `scripts/merge_fragments.js`, then render with the
unchanged `build.js` command surface.

## Gates (so drift cannot reach the output)
Run these as code/checks, not as "looks fine":
1. **Validate** — per-slide profile-override + content must conform to schema (required fields,
   color hexes parse, coords within canvas). Missing/garbage ⇒ fail loud, re-run that slide.
2. **Normalize** — force every *shared* property to the profile/grid value (snap coordinates,
   overwrite font/size/accent with profile tokens). Keep only the *specific extracted* overrides.
   This erases per-run styling jitter by construction.
3. **Diff** — render the slide, overlay on the source, emit a per-slide deviation number; below
   threshold ⇒ auto re-queue that one slide. Acceptance is per-slide, never batch-level.

For Codex sub-agent runs, each gate writes its result to `work/slideXX/qa_report.md`. A useful gate
report names the rendered artifact, the source image, major deviations, and exact fixes to apply to
`sN.fragment.js` or `crop_plan.json`. Do not accept a deck because the contact sheet looks good
overall; accept every slide individually.

## Scope & ceiling (v1, honest)
- v1 ships **two profiles** (`clinical-dark`, `corporate-light`) seeded from the 8 sample slides, the
  dimension schema, the classify+fallback procedure, and a working profile→specimen renderer.
- The renderer covers **chrome + the common primitives** (bg, header, title, three panel variants,
  step strip, palette, footer). Dense one-offs (the FRAMO gauges, the VOYAGE CARE LOG table, the
  anatomical hero) are **crops or bespoke primitives** you add as you hit them — not v1.
- The library only expresses styles the renderer has **primitives** for. A new idiom = new profile
  *and sometimes* a new primitive. Library growth has a sweet spot: too many near-identical entries
  makes the classifier flip at the boundary and reintroduces variance.
- Inputs are rasterized images, so extraction has irreducible model judgment — you can drive
  variance low, not to zero. If a source exists structured (original PPTX/markup), skip vision
  entirely and let code read+compose; that is the cheapest consistency of all.

## Adding a profile
1. `view` 2–3 representative slides of the new idiom; fill the schema dimensions.
2. Copy a profile JSON, edit tokens to your read.
3. `node scripts/preview.js styles/<new>.json out/<new>.png` (via wkhtmltoimage) and eyeball.
4. Tune until the specimen matches; commit. The classifier now has a new target.
