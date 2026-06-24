# Screenshot And Raster Policy

PPTX rasterization and HTML screenshots are diagnostic only.

## PPTX Rasterization

- LibreOffice, PowerPoint, Poppler, or ImageMagick may be used to open/export slides for QA.
- Do not save, repair, optimize, resave, or modify the PPTX.
- If PowerPoint or LibreOffice prompts for repair, treat the PPTX as failed for QA rasterization.
- Record the tool used, requested slide numbers, dimensions, and any diagnostic errors.
- `--slides` is legacy physical slide numbering. For selected wave outputs where source slide IDs
  differ from physical PPTX positions, use `--source-slides` or an explicit `--slide-map`.
- Wave raster metadata must record `sourceSlideId`, `physicalSlideIndex`, `htmlSlideIndex`,
  `mappingMode`, whether mapping was inferred, and whether it came from a trace.

## HTML Screenshot Capture

- HTML screenshot capture is diagnostic only.
- Do not alter the HTML file, generated assets, or renderer output to make screenshot capture easier.
- Prefer Playwright when available; use installed Chrome or Edge headless only as a fallback.
- Prefer the renderer's QA/static mode (`?qa=1` or `#qa`) when available. It must render each slide at
  the natural source-pixel size with no transform scale.
- Record viewport, deviceScaleFactor, URL, selector or capture method, slide bounding box, computed
  transform, applied scale, whether QA/static mode was used, exact PNG dimensions, and errors.
- For wave HTML outputs, `--source-slides` maps original source slide IDs to rendered slide indexes
  1..N unless `--slide-map`, `--physical-slides`, or `--trace` provides a different mapping. The
  screenshot file must still be written under the source slide folder.
- If the HTML has source-preserving IDs or `data-slide` attributes, capture should prefer them. If
  they are absent, capture may use the mapped rendered slide index.
- Fail capture when the PNG dimensions do not exactly match the requested source coordinate space.
  Do not silently resize or accept a browser-fit transform as the HTML screenshot.
- Remote webfonts must not be used to make HTML look better than PPTX unless the same font is
  installed and available to PPTX rasterization. Font parity problems are setup/rendering bugs, not
  threshold-tuning opportunities.

## Missing Tools

If rasterization or screenshot tools are missing, fail clearly with setup guidance. Do not fabricate images, skip required slides silently, or mark a slide as passing.

Useful setup options:

- Install LibreOffice and Poppler for PPTX-to-PDF-to-PNG diagnostics.
- Install Microsoft PowerPoint and Python `pywin32` for Windows COM export diagnostics.
- Install Playwright browsers with `python -m playwright install chromium` for HTML capture.
- Install Chrome or Edge for command-line headless screenshot fallback.

## Reconstruction Boundary

Do not treat a raster or screenshot as a replacement for editable PPTX reconstruction. Visual QA may identify required fixes, but reconstruction remains the responsibility of the slide renderer workflow.
