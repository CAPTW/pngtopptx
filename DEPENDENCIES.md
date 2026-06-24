# Dependencies

## Required

- Windows
- Codex Desktop/App or CLI with local Skill support
- Node.js
- Python 3.10+
- PowerShell

## Recommended

- Microsoft PowerPoint for PPTX open/raster diagnostics.
- Chrome or Edge for HTML screenshot capture.
- Python packages:
  - `pillow`
  - `numpy`
  - `opencv-python`
  - `scikit-image`

## Optional

- LibreOffice for diagnostic rasterization only.
- Tesseract OCR and `pytesseract` for OCR evidence.

## Fonts

Font files are not bundled. Use fonts already licensed and installed on the target machine. The rendering Skills document and enforce font fallback behavior where needed for QA parity.

## Package Contents

This package intentionally does not include `node_modules`. Install project-level Node dependencies in deck projects as required by `slide-image-dual-render`.

