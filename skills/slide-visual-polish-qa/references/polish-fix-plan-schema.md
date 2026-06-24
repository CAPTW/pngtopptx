# Polish Fix Plan Schema

Each slide writes `work/slideXX/visual_qa/visual_polish_fixes.json`.

```json
{
  "slide": 12,
  "status": "pass|fail|needs_polish",
  "severity": "blocking|noticeable|minor|pass",
  "issues": [
    {
      "id": "s12_issue_001",
      "severity": "blocking|noticeable|minor",
      "type": "layout|text|color|icon|spacing|crop|missing_content|pptx_html_mismatch|missing_detail_density|technical_diagram_under_detailed|schematic_density_low|board_texture_missing|palette_drift|edge_density_low|pptx_html_edge_mismatch|acceptable_native_simplification|non_text_detail_crop_candidate|other",
      "region": { "x": 0, "y": 0, "w": 0, "h": 0 },
      "observed": "",
      "expected": "",
      "likelyCause": "",
      "recommendedFix": "",
      "targetFile": "work/slide12/s12.fragment.js|lib/slides.js|work/crop_plan.json|other",
      "safeToAutoApply": false,
      "fixStrategy": "native_technical_density_then_small_non_text_crops",
      "secondaryIssueTypes": ["edge_density_low", "non_text_detail_crop_candidate"],
      "cropAllowed": true,
      "cropPolicy": {
        "allowedWhen": "Only after native reconstruction of text, tables, labels, and structural lines remains visibly worse than the source.",
        "allowedContentTypes": ["3d", "technical", "decorative", "texture", "photo"],
        "forbiddenContentTypes": ["label", "micro_text", "pseudo_text", "semantic_text", "table", "text"],
        "requiredMetadata": ["content_type", "reconstruction_reason", "editable_replacement", "allow_large_crop"],
        "mustAvoidTextRegions": true,
        "maxScope": "small local non-text detail only; never a full-slide, text, table, or label crop"
      }
    }
  ]
}
```

## Issue Types

- `missing_detail_density`: source has visibly denser native-rebuildable decoration, such as STOP halos, rules, connectors, icons, or flow emphasis.
- `technical_diagram_under_detailed`: pump, HPU, valve, power, ESD, machinery, or technical illustration detail is too simplified.
- `schematic_density_low`: manifold/routing topology, valves, nodes, or connector density is lower than the source.
- `board_texture_missing`: board or panel material is too flat and drives palette drift, while board text/table/status content should remain native.
- `palette_drift`: fills, accents, material tones, or color emphasis differ from source.
- `edge_density_low`: source line/rule/icon/connector edge density is higher than the render.
- `pptx_html_edge_mismatch`: PPTX and HTML have noticeable edge/geometry divergence.
- `acceptable_native_simplification`: metrics are outside known-good bands, but no known-bad/content-loss signal is present; inspect but do not treat as threshold failure.
- `non_text_detail_crop_candidate`: secondary marker for small, metadata-rich crops that may be appropriate after native reconstruction is attempted.

## Rules

- Make fix plans actionable and coordinate-specific.
- Do not recommend weakening gates.
- Do not recommend full-slide crops.
- Do not recommend direct PPTX editing.
- Prefer fixes in per-slide fragments first.
- Modify shared files only through the integrator in the main reconstruction workflow.
- Set `safeToAutoApply` to `false` unless the change is deterministic and scoped to a generated QA artifact.
- Use source-image coordinates for `region` whenever possible.
- Use `pptx_html_mismatch` when PPTX and HTML disagree materially, even if both also differ from source.
- Use `pptx_html_edge_mismatch` when the PPTX/HTML mismatch is primarily edge, rule, text-box, or geometry drift.
- Recommend native detail-density improvements before crops.
- If a crop is recommended, it must be small, non-text, and metadata-rich. Required metadata is `content_type`, `reconstruction_reason`, `editable_replacement`, `allow_large_crop`, and `reason` when an exception or large crop is requested.
- Never recommend text, table, semantic label, pseudo-text, or full-slide crops. If a text-like region is involved, recommend native reconstruction or manual review instead.
