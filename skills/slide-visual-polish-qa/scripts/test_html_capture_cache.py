#!/usr/bin/env python3
"""Regression tests for the hash-bound HTML screenshot capture cache."""

from __future__ import annotations

import binascii
import json
from pathlib import Path
import struct
import sys
import tempfile
import zlib


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import capture_html_screenshot as capture  # noqa: E402


WIDTH = 16
HEIGHT = 9


def write_png(path: Path, width: int, height: int) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)

    scanlines = b"".join(b"\x00" + (b"\x10\x20\x30" * width) for _ in range(height))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


def write_cache_fixture(project: Path) -> tuple[Path, Path]:
    html = project / "deck.html"
    html.write_text("<!doctype html><section data-slide='1'>cached</section>\n", encoding="utf-8")
    screenshot = project / "work" / "slide01" / "visual_qa" / "html_screenshot.png"
    write_png(screenshot, WIDTH, HEIGHT)
    metadata = {
        "tool": "playwright-python",
        "html": str(html.resolve()),
        "htmlSha256": capture.sha256_file(html),
        "sourceSlideId": 1,
        "physicalSlideIndex": 1,
        "htmlSlideIndex": 1,
        "viewport": {"width": WIDTH, "height": HEIGHT},
        "deviceScaleFactor": 1,
        "qaStaticModeUsed": True,
        "output": str(screenshot.resolve()),
        "outputSha256": capture.sha256_file(screenshot),
        "modifiedHtml": False,
    }
    screenshot.with_name("html_screenshot_metadata.json").write_text(
        json.dumps(metadata), encoding="utf-8"
    )
    return html, project / "work"


def expect_cache_miss(callback, label: str) -> None:
    try:
        callback()
    except capture.ToolUnavailable:
        return
    raise AssertionError(f"expected hash-bound cache miss: {label}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="visual-qa-html-cache-") as tmp_s:
        project = Path(tmp_s)
        html, out_dir = write_cache_fixture(project)
        result = capture.capture_from_hash_cache(html, [1], out_dir, WIDTH, HEIGHT)
        assert result["tool"] == "hash-bound-html-capture-cache"
        assert result["captured"][0]["cacheHit"] is True
        assert result["captured"][0]["captureCacheContract"] == capture.CAPTURE_CACHE_CONTRACT

        expect_cache_miss(
            lambda: capture.capture_from_hash_cache(html, [1], out_dir, WIDTH + 1, HEIGHT),
            "viewport mutation",
        )
        html.write_text("<!doctype html><section data-slide='1'>mutated</section>\n", encoding="utf-8")
        expect_cache_miss(
            lambda: capture.capture_from_hash_cache(html, [1], out_dir, WIDTH, HEIGHT),
            "HTML mutation",
        )

    print(json.dumps({"status": "ok", "tests": 3, "contract": capture.CAPTURE_CACHE_CONTRACT}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
