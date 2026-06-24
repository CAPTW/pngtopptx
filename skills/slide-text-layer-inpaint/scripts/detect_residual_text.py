#!/usr/bin/env python3
"""Detect likely residual text ghosts after background repair."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def slide_number(data: Dict[str, Any], fallback: str = "") -> Any:
    raw = str(data.get("slideId") or fallback)
    match = re.search(r"(\d+)", raw)
    return int(match.group(1)) if match else raw


def clamp_box(bbox: Dict[str, Any], width: int, height: int, pad: int = 0) -> Tuple[int, int, int, int]:
    x = int(round(float(bbox["x"]))) - pad
    y = int(round(float(bbox["y"]))) - pad
    w = int(round(float(bbox["w"]))) + pad * 2
    h = int(round(float(bbox["h"]))) + pad * 2
    x1 = max(0, min(x, width - 1))
    y1 = max(0, min(y, height - 1))
    x2 = max(x1 + 1, min(x + w, width))
    y2 = max(y1 + 1, min(y + h, height))
    return x1, y1, x2, y2


def gradient_mag(gray: Any) -> Any:
    import numpy as np

    if gray.size == 0:
        return gray
    gy, gx = np.gradient(gray.astype("float32"))
    return np.sqrt(gx * gx + gy * gy)


def classify_residual(after_gray: Any, before_gray: Any, local_mask: Any) -> Tuple[str, int, str]:
    import numpy as np

    if local_mask.size == 0 or int(np.count_nonzero(local_mask)) == 0:
        return "low", 0, "empty mask for region"
    mag = gradient_mag(after_gray)
    before_mag = gradient_mag(before_gray)
    masked_mag = mag[local_mask]
    before_masked_mag = before_mag[local_mask]
    if masked_mag.size == 0:
        return "low", 0, "no masked pixels"

    threshold = max(14.0, float(np.percentile(before_masked_mag, 70)) * 0.35)
    residual_pixels = int(np.count_nonzero(masked_mag > threshold))
    area = int(np.count_nonzero(local_mask))
    ratio = residual_pixels / max(1, area)
    mean_edge = float(np.mean(masked_mag))
    notes = f"edgePixels={residual_pixels}; maskPixels={area}; edgeRatio={ratio:.4f}; meanEdge={mean_edge:.2f}"

    if residual_pixels >= 80 and ratio >= 0.10:
        return "high", residual_pixels, notes
    if residual_pixels >= 30 and ratio >= 0.04:
        return "medium", residual_pixels, notes
    return "low", residual_pixels, notes


def risk_rank(risk: str) -> int:
    return {"low": 0, "medium": 1, "high": 2}.get(risk, 2)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect residual text after background repair")
    parser.add_argument("--before", required=True, help="Source image before text removal")
    parser.add_argument("--after", required=True, help="clean_background.png after repair")
    parser.add_argument("--regions", required=True, help="text_regions.json")
    parser.add_argument("--mask", required=True, help="inpaint_mask.png")
    parser.add_argument("--out-json", required=True, help="Output residual_text_report.json")
    parser.add_argument("--out-overlay", required=True, help="Output residual_text_overlay.png")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    before_path = Path(args.before)
    after_path = Path(args.after)
    regions_path = Path(args.regions)
    mask_path = Path(args.mask)
    out_json = Path(args.out_json)
    out_overlay = Path(args.out_overlay)
    for label, file_path in (
        ("before", before_path),
        ("after", after_path),
        ("regions", regions_path),
        ("mask", mask_path),
    ):
        if not file_path.exists():
            print(f"error: {label} not found: {file_path}", file=sys.stderr)
            return 2

    try:
        import numpy as np
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise SystemExit("Pillow and NumPy are required: pip install pillow numpy") from exc

    data = load_json(regions_path)
    regions = data.get("regions", [])
    if not isinstance(regions, list):
        print("error: text_regions.json regions must be a list", file=sys.stderr)
        return 2

    with Image.open(before_path).convert("RGB") as before_im:
        before = np.asarray(before_im)
    with Image.open(after_path).convert("RGB") as after_im:
        after = np.asarray(after_im)
        overlay_base = after_im.convert("RGBA")
    with Image.open(mask_path).convert("L") as mask_im:
        mask = np.asarray(mask_im) > 0
    if before.shape != after.shape or before.shape[:2] != mask.shape:
        print("error: before, after, and mask dimensions must match", file=sys.stderr)
        return 2

    before_gray = np.dot(before[..., :3], [0.299, 0.587, 0.114]).astype("float32")
    after_gray = np.dot(after[..., :3], [0.299, 0.587, 0.114]).astype("float32")
    height, width = mask.shape
    results: List[Dict[str, Any]] = []
    overlay = Image.new("RGBA", overlay_base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for region in regions:
        if not isinstance(region, dict) or region.get("inpaint", {}).get("allowed", True) is not True:
            continue
        bbox = region.get("bbox")
        if not isinstance(bbox, dict):
            continue
        x1, y1, x2, y2 = clamp_box(bbox, width, height, 6)
        local_mask = mask[y1:y2, x1:x2]
        risk, pixels, notes = classify_residual(
            after_gray[y1:y2, x1:x2],
            before_gray[y1:y2, x1:x2],
            local_mask,
        )
        color = {
            "low": (0, 220, 120, 120),
            "medium": (255, 190, 0, 145),
            "high": (255, 32, 32, 170),
        }[risk]
        draw.rectangle([x1, y1, x2, y2], outline=color[:3] + (240,), width=2)
        if risk != "low":
            draw.rectangle([x1, y1, x2, y2], fill=color)
        draw.text((x1 + 2, y1 + 2), str(region.get("id", "")), fill=(255, 255, 255, 230))
        results.append(
            {
                "id": str(region.get("id", "")),
                "residualRisk": risk,
                "residualPixelsApprox": pixels,
                "notes": notes,
            }
        )

    worst = max((risk_rank(item["residualRisk"]) for item in results), default=0)
    status = "fail" if worst >= 2 else "partial" if worst == 1 else "pass"
    doc = {
        "schemaVersion": "slide-text-layer-inpaint.residual_text_report.v1",
        "slide": slide_number(data, before_path.stem),
        "status": status,
        "residualTextRisk": "high" if worst >= 2 else "medium" if worst == 1 else "low",
        "regions": results,
    }

    out_json.parent.mkdir(parents=True, exist_ok=True)
    with out_json.open("w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    out_overlay.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(overlay_base, overlay).save(out_overlay)

    print(f"wrote {out_json}")
    print(f"wrote {out_overlay}")
    print(f"residual status: {status}")
    return 0 if status != "fail" else 1


if __name__ == "__main__":
    raise SystemExit(main())
