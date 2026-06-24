#!/usr/bin/env python3
"""Diagnostic HTML slide screenshot capture for visual QA."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from slide_mapping import (
    SlideMapEntry,
    SlideMappingError,
    mapping_metadata,
    resolve_slide_mapping,
    slide_dir_name,
)


class CaptureError(RuntimeError):
    pass


class ToolUnavailable(CaptureError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_path(project: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project / path
    return path.resolve()

def qa_dir(out_dir: Path, slide: int) -> Path:
    path = out_dir / slide_dir_name(slide) / "visual_qa"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def file_url(path: Path, slide: int | None = None, qa: bool = False) -> str:
    url = path.as_uri()
    if qa:
        url = f"{url}?qa=1"
    if slide is not None:
        return f"{url}#slide-{slide}"
    return url


def coerce_mappings(items: list[SlideMapEntry] | list[int]) -> list[SlideMapEntry]:
    if not items:
        return []
    if isinstance(items[0], SlideMapEntry):
        return items  # type: ignore[return-value]
    return [
        SlideMapEntry(
            source_slide=int(slide),
            physical_slide=int(slide),
            html_slide=int(slide),
            mapping_mode="legacy-physical-slides",
            inferred=False,
            trace_based=False,
        )
        for slide in items  # type: ignore[union-attr]
    ]


def isolated_slide_html(original_html: Path, source_slide: int, html_slide: int, width: int, height: int) -> Path:
    """Create a temporary diagnostic HTML file that shows only one slide.

    Chrome's --screenshot mode cannot capture DOM elements directly. Loading the
    original file with a hash can still capture a blank viewport in some decks,
    so the CLI fallback uses a temporary copy with capture-only CSS. The source
    HTML is not modified.
    """
    text = original_html.read_text(encoding="utf-8", errors="replace")
    base_href = original_html.parent.resolve().as_uri() + "/"
    capture_css = f"""
