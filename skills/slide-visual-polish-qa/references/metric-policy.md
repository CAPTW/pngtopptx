# Metric Policy

Metrics are evidence, not final judgment. Dense infographic slides may have acceptable structural differences when the intended output is editable reconstruction rather than a screenshot clone.

## Metrics

- Pixel difference ratio: share of pixels whose normalized channel difference exceeds the configured pixel threshold.
- Mean absolute error: average normalized per-channel absolute difference.
- Edge difference ratio: share of edge-mask pixels that disagree between source and render.
- Approximate SSIM: structural similarity when `skimage` is available; otherwise leave unavailable and rely on fallback metrics.
- Layout box drift: compare known boxes when metadata is available.
- Text density difference: compare text/mask density when text artifacts exist.
- Color palette drift: compare coarse RGB palette histograms to identify broad color emphasis differences.
- Edge density delta: compare source edge density against render edge density to identify under-built linework, rules, connectors, native technical diagrams, or decorative texture.

## Blocking Failures

Classify as blocking when evidence shows any of:

- Major content missing.
- Title, header, or footer wrong.
- Wrong slide order.
- Large layout shift.
- Crop or full-slide screenshot shortcut.
- Key table or diagram missing.
- PPTX and HTML disagree materially.

## Noticeable Issues

Classify as noticeable when the slide remains readable but visible polish is needed:

- Icon substitution.
- Spacing mismatch.
- Font weight mismatch.
- Color emphasis mismatch.
- Small label alignment drift.
- Missing detail density where the slide remains readable but native lines, nodes, connectors, halos, rules, icons, or technical decoration need polish.
- Board/panel texture drift where text and table content are native but non-text material detail is too flat.
- PPTX/HTML edge mismatch that is noticeable but has no clipping, content-loss, layout-break, readability-loss, or source-render blocking context.

## Minor Issues

Classify as minor when differences are unlikely to affect the deliverable:

- Tiny anti-aliasing differences.
- Slight line thickness mismatch.
- Non-critical icon simplification.

## Threshold Use

- Use thresholds to prioritize inspection, not to auto-approve a slide.
- In `qa-draft`, allow moderate noticeable differences while reporting them.
- In `qa-strict`, blocking issues fail the run.
- In `qa-polish`, every blocking or noticeable issue needs an actionable fix plan.

## Fix Planning Policy

- Thresholds classify severity; issue taxonomy explains the likely repair strategy. Do not loosen thresholds to make difficult slides pass.
- Dense technical diagrams should recommend native line/node/connector density first. Small metadata-rich non-text technical crops are allowed only when native approximation remains visibly worse.
- Board or panel texture drift should recommend native board structure plus small non-text decorative texture crops when needed. Text, table, status, and label content must remain native.
- STOP/flow decoration under-detail should recommend native halo, rule, icon, connector, and color-emphasis improvements. Do not recommend crops for semantic STOP text or flow labels.
- Noticeable PPTX/HTML mismatch should recommend helper usage, text box, line-height, rule, icon, or layout parity fixes. Do not recommend threshold relaxation or accepting scaled screenshots.
