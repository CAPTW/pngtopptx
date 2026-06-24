# Repair Playbook

Use this mapping to convert `slide-visual-polish-qa` issue types into targeted `slide-image-dual-render` repair instructions.

## Issue Strategy Map

### `missing_detail_density`

Strategy:

- Add native detail density first.
- Add line, node, icon, rule, badge, and connector density.
- Consider small non-text detail crops only if native approximation is visibly worse.
- Preserve semantic text as native editable text.

### `technical_diagram_under_detailed`

Strategy:

- Add native line, node, connector, valve, route, and manifold density.
- Small metadata-rich non-text technical or 3D crops are allowed where native approximation cannot carry source texture/detail.
- Never crop text, tables, labels, or callouts.

### `schematic_density_low`

Strategy:

- Trace native route and connector geometry from source.
- Approximate valves, nodes, gauges, panels, and flow paths natively.
- Use small technical crops only for non-text detail.

### `board_texture_missing`

Strategy:

- Keep board text, table cells, status markers, and labels native.
- Allow small decorative board-material crops for non-text texture.
- Do not crop the whole board.

### `checklist_table_fidelity_low`

Strategy:

- Run source-guided grid/table tracing.
- Rebuild rows, columns, rules, headers, status cells, and checklist text natively.
- Crop coverage should remain 0 unless a tiny non-text decorative detail is truly necessary.

### `edge_density_low`

Strategy:

- Improve rule density.
- Align panel and card boundaries to the source.
- Adjust line thickness, connector density, divider placement, and icon stroke density.
- Prefer native vector changes.

### `pptx_html_edge_mismatch`

Strategy:

- Check helper usage and PPTX/HTML parity first.
- Then fix deck-level line, text-box, spacing, and layout geometry.
- Do not loosen thresholds or accept scaled screenshots.

### `palette_drift`

Strategy:

- Adjust profile or local slide colors.
- Darken or lighten native panels, fills, strokes, and note bands.
- Use non-text texture crops only when palette drift comes from continuous-tone material that native fills cannot approximate.

## Crop Policy

Allowed repair crops:

- Non-text photoreal detail.
- Non-text 3D/technical illustration detail.
- Non-text decorative texture.

Forbidden unless explicitly exception-approved:

- Text crops.
- Table crops.
- Label crops.
- Full-slide screenshot backgrounds.
- Whole-board crops when board text/table content should remain editable.

Required crop metadata:

- `content_type`
- `reconstruction_reason`
- `editable_replacement`
- `allow_large_crop`
- `reason` when an exception is needed
