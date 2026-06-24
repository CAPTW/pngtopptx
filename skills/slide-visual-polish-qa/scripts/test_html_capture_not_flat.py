#!/usr/bin/env python3
"""Regression test for Chrome CLI HTML screenshot captures.

The Chrome fallback previously could create a valid PNG that was just a flat
background color. This test exercises that path directly and rejects blank or
near-flat screenshots.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import capture_html_screenshot as capture  # noqa: E402


WIDTH = 640
HEIGHT = 360
BACKGROUND = (0x10, 0x18, 0x20)


def write_fixture(path: Path) -> None:
    path.write_text(
        f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      width: {WIDTH}px;
      height: {HEIGHT}px;
      background: rgb({BACKGROUND[0]}, {BACKGROUND[1]}, {BACKGROUND[2]});
      overflow: hidden;
      font-family: Arial, sans-serif;
    }}
    .deck {{
      width: {WIDTH}px;
      height: {HEIGHT}px;
      margin: 0;
      padding: 0;
    }}
    .slide {{
      position: relative;
      width: {WIDTH}px;
      height: {HEIGHT}px;
      background: rgb({BACKGROUND[0]}, {BACKGROUND[1]}, {BACKGROUND[2]});
      color: white;
      overflow: hidden;
    }}
    .title {{
      position: absolute;
      left: 28px;
      top: 22px;
      font-size: 34px;
      font-weight: 700;
      color: #f8fbff;
    }}
    .red {{ position: absolute; left: 40px; top: 92px; width: 180px; height: 88px; background: #d8344a; }}
    .green {{ position: absolute; left: 250px; top: 92px; width: 150px; height: 188px; background: #1fb875; }}
    .blue {{ position: absolute; left: 430px; top: 92px; width: 150px; height: 88px; background: #1b7cff; }}
    .gold {{ position: absolute; left: 430px; top: 208px; width: 150px; height: 72px; background: #f4b942; }}
    .label {{
      position: absolute;
      left: 48px;
      top: 300px;
      font-size: 22px;
      letter-spacing: 0;
      color: #ffffff;
    }}
  </style>
</head>
<body>
  <div class="deck">
    <section id="slide-1" data-slide="1" class="slide">
      <div class="title">Visual QA Chrome Capture</div>
      <div class="red"></div>
      <div class="green"></div>
      <div class="blue"></div>
      <div class="gold"></div>
      <div class="label">non-flat screenshot regression</div>
    </section>
  </div>
</body>
</html>
""",
        encoding="utf-8",
    )


def fail(message: str) -> int:
    print(f"FAIL: {message}", file=sys.stderr)
    return 1


def main() -> int:
    if not capture.find_chrome_like():
        print("SKIP: Chrome, Chromium, or Edge headless was not found.")
        return 0

    try:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore
    except Exception as exc:
        return fail(f"Pillow and numpy are required for screenshot validation: {exc}")

    with tempfile.TemporaryDirectory(prefix="visual-qa-flat-capture-") as tmp_s:
        tmp = Path(tmp_s)
        project = tmp
        html = project / "fixture.html"
        out_dir = project / "work"
        write_fixture(html)

        result = capture.capture_with_chrome_cli(html, [1], out_dir, WIDTH, HEIGHT)
        if result.get("tool") != "chrome-cli":
            return fail(f"expected chrome-cli capture path, got {json.dumps(result)}")

        screenshot = out_dir / "slide01" / "visual_qa" / "html_screenshot.png"
        if not screenshot.exists() or screenshot.stat().st_size == 0:
            return fail(f"screenshot missing or empty: {screenshot}")
        metadata_path = screenshot.with_name("html_screenshot_metadata.json")
        if not metadata_path.exists():
            return fail(f"screenshot metadata missing: {metadata_path}")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("dimensionCheck") != "exact":
            return fail(f"expected exact dimension check metadata, got {metadata}")
        if metadata.get("actualScreenshotDimensions") != {"width": WIDTH, "height": HEIGHT}:
            return fail(f"metadata recorded wrong screenshot dimensions: {metadata.get('actualScreenshotDimensions')}")
        if metadata.get("appliedScale") != 1:
            return fail(f"expected capture appliedScale=1, got {metadata.get('appliedScale')}")
        if metadata.get("qaStaticModeUsed") is not True:
            return fail(f"expected QA/static capture metadata, got {metadata.get('qaStaticModeUsed')}")

        with Image.open(screenshot).convert("RGB") as image:
            if image.size != (WIDTH, HEIGHT):
                return fail(f"expected dimensions {WIDTH}x{HEIGHT}, got {image.width}x{image.height}")
            arr = np.asarray(image, dtype=np.uint8)

        if bool(np.all(arr == 255)):
            return fail("screenshot is all white")
        if bool(np.all(arr == 0)):
            return fail("screenshot is all black")

        channel_std = arr.reshape(-1, 3).std(axis=0)
        mean_std = float(channel_std.mean())
        if mean_std < 5.0:
            return fail(f"screenshot is near-flat color; mean channel std={mean_std:.3f}")

        quantized = (arr // 16).reshape(-1, 3)
        unique_quantized = int(np.unique(quantized, axis=0).shape[0])
        if unique_quantized < 8:
            return fail(f"screenshot has too few quantized colors: {unique_quantized}")

        bg = np.asarray(BACKGROUND, dtype=np.float32)
        distances = np.linalg.norm(arr.astype(np.float32) - bg, axis=2)
        non_background_ratio = float((distances > 30.0).mean())
        if non_background_ratio < 0.08:
            return fail(f"non-background pixel ratio too low: {non_background_ratio:.4f}")

        print(
            json.dumps(
                {
                    "status": "ok",
                    "tool": "chrome-cli",
                    "screenshot": str(screenshot),
                    "dimensions": {"width": WIDTH, "height": HEIGHT},
                    "meanChannelStd": mean_std,
                    "uniqueQuantizedColors": unique_quantized,
                    "nonBackgroundPixelRatio": non_background_ratio,
                },
                indent=2,
            )
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
