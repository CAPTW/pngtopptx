# Text Region Schema

`work/slideXX/text_regions.json` is the authoritative input for mask generation,
inpainting, and downstream native reconstruction decisions. OCR and detector output are
evidence only.

## Top-Level Shape

```json
{
  "schemaVersion": "slide-text-layer-inpaint.text_regions.v1",
  "slideId": "slide01",
  "sourceImage": "src/slide01.png",
  "sourceImageHash": "2f7a...",
  "coordinateSpace": {
    "width": 1672,
    "height": 941,
    "units": "source_px"
  },
  "image": {
    "width": 1672,
    "height": 941,
    "sha256": "..."
  },
  "status": "draft",
  "policy": {
    "ocrIsEvidenceOnly": true,
    "inpaintingIsBackgroundCleanupOnly": true,
    "nativeReconstructionRequiredForSemanticText": true
  },
  "regions": []
}
```

`status` is `draft`, `resolved`, or `approved`. Production handoff requires `resolved`
or `approved`.

Required top-level integrity fields:

- `schemaVersion`: must be a supported schema id. Current supported value:
  `slide-text-layer-inpaint.text_regions.v1`.
- `sourceImageHash`: SHA-256 hex digest of the source slide image bytes.
- `coordinateSpace.width`: source image width in pixels.
- `coordinateSpace.height`: source image height in pixels.
- `coordinateSpace.units`: must be `source_px`.

The legacy `image.width`, `image.height`, and `image.sha256` block may be retained for
backward compatibility, but it is not a substitute for the top-level integrity fields in
strict validation.

## Region Shape

```json
{
  "id": "r001",
  "class": "semantic_text",
  "bbox": { "x": 110, "y": 84, "w": 420, "h": 48 },
  "source": "manual",
  "confidence": 0.92,
  "correctedText": "Revenue Growth",
  "language": "en",
  "role": "title",
  "evidence": {
    "ocrText": "Revenue Gr0wth",
    "detector": "manual",
    "notes": "OCR corrected by visual review"
  },
  "inpaint": {
    "allowed": true,
    "paddingPx": 3
  }
}
```

Required fields:

- `id`: unique stable id within the slide.
- `class`: one of the allowed classes below.
- `bbox`: source-pixel box with numeric `x`, `y`, `w`, and `h`.
- `source`: `manual`, `cv_candidate`, `ocr_candidate`, `manual_review`, or `imported`.
- `confidence`: number from 0 to 1 describing confidence in the region boundary and class.

Optional fields:

- `polygon`: array of `{ "x": number, "y": number }` points when a rectangle is not precise enough.
- `correctedText`: required for `semantic_text`, forbidden for `pseudo_text`.
- `evidence.ocrText`: OCR evidence only; never treated as final text by itself.
- `exceptionApproved`: boolean used only for unresolved `unknown_text`.
- `exceptionReason`: required when `exceptionApproved` is true.
- `inpaint.allowed`: whether this region may contribute to `inpaint_mask.png`.
- `inpaint.paddingPx`: mask expansion in source pixels for this region.
- `effects.shadow` / `effects.glow`: optional booleans used by mask expansion to include
  shadow or halo margins.
- `backgroundType`: optional mapper hint. The authoritative background routing artifact is
  `background_regions.json`.

## Background Regions Shape

`classify_background_regions.py` writes:

```json
{
  "schemaVersion": "slide-text-layer-inpaint.background_regions.v1",
  "slide": 12,
  "regions": [
    {
      "textRegionId": "s12_text_001",
      "backgroundType": "panel",
      "sampledColors": ["#031624"],
      "recommendedRepair": "redraw",
      "confidence": 0.82,
      "notes": "localColorStd=4.2; edgeDensity=0.04"
    }
  ]
}
```

Allowed `backgroundType` values:

- `flat_color`
- `gradient`
- `panel`
- `table_cell`
- `rule_line`
- `icon_area`
- `chart_area`
- `photo_texture`
- `complex_unknown`

