# Handoff To slide-image-dual-render

`slide-visual-polish-qa` runs after `slide-image-dual-render` output exists. It consumes source images, PPTX rasters, HTML screenshots, manifests, crop summaries, and per-slide work artifacts to produce visual QA evidence and fix plans.

## Handoff Outputs

Pass these files back to reconstruction workers:

- `work/slideXX/visual_qa/visual_metrics.json`
- `work/slideXX/visual_qa/visual_polish_report.md`
- `work/slideXX/visual_qa/visual_polish_fixes.json`
- `out/visual_qa_summary.json`
- `out/visual_qa_summary.md`
- `out/qa/contact_sheet.png`

## Reconstruction Boundary

- Do not weaken `final_gate`, hardlock gates, PPTX openability checks, crop coverage gates, or manifest checks.
- Do not replace renderer output with screenshots.
- Do not save or repair PPTX through PowerPoint or LibreOffice.
- Treat fix plans as instructions for reconstruction workers and the integrator.

## Optional Future Integration

`slide-image-dual-render` may later require `out/visual_qa_summary.json` in strict production mode. Do not modify `slide-image-dual-render` for that integration from this Skill.
