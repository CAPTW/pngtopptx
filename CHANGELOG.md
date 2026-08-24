# Changelog

## 0.2.1

- Added validated per-slide `font_usage.json` authoring artifacts and deterministic deck-level font manifest merging before font preflight.
- Reframed the public documentation around editable reconstruction, declared raster regions, font provenance, visible QA evidence, and one consistent install-root model.
- Replaced the abbreviated license notice with the canonical MIT License text for reliable repository license detection.

## 0.2.0

- Added original-font collection across slide code and usage manifests, Windows system/user font discovery, exact local resolution, and auditable Original-to-Resolved mappings.
- Missing fonts now pause for an explicit user decision; the toolkit never installs fonts automatically and continues with a documented fallback after decline or unavailability.
- Added one-slide fast-path support through on-demand icon manifests, cache fingerprints, and hash-preserving `--qa-only` validation.
- Added native-object provenance, reconstruction hardlocks, Codex project guards, and deterministic sub-agent integration contracts.

## 0.1.0

- Initial portable package for the editable PPTX slide reconstruction toolkit.
- Includes four local modules: text-layer preprocessing, dual PPTX/HTML reconstruction, visual polish QA, and orchestration.