Repair routing:

- `flat_color`, `panel`, `table_cell`: `redraw`.
- `gradient`, `photo_texture`: `inpaint`.
- `rule_line`: `native_reconstruct`.
- `icon_area`, `chart_area`, `complex_unknown`: `manual_review`.

## Background Repair Report Shape

`repair_text_backgrounds.py` writes `inpainting_report.json`:

```json
{
  "schemaVersion": "slide-text-layer-inpaint.inpainting_report.v1",
  "slide": 12,
  "status": "pass",
  "artifactRisk": "low",
  "methodsUsed": {
    "redraw": 8,
    "inpaint": 1,
    "manualReview": 0,
    "nativeReconstruct": 0
  },
  "residualTextRisk": "low",
  "regions": [
    {
      "id": "s12_text_001",
      "type": "semantic_text",
      "backgroundType": "panel",
      "repairMethod": "redraw",
      "status": "pass",
      "residualRisk": "low",
      "notes": ""
    }
  ]
}
```

Allowed `repairMethod` values are `redraw`, `inpaint`, `native_reconstruct`, and
`manual_review`.

## Residual Text Report Shape

`detect_residual_text.py` writes:

```json
{
  "schemaVersion": "slide-text-layer-inpaint.residual_text_report.v1",
  "slide": 12,
  "status": "pass",
  "residualTextRisk": "low",
  "regions": [
    {
      "id": "s12_text_001",
      "residualRisk": "low",
      "residualPixelsApprox": 0,
      "notes": ""
    }
  ]
}
```

High residual risk fails strict validation. Medium residual risk requires manual review.

## Classes

`semantic_text`

Readable text that carries slide meaning and must be reconstructed as native editable text
downstream. Requires `correctedText`.

`pseudo_text`

Text-like visual marks that should not be converted into native text because they are
unreadable, decorative, synthetic, or likely to produce incorrect content. It may be masked
and inpainted, but must not carry `correctedText` or `nativeText`.

`micro_text`

Real text that exists visually but is too small or low-value for reliable native
reconstruction. Use this for tiny legends, axis ticks, watermark strings, or dense UI labels
when exact text cannot be safely reconstructed. It may have `evidence.ocrText`; it does not
require `correctedText` unless the downstream reconstruction explicitly promotes it to
`semantic_text`.

`decorative_glyph`

Letter-like or number-like marks used as ornament, texture, code fragments, fake labels,
pattern fill, iconographic signs, or typographic decoration. Must not be treated as
semantic text.

`unknown_text`

Text-like region whose meaning or class is unresolved. Validation fails unless it is resolved
to another class or explicitly exception-approved with `exceptionReason`.

## Validation Rules

- Unsupported or missing `schemaVersion` fails validation.
- In strict mode, missing `sourceImageHash` or `coordinateSpace` fails validation.
- When the actual source image is provided to the enforcer, `sourceImageHash` must match
  the image bytes and `coordinateSpace.width`/`height` must match the decoded image size.
- Existing artifacts without top-level integrity metadata are accepted only in legacy
  validation mode without `--strict` and without an image integrity check.
- OCR evidence is never enough to mark a region as `semantic_text`.
- Every `semantic_text` region must have non-empty `correctedText`.
- `pseudo_text` and `decorative_glyph` must not have `correctedText`, `nativeText`, or
  `nativeReconstruction.required: true`.
- `unknown_text` must fail unless `exceptionApproved: true` and `exceptionReason` is non-empty.
- Mask generation must use `bbox` or `polygon` from this file, not fresh OCR output.
- Inpainting must use `inpaint_mask.png`, generated from this resolved schema.
- Strict mode requires `background_regions.json` and `residual_text_report.json`.
- `flat_color`, `panel`, and `table_cell` regions must not be repaired with generic
  inpainting when redraw is recommended.
- `complex_unknown` cannot be marked pass without review or reconstruction evidence.