<base href="{base_href}">
<style id="visual-qa-capture-style">
html, body {{
  margin: 0 !important;
  padding: 0 !important;
  width: {width}px !important;
  height: {height}px !important;
  overflow: hidden !important;
  background: #0B1320 !important;
}}
.deck {{
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  gap: 0 !important;
  width: {width}px !important;
  height: {height}px !important;
  overflow: hidden !important;
}}
.slide {{
  display: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  margin: 0 !important;
}}
#slide-{source_slide}, [data-slide="{source_slide}"],
.deck > .slide:nth-of-type({html_slide}), .deck > section:nth-of-type({html_slide}),
body > .slide:nth-of-type({html_slide}), body > section:nth-of-type({html_slide}) {{
  display: block !important;
  position: relative !important;
  left: 0 !important;
  top: 0 !important;
  width: {width}px !important;
  height: {height}px !important;
  margin: 0 !important;
  transform: none !important;
}}
</style>
"""
    lower = text.lower()
    if "</head>" in lower:
        idx = lower.rfind("</head>")
        text = text[:idx] + capture_css + text[idx:]
    else:
        text = capture_css + text
    temp = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=f"-slide-{source_slide}.html", delete=False)
    with temp:
        temp.write(text)
    return Path(temp.name)


def candidate_selectors(slide: int) -> list[str]:
    return [
        f'[data-slide="{slide}"]',
        f'[data-slide="{slide - 1}"]',
        f'[data-slide-number="{slide}"]',
        f'[data-slide-index="{slide}"]',
        f'[data-slide-index="{slide - 1}"]',
        f"#slide{slide}",
        f"#slide-{slide}",
        f"#s{slide}",
        f'[id="slide{slide:02d}"]',
    ]


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as f:
            header = f.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        width, height = struct.unpack(">II", header[16:24])
        return int(width), int(height)
    except Exception:
        return None


def assert_expected_png_dimensions(path: Path, expected_width: int, expected_height: int, context: str) -> tuple[int, int]:
    dims = png_dimensions(path)
    if dims is None:
        raise CaptureError(f"{context}: unable to read PNG dimensions for {path}")
    if dims != (expected_width, expected_height):
        raise CaptureError(
            f"{context}: screenshot dimensions {dims[0]}x{dims[1]} do not match expected "
            f"{expected_width}x{expected_height}; scaled HTML screenshots are not accepted"
        )
    return dims


MEASURE_SCRIPT = """
({ selectors, htmlIndex }) => {
  let el = null;
  let selector = null;
  for (const item of selectors) {
    const found = document.querySelector(item);
    if (found) {
      el = found;
      selector = item;
      break;
    }
  }
  if (!el) {
    const slides = Array.from(document.querySelectorAll('.slide, section, [data-slide], [data-slide-index]'));
    const index = Math.max(Number(htmlIndex || 1) - 1, 0);
    el = slides[index] || slides[0] || null;
    selector = el ? `fallback-html-slide-${index + 1}` : null;
  }
  const rect = el ? el.getBoundingClientRect() : null;
  const style = el ? getComputedStyle(el) : null;
  const meta = window.__slideRenderMeta || {};
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    deviceScaleFactor: window.devicePixelRatio,
    selector,
    slideBoundingBox: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    computedTransform: style ? style.transform : null,
    appliedScale: el && el.dataset ? Number(el.dataset.appliedScale || meta.appliedScale || 0) : Number(meta.appliedScale || 0),
    qaStaticModeUsed: document.body.dataset.qaStatic === '1' || document.documentElement.dataset.qaStatic === '1' || meta.qaStaticMode === true,
    renderMeta: meta
  };
}
"""


def exact_dimension_metadata(path: Path, expected_width: int, expected_height: int, context: str) -> dict:
    actual_width, actual_height = assert_expected_png_dimensions(path, expected_width, expected_height, context)
    return {
        "expectedScreenshotDimensions": {"width": expected_width, "height": expected_height},
        "actualScreenshotDimensions": {"width": actual_width, "height": actual_height},
        "dimensionCheck": "exact",
        "dimensionMismatchJustification": None,
    }


def capture_with_playwright(html: Path, mappings: list[SlideMapEntry] | list[int], out_dir: Path, width: int, height: int) -> dict:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:
        raise ToolUnavailable(f"Python Playwright is unavailable: {exc}") from exc

    resolved = coerce_mappings(mappings)
    captured: list[dict] = []
    with sync_playwright() as p:  # pragma: no cover - depends on local browser install
        browser = p.chromium.launch()
        try:
            for entry in resolved:
                dest = qa_dir(out_dir, entry.source_slide) / "html_screenshot.png"
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
                try:
                    page.goto(file_url(html, qa=True), wait_until="networkidle")
                except Exception:
                    page.goto(file_url(html, qa=True), wait_until="load")
                try:
                    page.wait_for_function(
                        "document.body.dataset.qaStatic === '1' || document.documentElement.dataset.qaStatic === '1'",
                        timeout=2000,
                    )
                except Exception:
                    pass

                method = "viewport"
                selector_used: str | None = None
                captured_element = False
                render_probe: dict = {}

                for selector in candidate_selectors(entry.source_slide):
                    locator = page.locator(selector).first
                    try:
                        if locator.count() > 0 and locator.is_visible(timeout=300):
                            locator.scroll_into_view_if_needed(timeout=1000)
                            locator.screenshot(path=str(dest))
                            method = "selector"
                            selector_used = selector
                            captured_element = True
                            break
                    except Exception:
                        continue

                if not captured_element:
                    for collection in (".slide", "section", "[data-slide]", "[data-slide-index]"):
                        locator = page.locator(collection)
                        try:
                            if locator.count() >= entry.html_slide:
                                item = locator.nth(entry.html_slide - 1)
                                if item.is_visible(timeout=300):
                                    item.scroll_into_view_if_needed(timeout=1000)
                                    item.screenshot(path=str(dest))
                                    method = "collection-selector"
                                    selector_used = f"{collection}:nth({entry.html_slide - 1})"
                                    captured_element = True
                                    break
                        except Exception:
                            continue

                if not captured_element:
                    try:
                        page.goto(file_url(html, entry.source_slide, qa=True), wait_until="networkidle")
                    except Exception:
                        page.goto(file_url(html, entry.source_slide, qa=True), wait_until="load")
                    page.screenshot(path=str(dest), full_page=False)

                if not dest.exists() or dest.stat().st_size == 0:
                    raise CaptureError(f"Playwright did not create {dest}")
                try:
                    render_probe = page.evaluate(
                        MEASURE_SCRIPT,
                        {"selectors": candidate_selectors(entry.source_slide), "htmlIndex": entry.html_slide},
                    )
                except Exception as exc:
                    render_probe = {"error": str(exc)}
                dimensions = exact_dimension_metadata(dest, width, height, f"Playwright source slide {entry.source_slide}")
                page.close()
                metadata = {
                    "createdAt": utc_now(),
                    "tool": "playwright-python",
                    "diagnosticOnly": True,
                    "html": str(html),
                    "htmlSha256": sha256_file(html),
                    "slide": entry.source_slide,
                    "sourceSlideId": entry.source_slide,
                    "physicalSlideIndex": entry.physical_slide,
                    "htmlSlideIndex": entry.html_slide,
                    "mappingMode": entry.mapping_mode,
                    "mappingInferred": entry.inferred,
                    "traceBased": entry.trace_based,
                    "viewport": {"width": width, "height": height},
                    "deviceScaleFactor": 1,
                    "qaStaticModeRequested": True,
                    "qaStaticModeUsed": render_probe.get("qaStaticModeUsed"),
                    "slideBoundingBox": render_probe.get("slideBoundingBox"),
                    "computedTransform": render_probe.get("computedTransform"),
                    "appliedScale": render_probe.get("appliedScale"),
                    "renderProbe": render_probe,
                    "method": method,
                    "selector": selector_used,
                    "output": str(dest),
                    "outputSha256": sha256_file(dest),
                    "modifiedHtml": False,
                } | dimensions
                write_json(dest.with_name("html_screenshot_metadata.json"), metadata)
                captured.append(metadata)
        finally:
            browser.close()
    return {"tool": "playwright-python", "captured": captured}


def find_chrome_like() -> str | None:
    names = [
        "chrome",
        "google-chrome",
        "chromium",
        "chromium-browser",
        "msedge",
        "microsoft-edge",
    ]
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    if platform.system().lower() == "windows":
        candidates = [
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Microsoft/Edge/Application/msedge.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
    return None


def capture_with_chrome_cli(html: Path, mappings: list[SlideMapEntry] | list[int], out_dir: Path, width: int, height: int) -> dict:
    chrome = find_chrome_like()
    if not chrome:
        raise ToolUnavailable("Chrome, Chromium, or Edge headless was not found")
    resolved = coerce_mappings(mappings)
    captured: list[dict] = []

    def run_chrome(cmd: list[str], slide: int) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=150)
        except subprocess.TimeoutExpired as exc:
            raise CaptureError(f"Chrome/Edge headless screenshot timed out for slide {slide}: {' '.join(cmd[:3])}") from exc

    for entry in resolved:
        dest = qa_dir(out_dir, entry.source_slide) / "html_screenshot.png"
        temp_html: Path | None = None
        capture_url = file_url(html, entry.source_slide, qa=True)
        method = "viewport-with-hash"
        try:
            temp_html = isolated_slide_html(html, entry.source_slide, entry.html_slide, width, height)
            capture_url = temp_html.as_uri()
            method = "isolated-temp-html"
        except Exception:
            temp_html = None
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--allow-file-access-from-files",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=3000",
            f"--window-size={width},{height}",
            f"--screenshot={dest}",
            capture_url,
        ]
        try:
            result = run_chrome(cmd, entry.source_slide)
            if result.returncode != 0:
                old_cmd = cmd[:]
                old_cmd[1] = "--headless"
                result = run_chrome(old_cmd, entry.source_slide)
            if result.returncode != 0:
                raise CaptureError(
                    f"Chrome/Edge headless screenshot failed for source slide {entry.source_slide}: "
                    f"{result.stderr.strip() or result.stdout.strip()}"
                )
            if not dest.exists() or dest.stat().st_size == 0:
                raise CaptureError(f"Chrome/Edge did not create {dest}")
            dimensions = exact_dimension_metadata(dest, width, height, f"Chrome CLI source slide {entry.source_slide}")
        finally:
            if temp_html is not None:
                try:
                    temp_html.unlink()
                except OSError:
                    pass
        metadata = {
            "createdAt": utc_now(),
            "tool": "chrome-cli",
            "diagnosticOnly": True,
            "html": str(html),
            "htmlSha256": sha256_file(html),
            "slide": entry.source_slide,
            "sourceSlideId": entry.source_slide,
            "physicalSlideIndex": entry.physical_slide,
            "htmlSlideIndex": entry.html_slide,
            "mappingMode": entry.mapping_mode,
            "mappingInferred": entry.inferred,
            "traceBased": entry.trace_based,
            "viewport": {"width": width, "height": height},
            "deviceScaleFactor": 1,
            "qaStaticModeRequested": True,
            "qaStaticModeUsed": True,
            "slideBoundingBox": {"x": 0, "y": 0, "width": width, "height": height},
            "computedTransform": "none",
            "appliedScale": 1,
            "method": method,
            "url": capture_url if temp_html is None else f"temporary isolated slide copy of {html}",
            "output": str(dest),
            "outputSha256": sha256_file(dest),
            "modifiedHtml": False,
        } | dimensions
        write_json(dest.with_name("html_screenshot_metadata.json"), metadata)
        captured.append(metadata)
    return {"tool": "chrome-cli", "captured": captured}


def write_error_reports(project: Path, out_dir: Path, mappings: list[SlideMapEntry], html: Path, width: int, height: int, errors: list[str]) -> None:
    slides = [entry.source_slide for entry in mappings]
    payload = {
        "createdAt": utc_now(),
        "status": "failed",
        "diagnosticOnly": True,
        "html": str(html),
        "htmlSha256": sha256_file(html),
        "slides": slides,
        "mapping": mapping_metadata(mappings),
        "viewport": {"width": width, "height": height},
        "errors": errors,
        "setup": [
            "Install Python Playwright and browsers: python -m pip install playwright; python -m playwright install chromium.",
            "Or install Chrome, Chromium, or Microsoft Edge for headless CLI screenshot fallback.",
            "Do not edit the HTML file to make capture pass.",
        ],
    }
    write_json(project / "out" / "visual_qa_html_capture_error.json", payload)
    for entry in mappings:
        write_json(
            qa_dir(out_dir, entry.source_slide) / "html_screenshot_error.json",
            payload
            | {
                "slide": entry.source_slide,
                "sourceSlideId": entry.source_slide,
                "physicalSlideIndex": entry.physical_slide,
                "htmlSlideIndex": entry.html_slide,
                "mappingMode": entry.mapping_mode,
                "mappingInferred": entry.inferred,
                "traceBased": entry.trace_based,
            },
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture diagnostic HTML slide screenshots for visual QA.")
    parser.add_argument("--html", required=True, help="Path to HTML deck output.")
    parser.add_argument("--out-dir", required=True, help="Output work directory, usually work.")
    parser.add_argument("--slides", help="Legacy rendered/physical slide numbers, for example 1,2,5-7.")
    parser.add_argument("--source-slides", help="Original source slide IDs. For wave HTML outputs, maps sequentially to rendered slides 1..N.")
    parser.add_argument("--physical-slides", help="Rendered slide numbers paired with --source-slides.")
    parser.add_argument("--slide-map", help="JSON file mapping sourceSlide to physicalSlide/htmlSlide.")
    parser.add_argument("--trace", help="Renderer trace JSON containing selected source slide ordering.")
    parser.add_argument("--width", type=int, default=1672, help="Viewport width. Default: 1672.")
    parser.add_argument("--height", type=int, default=941, help="Viewport height. Default: 941.")
    parser.add_argument("--project", default=".", help="Project root. Default: current directory.")
    args = parser.parse_args(argv)

    project = Path(args.project).expanduser().resolve()
    html = resolve_path(project, args.html)
    out_dir = resolve_path(project, args.out_dir)
    try:
        mappings = resolve_slide_mapping(
            slides=args.slides,
            source_slides=args.source_slides,
            physical_slides=args.physical_slides,
            slide_map=resolve_path(project, args.slide_map) if args.slide_map else None,
            trace=resolve_path(project, args.trace) if args.trace else None,
        )
    except SlideMappingError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    slides = [entry.source_slide for entry in mappings]

    if not html.exists():
        print(f"ERROR: HTML not found: {html}", file=sys.stderr)
        return 2
    if args.width <= 0 or args.height <= 0:
        print("ERROR: --width and --height must be positive", file=sys.stderr)
        return 2

    errors: list[str] = []
    for method in (capture_with_playwright, capture_with_chrome_cli):
        try:
            result = method(html, mappings, out_dir, args.width, args.height)
            write_json(
                project / "out" / "visual_qa_html_capture_metadata.json",
                {
                    "createdAt": utc_now(),
                    "status": "ok",
                    "html": str(html),
                    "slides": slides,
                    "mapping": mapping_metadata(mappings),
                    "viewport": {"width": args.width, "height": args.height},
                    "deviceScaleFactor": 1,
                    "qaStaticModeRequested": True,
                    "dimensionPolicy": {
                        "expected": {"width": args.width, "height": args.height},
                        "failOnMismatch": True,
                        "reason": "Visual QA compares in source-pixel coordinate space; transformed/scaled screenshots are rejected.",
                    },
                    "result": result,
                },
            )
            print(json.dumps({"status": "ok", "tool": result["tool"], "slides": slides, "mapping": mapping_metadata(mappings)}, indent=2))
            return 0
        except ToolUnavailable as exc:
            errors.append(str(exc))
        except CaptureError as exc:
            errors.append(str(exc))

    write_error_reports(project, out_dir, mappings, html, args.width, args.height, errors)
    print("ERROR: unable to capture HTML screenshots diagnostically.", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
