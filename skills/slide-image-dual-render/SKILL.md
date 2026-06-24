---
name: slide-image-dual-render
description: >-
  Faithfully reconstruct slide image(s) into BOTH a fully-editable multi-slide PPTX and a standalone
  self-contained HTML from ONE backend-agnostic renderer, and keep quality CONSISTENT across different visual
  styles by classifying each input against a frozen style LIBRARY (styles/*.json) and rendering from the
  matched profile's tokens via DECK_PROFILE instead of re-improvising the design. Use when slide image(s) must
  become both formats — 'convert to editable PPTX and HTML', 'PPTX + 웹 버전', '둘 다 만들어줘 (PPTX와 HTML)' — or when
  different-style slides must convert at the same quality — '스타일이 달라도 품질이 일정하게', '여러 스타일 슬라이드를 같은 스킬로', 'make
  conversion quality consistent across styles', 'style-aware reconstruction'. Also reproduces a dense bordered
  multi-panel infographic exactly ('보이는 그대로') with editable objects, icons, chevron roadmaps, tables and
  callouts, cropping un-recreatable photoreal/3D regions. Prefer when BOTH PPTX and HTML are wanted.
---

# Slide Image → Dual Render (editable PPTX + standalone HTML), style-aware

## What this is

A pipeline that turns slide **images** into faithful, fully-editable reconstructions in
**two formats from one source of truth**:

- a single **.pptx** where every title, panel, bullet, icon, chevron, table cell, and
  callout is an independent, movable, editable object; and
- a single **.html** that is self-contained (images base64-embedded) and renders the
  same layout in a browser.

The trick is a **backend-agnostic authoring layer**: you describe each slide once, in
**source-pixel coordinates**, by calling drawing helpers on an abstract "surface" `s`.
The exact same slide function is then replayed onto a PPTX surface (pptxgenjs + sharp)
and an HTML surface (absolute-positioned DOM). You never branch on the backend — you
just draw, and both outputs come out identical.

On top of that, a **style layer** keeps quality from fluctuating when you convert slides of
**different idioms**. Instead of re-deriving the whole design language every run (high variance),
you **classify** each input against a small frozen **style library** (`styles/*.json`) and render
from the matched profile's tokens. The renderer's design system — palette, font, background, icon
colors — is read from that profile via `DECK_PROFILE`, so the same code produces a clinical-dark
deck or a corporate-light deck with equal fidelity. Classification has a tiny, reproducible answer
space; frozen profiles never re-derive per slide; that is what kills the run-to-run drift.

This is the right tool when the user wants **both** outputs, a web version alongside a deck, a
pixel-faithful reconstruction of a dense infographic, or **consistent** results across a mixed-style
batch. For a one-off "just give me an editable PPTX from this screenshot" with no HTML, the simpler
single-output path is fine; this skill earns its keep when fidelity, dual output, or cross-style
consistency matter.

## The style library — `styles/`
A profile is not one opaque "look": it is a set of **independent dimensions** (background, geometry,
icon style, header style, step style, palette roles, …) that compose. Two profiles ship in v1, seeded
from real samples:

- `styles/clinical-dark.json` — dark gradient + photoreal-crop hero + rounded-bordered panels +
  chevron roadmap + line icons (cool, technical).
- `styles/corporate-light.json` — white base + diagonal-cut + soft-shadow cards + navy/orange/teal +
  numbered circles. Includes a dark feature-panel variant in `components.alt`.

Supporting files:
- `styles/_schema.md` — the **dimension vocabulary** (read first; it defines the classification).
- `scripts/classify.md` — the per-image **classify → match-with-confidence → fallback** procedure.
- `scripts/preview.js` — renders a profile into a one-page **specimen** so you can eyeball whether
  the extracted tokens match the source idiom before committing.
- `references/style-integration.md` — how a profile feeds the renderer (the `profile → kit` map),
  the per-image isolation architecture, the gates, and the honest v1 scope/ceiling.
- `references/codex-subagents.md` — Codex Desktop fan-out/fan-in workflow for one-slide-per-context
  reconstruction, isolated `work/slideXX/` artifacts, integration, and per-slide QA.
- `assets/codex-agents/*.toml` — optional project-scoped Codex custom agent templates for the
  mapper, reconstruction worker, integrator, and QA gate.

## Setup

Copy this skill's `scripts/` **and** `styles/` into a working directory, then install deps:

```bash
mkdir -p deck && cp -r scripts/* deck/ && cp -r assets styles deck/ && cd deck
npm i pptxgenjs sharp react react-dom react-icons
pip install --break-system-packages pillow numpy
mkdir -p src assets out work
```

Put the source images in `src/` renamed `slide1.png … slideN.png`. Decide the **canvas resolution**
= the pixel size of those images (default 1672×941, i.e. 16:9). Pick the style profile for this deck
and export it alongside the canvas/asset vars:

```bash
export DECK_ASSETS="$PWD/assets" DECK_PXW=1672 DECK_PXH=941
export DECK_PROFILE="$PWD/styles/clinical-dark.json"   # the classified style for this batch
```

`DECK_PROFILE` is **optional and backward-compatible** for style tokens: with it unset, the renderer
uses the original built-in dark palette; with it set, the palette, requested font, background, and
icon colors all follow that profile. The final font still passes through the parity font policy below.

## PPTX/HTML parity policy

The renderer resolves one local font for both PPTX and HTML. If a profile asks for a font that is not
installed for PPTX rasterization, such as Pretendard on a system without Pretendard, the build falls
back to a documented local family (`Arial`, `Aptos`, or `Malgun Gothic`, overridable with
`DECK_FONT_FALLBACK`). HTML no longer imports remote webfonts for parity QA; `out/build_trace.json`
records the requested font, resolved font, fallback reason, and the exact CSS font stack.

Generated HTML supports a diagnostic static mode for screenshot QA:

```text
out/deck.html?qa=1
out/deck.html#qa
```

In QA/static mode, every slide renders at exactly `DECK_PXW × DECK_PXH`, presentation chrome is
removed, and `.slide` uses no transform scale. Normal interactive browser viewing keeps the
responsive fit behavior. Visual QA must capture the static mode rather than accepting scaled
screenshots.

## Hard-Locked Workflow Mode

The normal workflow below remains valid for manual and legacy use, but production conversions should
use the validator-backed entrypoint:

```bash
node scripts/slide_pipeline.js --target both
```

Hard-Locked Workflow Mode exists because Codex instructions alone cannot guarantee compliance. The
Skill now includes validators, a central pipeline, trace files, a final delivery gate, and optional
Codex hooks so bypasses fail instead of merely being discouraged.

For project guardrails, install the templates:

Skill-installed layout, run from a deck project root:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\install_hardlock.js" --project .
```

Deck-local copied layout:

```bash
node scripts/install_hardlock.js --project .
```

Then review `.codex/config.toml.example`, merge it into `.codex/config.toml`, and restart Codex.
For production conversion shells, set strict mode:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
```

Production conversion example:

Skill-installed layout:

```powershell
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --slides 1,2,3 --target both --pptx-out out\deck.pptx --html-out out\deck.html
```

Deck-local copied layout:

```bash
DECK_PROFILE="$PWD/styles/clinical-dark.json" DECK_ASSETS="$PWD/assets" DECK_PXW=1672 DECK_PXH=941 \
  node scripts/slide_pipeline.js --slides 1,2,3 --target both \
  --pptx-out out/deck.pptx --html-out out/deck.html
```

If you followed the older setup that copies `scripts/*` directly into the deck root, use the same
commands without the `scripts/` prefix, for example `node slide_pipeline.js --target both`.

Final delivery is invalid unless the gate passes:

Skill-installed layout:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```bash
node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html
```

Hard-Locked Mode does **not** mean HTML is converted to PPTX. The architecture remains: author one
backend-agnostic `lib/slides.js`, use source-pixel coordinates and kit helpers, then replay the same
slide functions into the PPTX and HTML surfaces through the approved build pipeline.

## Workflow (phases)

Follow them in order. **Read `references/workflow.md` for the full detail** — the notes below are the
spine. Process **one image per fresh context** (sub-agent fan-out or a driver loop): cross-slide
consistency comes from every run importing the *same frozen profiles*, not from the model remembering
sibling slides.

For Codex Desktop sub-agent fan-out, also read **`references/codex-subagents.md`**. Parallel workers
must only write to their own `work/slideXX/` directory. The main thread or `slide_render_integrator`
is the only actor that may merge those fragments into shared files.

## Codex Sub-Agent Mode

For multi-slide batches, install the project-scoped custom agents and keep each slide in a fresh
context:

```bash
node scripts/install_codex_subagents.js --project .
```

If you followed the setup above and copied `scripts/*` into the deck root, use the equivalent
project-local command:

```bash
node install_codex_subagents.js --project .
```

Recommended `.codex/config.toml` snippet:

```toml
[agents]
max_threads = 4
max_depth = 1
```

Subagents are recommended for multi-slide batches because they keep measurements, style decisions,
crop plans, and reconstruction code isolated per slide. The existing single-thread / driver-loop
workflow remains valid for one-off or simple runs. Workers must not edit shared renderer files such
as `lib/slides.js`, `make_crops.py`, `build.js`, or `styles/*.json`; merge centrally after validation.

### Phase 0 — Study the source
`view` each source image. Measure exact pixel boxes for every element you'll place (panel rectangles,
column centers, banner/roadmap/footer y-bands). The measuring snippet pattern is in
`references/qa-and-rendering.md`.

### Phase 0.5 — Classify the style & pin a profile  *(per image, in its own context)*
Follow `scripts/classify.md`:
1. **Characterize** each dimension in `styles/_schema.md` from the image.
2. **Match** to a library profile **with a confidence**: high → use it as the base; partial → use the
   closest **+ override** the diverging dimensions; **no confident match → fallback** (open
   extraction / crop-heavy / flag), never force the nearest profile.
3. **Extract specifics**: read the input's *actual* title colors, accent hexes, radius, panel fill,
   and write them as a per-slide override on top of the chosen profile. (Library = grammar; extraction
   = specifics.)
4. **Verify** the chosen profile with a specimen: `node preview.js styles/<id>.json out/<id>.html`
   (rasterize and eyeball). Set `DECK_PROFILE` to the chosen profile for the rest of the pipeline.

### Phase 1 — Asset prep
Everything content-independent is generated, and now **profile-driven**:

```bash
DECK_PROFILE=$DECK_PROFILE python make_bg.py     # background from profile.dimensions.background
DECK_PROFILE=$DECK_PROFILE node   make_icons.js  # 60+ Tabler icons recolored to the profile palette
python make_crops.py                             # single-thread: CROPS table -> manifest.json
# sub-agent: CROP_PLAN=work/crop_plan.integrated.json python make_crops.py
```

- **Background**: `make_bg.py` reads the profile's `background` (gradient-dark `from/to`, or a `light`
  base) — no profile ⇒ the original dark gradient. Gradients are baked here because PPTX can't draw
  them (see `pptxgenjs-gotchas.md`).
- **Icons**: `make_icons.js` recolors each concept to the profile palette, keeping the color **names**
  (`white lblue cyan red green gold blue`) stable so `icon(s,concept,color,…)` calls are unchanged.
  Confirm a concept exists before using it — a missing name prints `!! missing icon` and is skipped.
- **Crops**: only crop what you genuinely **cannot** rebuild as vectors — photoreal renders, 3D
  wireframes, photographs, dense baked-in label art. Continuous-tone is **always a crop, never
  vectorized**. Edit the `CROPS` table in `make_crops.py`. Trim any caption strip that you also
  recreate natively (recipe in `references/workflow.md`).
- Crop policy metadata in `work/crop_plan.json` / `CROP_PLAN` is authoritative. `make_crops.py`
  must preserve it into `assets/manifest.json` (`content_type`, `reconstruction_reason`,
  `editable_replacement`, `allow_large_crop`, `reason`, and safe extra policy fields). Legacy
  defaults are only for old crop plans that truly omit metadata and remain visible to
  reconstruction gates.

### Phase 2 — Author or integrate the slides
Copy `lib/slides.template.js` to `lib/slides.js` and replace the bodies, transcribing each source
slide **1:1**. Export one function per slide named `s1, s2, … sN` (no cap). All coordinates are
**source pixels**. Build with the kit helpers — `head`, `panel`, `T`, `badge`, `icon`, `banner`,
`chevronBar`, `iconRows`, `detailRows`, `footer`, `crop` — whose full signatures are in
**`references/kit-api.md`**. The helpers read their colors from `kit.C`, which is the active profile's
palette, so authoring code never hard-codes a hex. Keep layout bands uniform across slides.

In Codex Desktop sub-agent mode, do **not** let workers edit `lib/slides.js` or `make_crops.py`.
Each worker writes `work/slideXX/sN.fragment.js` and `work/slideXX/crop_plan.json`; then the
integrator runs:

```bash
node scripts/validate_agent_work.js --work work
node scripts/merge_fragments.js --work work --out lib/slides.js --backup
CROP_PLAN_DIR=work python make_crops.py
```

This generates the shared `lib/slides.js` and crop manifest inputs while preserving the same render
contract used by the single-thread path. If you use the older root-copied setup, drop the
`scripts/` prefix from these script paths. `integrate_subagent_work.js` remains available as a
compatibility shortcut that combines merge and crop-plan consolidation.

### Phase 3 — Render both
```bash
export DECK_TITLE="My Deck" DECK_LANG="ko" \
       DECK_PROFILE="$PWD/styles/clinical-dark.json" \
       DECK_EYEBROW="My Course · 2026" DECK_TAG="Part I · Basics" DECK_PREFIX="Module 1" \
       DECK_FOOTER="교육용 요약 · 최신 규정 우선 확인"
SLIDES=1,2,3 TARGET=both PPTX_OUT="$PWD/out/deck.pptx" HTML_OUT="$PWD/out/deck.html" node build.js
```
`SLIDES` selects which to render (omit for all). `TARGET` is `pptx` | `html` | `both`.

### Phase 4 — QA loop / gate (do not skip)
Rasterize and **look at every slide**, fix, re-render, repeat. Full commands + gotchas in
**`references/qa-and-rendering.md`**. Gate **per slide**, never batch-level — "looks fine overall" is
the failure mode. In short:

- PPTX → `soffice --headless --convert-to pdf …` → `pdftoppm -png` → `view` each page. **Never
  `pkill -f soffice`** (it self-kills your shell) — kill by exact PID. First conversion can take >45s
  for CJK font caching; poll generously.
- HTML → a real browser loads the Pretendard webfont and runs the shrink-to-fit script. `wkhtmltoimage`
  is no longer the reference capture path. Use the visual-polish QA capture script, which loads
  `?qa=1`, records viewport/deviceScaleFactor/bounding box/applied scale, and fails if the PNG is not
  exactly the source-pixel size.

### Phase 5 — Deliver
Copy both finals to `/mnt/user-data/outputs/`, then `present_files` with the **PPTX first**. In the
summary, distinguish which regions are **baked-into-image crops** (label art lives in the picture, not
editable text) vs which elements are **fully editable native objects** (titles, panels, text, tables,
icons, chevrons, matrix symbols, decision boxes, callouts).

## Critical rules (the ones that bite)

- **Draw once, render twice.** Slide functions must never check the backend. Any backend-specific
  concession belongs in the surface atoms, not in slide code.
- **Source-pixel coordinates everywhere.** The surfaces convert px → inches (PPTX) and px → DOM (HTML).
- **No hidden scale in visual QA.** HTML screenshots for PPTX/HTML parity must use QA/static mode and
  must be exactly `DECK_PXW × DECK_PXH`. Do not loosen visual thresholds for capture-scale or font bugs.
- **One resolved font for both outputs.** Do not rely on a CDN webfont in HTML unless the same font is
  installed and available to PPTX rasterization.
- **Classification, not authoring.** Pick which frozen profile an input is, then override specifics —
  don't re-derive a whole design system per slide. That re-derivation is the variance you're removing.
- **Confidence threshold is mandatory.** The library is a closed set; inputs are open. No confident
  match ⇒ fallback, never "nearest profile." A whole wrong design system applied confidently is worse
  than an honest open extraction.
- **Profile = grammar, extraction = specifics.** Let the profile fix the primitives/layout idiom, but
  override its defaults with the input's real colors/radii/spacing.
- **One image per context; gate per slide.** Batching is what made quality collapse; isolation + a
  shared frozen library is the fix. Accept each slide against the source diff, never batch-level.
- **Parallel workers write only `work/slideXX/`.** Do not let sub-agents directly edit
  `lib/slides.js`, `make_crops.py`, `build.js`, or `styles/*.json`. Merge once through
  `integrate_subagent_work.js` or an equivalent main-thread integrator.
- **pptxgenjs quirks** (full list in `references/pptxgenjs-gotchas.md`): hex colors with **no `#`**,
  never 8-char hex, transparency via the `transparency` prop, no gradients (bake into `bg.png`),
  `rectRadius` only on rounded rectangles, shadow `offset ≥ 0`, never reuse one options object across
  shapes — clone per call.
- **Faithful reproduction overrides generic "don't make busy AI slides" advice.** Match the source
  exactly, bordered panels and all. **Trim crops that overlap native text.**

## What's in `scripts/` and `styles/`

```
scripts/
├── build.js               orchestrator: discovers s1..sN, renders pptx/html (env-driven, profile-aware page bg)
├── slide_pipeline.js      hard-locked production entrypoint: validate -> assets -> crops -> build -> validate -> trace
├── enforce_contract.js    strict contract validator for preflight/postbuild/final delivery phases
├── final_gate.js          mandatory final delivery gate for production conversions
├── install_hardlock.js    installs Codex hook/rule/AGENTS templates into a project workspace
├── integrate_subagent_work.js
│                          Codex Desktop fan-in: merges work/slideXX fragments + crop plans
├── install_codex_subagents.js
│                          copies project-scoped Codex custom agent TOML templates
├── merge_fragments.js     validates and merges work/slideXX/sN.fragment.js into lib/slides.js
├── validate_agent_work.js validates per-slide work artifacts before merge
├── preview.js             render a style profile -> one-page specimen HTML (style probe / tuning)
├── classify.md            per-image classify → match-with-confidence → fallback procedure
├── lib/
│   ├── profile.js         load DECK_PROFILE; map profile palette/typography → the kit C palette + FONT
│   ├── kit.js             palette + backend-agnostic helpers (head, panel, T, icon, banner, chevronBar, …)
│   ├── atoms_pptx.js      PPTX surface (pptxgenjs); px→inch
│   ├── atoms_html.js      HTML surface (absolute DOM, base64 images, shrink-to-fit markers)
│   └── slides.template.js worked 2-slide example — copy to slides.js and edit
├── make_bg.py             background generator (profile-driven; dark gradient or light base)
├── make_icons.js          Tabler icons → recolored PNG library (profile-driven palette)
└── make_crops.py          extract + feather un-recreatable regions, emit manifest.json
styles/
├── _schema.md             style dimension vocabulary (the classification)
├── clinical-dark.json     frozen profile — dark technical idiom
└── corporate-light.json   frozen profile — light corporate idiom
```

## Reference files
- `references/workflow.md` — full end-to-end procedure, classify phase, crop decisions, layout conventions.
- `references/kit-api.md` — every surface atom + kit helper signature, the palette, env vars (incl. `DECK_PROFILE`), icon concepts.
- `references/style-integration.md` — profile → kit mapping, per-image isolation, gates, v1 scope & ceiling, how to add a profile.
- `references/codex-subagents.md` — Codex Desktop sub-agent topology, `work/slideXX/` artifact contracts, integration, and QA ownership.
- `references/hardlock-mode.md` — validator-backed production mode, hooks, protected files, forbidden shortcuts, final gate.
- `references/pptxgenjs-gotchas.md` — the pptxgenjs constraints that cause silent failures.
- `references/qa-and-rendering.md` — soffice/wkhtmltoimage QA commands, hazards, coordinate-measuring snippets.

<!-- HARDLOCK_PATH_CONTRACT_BEGIN -->

## Hard-Locked Workflow Mode path contract

Hard-Locked Workflow Mode supports two valid layouts. In both cases, `--project` is the deck project root and all deck-relative paths (`src/`, `lib/slides.js`, `styles/`, `assets/`, `work/`, `out/`) resolve from that project root.

Skill-installed layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\install_hardlock.js" --project .
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --target both --pptx-out out\deck.pptx --html-out out\deck.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
node scripts\install_hardlock.js --project .
node scripts\slide_pipeline.js --project . --target both --pptx-out out\deck.pptx --html-out out\deck.html
node scripts\final_gate.js --project . --target both --pptx out\deck.pptx --html out\deck.html
```

The production path fails closed if `projectRoot` is the installed Skill directory, if outputs resolve outside the deck project, if `lib/slides.js` is missing from the deck project, or if the final gate sees file hashes that differ from `out/render_trace.json`.

<!-- HARDLOCK_PATH_CONTRACT_END -->

<!-- PRODUCTION_DEPENDENCY_CROP_CONTRACT_BEGIN -->

## Production dependency and crop-plan contract

Hard-Locked production runs must make crop plans and Node dependencies explicit. Do not rely on an old deck workspace through a hidden `NODE_PATH`, and do not rely on an env-only crop plan when a CLI argument can name it.

Dependency resolution order:
1. `--node-path <path>`
2. existing `NODE_PATH`
3. project-local `node_modules`
4. Skill-local `node_modules`
5. fail closed with install instructions

Install dependencies in the deck project for Skill-installed layout:

```powershell
cd C:\path\to\deck
npm i pptxgenjs sharp react react-dom react-icons
```

Recommended Skill-installed production command:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --slides 1,2,3 --target both --crop-plan work\crop_plan.json --node-path .\node_modules --pptx-out out\deck.pptx --html-out out\deck.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
```

Recommended deck-local copied production command:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node scripts\slide_pipeline.js --project . --slides 1,2,3 --target both --crop-plan work\crop_plan.json --node-path .\node_modules --pptx-out out\deck.pptx --html-out out\deck.html
node scripts\final_gate.js --project . --target both --pptx out\deck.pptx --html out\deck.html
```

If a deck has no unrecreatable raster regions, pass `--skip-crops`; otherwise create `work/crop_plan.json` or pass `--crop-plan <path>`. Crop policy metadata in that plan is authoritative and must round-trip into `assets/manifest.json`; legacy defaults are only for old plans with missing metadata. The pipeline records `cropPlanPath`, `cropPlanHash`, `cropManifestPath`, `cropManifestHash`, `nodePathUsed`, and `dependencyResolutionMode` in `out/render_trace.json`; `final_gate.js` revalidates them before delivery.

<!-- PRODUCTION_DEPENDENCY_CROP_CONTRACT_END -->

## Reconstruction-Completeness Hardlock

Hard-Locked Workflow Mode has two independent gates:

1. Route hardlock: verifies that output came from `slide_pipeline.js -> build.js -> final_gate.js` and the approved backend-agnostic renderer.
2. Reconstruction hardlock: verifies that each selected slide was actually reconstructed with native editable objects, per-slide worker artifacts, crop budget metadata, and QA.

Passing route hardlock does not imply passing reconstruction hardlock. A deck where slides are mostly preserved as baked crop regions, including slides 6-20 in the failed production test pattern, is not a valid reconstruction delivery.

Delivery modes:

1. `canary`: one-slide smoke test. Approximate output is allowed and must be treated as draft, not production.
2. `preservation`: visible preservation is allowed and crop-heavy output is allowed, but baked regions must be disclosed. This is not editable reconstruction.
3. `reconstruction`: production mode. Native reconstruction, per-slide worker receipts, reconstruction scores, crop budgets, and QA are required. Final delivery fails if any selected slide lacks reconstruction artifacts or is crop-heavy beyond policy.

Production reconstruction command, Skill-installed layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --slides 1,2,3,4,5 --quality reconstruction --require-qa --require-reconstruction --crop-plan work\crop_plan.json --node-path .\node_modules --target both --pptx-out out\deck-wave1.pptx --html-out out\deck-wave1.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --slides 1,2,3,4,5 --quality reconstruction --require-qa --require-reconstruction --target both --pptx out\deck-wave1.pptx --html out\deck-wave1.html
```

Repeat waves for `6,7,8,9,10`, `11,12,13,14,15`, and `16,17,18,19,20`. Only after all waves pass, build the combined deck with `--allow-large-batch` and run `final_gate.js` again.

New validators:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\enforce_reconstruction.js" --project . --slides 1,2,3,4,5 --quality reconstruction --trace out\render_trace.json
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\enforce_qa.js" --project . --slides 1,2,3,4,5
```

## Objective Evidence Reconstruction Hardlock

Reconstruction hardlock does not trust worker self-report files by themselves. The following files are required as objective evidence for production reconstruction delivery:

- `out/native_object_manifest.json`: generated from actual render surface calls in the approved build path. It records text, panel, rule, icon, image, shape, and line objects with coordinates and editability flags.
- `out/crop_coverage_summary.json`: generated from `work/crop_plan.json` and `assets/manifest.json`, with per-slide crop area ratios and crop metadata classification.
- `out/qa_evidence_summary.json`: generated from per-slide QA evidence files.
- `work/slideXX/qa_evidence.json`: records source/raster/screenshot hashes or explicit manual evidence notes.

Worker-authored files such as `reconstruction_score.json`, `qa_result.json`, `worker_receipt.json`, and `editability_inventory.md` are still required, but final delivery cannot pass based only on those claims. `final_gate.js` re-runs both `enforce_qa.js --require-evidence` and `enforce_reconstruction.js`, and fails if objective evidence contradicts worker-reported status.

In `--quality reconstruction` mode:

- `qa_result.json` must reference `qa_evidence.json`.
- QA pass is invalid if `qa_evidence.json` is missing, has mismatched hashes, lacks source evidence, or claims pass without raster/screenshot evidence unless it is explicitly manual with evidence notes.
- Native object counts in `reconstruction_score.json` are compared against `out/native_object_manifest.json`.
- Crop budgets are enforced from `out/crop_coverage_summary.json`, not from worker-reported crop coverage alone.
- Body content that is mostly baked crop regions is not a valid reconstruction delivery, even if the approved renderer route was used.

Production still requires both gates:

1. route hardlock pass
2. reconstruction completeness plus objective evidence pass

## PPTX Openability Gate

Production PPTX delivery is invalid if Microsoft PowerPoint would require repair when opening the file. Route hardlock and reconstruction hardlock are necessary but not sufficient for PPTX delivery.

For reconstruction-mode outputs where the target includes PPTX, `final_gate.js` requires strict PPTX package validation by default. You can also request it explicitly:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --slides 6 --quality reconstruction --require-qa --require-reconstruction --require-pptx-openable --target both --pptx out\deck-slide6.pptx --html out\deck-slide6.html
```

The gate runs `scripts/validate_pptx_package.py --strict`, checks ZIP/package structure, XML well-formedness, relationships, content types, numeric slide geometry, and referenced media. A PowerPoint "repair required" result means the deliverable fails and must be fixed at source, then re-rendered through `slide_pipeline.js -> build.js -> final_gate.js`.
