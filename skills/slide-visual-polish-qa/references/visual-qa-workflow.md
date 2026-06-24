# Visual QA Workflow

Use this workflow after editable reconstruction has produced PPTX and HTML outputs. The workflow is read-only with respect to deck source code unless a caller explicitly applies a generated fix plan in the reconstruction workflow.

## One-Slide Review

Use for a specific slide with a suspected mismatch.

1. Copy or locate `src/slideN.png`.
2. Rasterize the PPTX slide into `work/slideXX/visual_qa/pptx_raster.png`.
3. Capture the HTML slide into `work/slideXX/visual_qa/html_screenshot.png`.
4. Run image comparison.
5. Inspect `pptx_diff.png`, `html_diff.png`, edge diff images, `visual_metrics.json`, and `visual_polish_report.md`.
6. Use `visual_polish_fixes.json` as reconstruction instructions, not as an auto-apply patch.

## 3-5 Slide Wave

Use for batch polish cycles.

1. Select adjacent or thematically related slides.
2. Run rasterization, screenshot capture, comparison, summary, and enforcement on only that wave.
   Use `--source-slides` for wave PPTX/HTML outputs that contain only the selected slides, because
   the output deck is physically renumbered from 1..N while source artifacts must stay under
   `work/slideXX/visual_qa/`.
3. Group issues by root cause: layout tokens, crop plan, per-slide fragment, fonts, color tokens, or renderer mismatch.
4. Fix per-slide fragments before changing shared files.
5. Re-run the same wave before expanding scope.

Example wave mapping:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-visual-polish-qa\scripts\rasterize_pptx.py" --project . --pptx out\deck-wave-polish-8-13.pptx --source-slides 8,10,11,12,13 --out-dir work

python "$env:USERPROFILE\.codex\skills\slide-visual-polish-qa\scripts\capture_html_screenshot.py" --project . --html out\deck-wave-polish-8-13.html --source-slides 8,10,11,12,13 --out-dir work --width 1672 --height 941
```

In this mode, source slide 13 maps to physical/rendered slide 5, not physical slide 13. Legacy
`--slides` remains physical-output numbering for full-deck outputs where source and physical IDs
match. Use `--slide-map` for explicit mappings:

```json
{
  "slides": [
    { "sourceSlide": 8, "physicalSlide": 1, "htmlSlide": 1 },
    { "sourceSlide": 10, "physicalSlide": 2, "htmlSlide": 2 }
  ]
}
```

## Full Deck Summary

Use after slide-level waves look stable.

1. Run comparison for all expected slides.
2. Generate `out/visual_qa_summary.json` and `out/visual_qa_summary.md`.
3. Review common issue types and worst slides.
4. Queue focused repair waves instead of attempting broad blind changes.
5. Run strict enforcement only after required source, PPTX raster, HTML screenshot, metrics, reports, and fix plans exist.

## Review Expectations

- Always compare source, PPTX raster, and HTML screenshot together.
- Treat metrics as evidence. Use visual inspection for final issue classification.
- Mark PPTX/HTML disagreements separately from source-vs-render mismatches.
- Record coordinates in source image coordinate space when possible.
- Preserve the renderer workflow boundary: this Skill reports and plans, but does not replace reconstruction.
