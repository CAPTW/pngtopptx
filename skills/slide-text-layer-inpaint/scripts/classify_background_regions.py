#!/usr/bin/env python3
"""Classify text-region backgrounds for redraw vs inpaint routing."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


BACKGROUND_TYPES = {
    "flat_color",
    "gradient",
    "panel",
    "table_cell",
    "rule_line",
    "icon_area",
    "chart_area",
    "photo_texture",
    "complex_unknown",
}

REPAIR_BY_TYPE = {
    "flat_color": "redraw",
    "panel": "redraw",
    "table_cell": "redraw",
    "rule_line": "native_reconstruct",
    "gradient": "inpaint",
    "photo_texture": "inpaint",
    "icon_area": "manual_review",
    "chart_area": "manual_review",
    "complex_unknown": "manual_review",
}


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


def region_meta(region: Dict[str, Any]) -> str:
    parts = [
        str(region.get("role", "")),
        str(region.get("class", "")),
        str(region.get("backgroundType", "")),
        str(region.get("visual", "")),
    ]
    evidence = region.get("evidence")
    if isinstance(evidence, dict):
        parts.append(str(evidence.get("notes", "")))
    return " ".join(parts).lower()


def sample_ring(arr: Any, bbox: Dict[str, Any], pad: int) -> Any:
    import numpy as np

    height, width = arr.shape[:2]
    x1, y1, x2, y2 = clamp_box(bbox, width, height, pad)
    bx1, by1, bx2, by2 = clamp_box(bbox, width, height, 0)
    sample = arr[y1:y2, x1:x2]
    if sample.size == 0:
        return sample.reshape((0, 3))
    mask = np.ones(sample.shape[:2], dtype=bool)
    inner_x1 = max(0, bx1 - x1)
    inner_y1 = max(0, by1 - y1)
    inner_x2 = min(mask.shape[1], bx2 - x1)
    inner_y2 = min(mask.shape[0], by2 - y1)
    mask[inner_y1:inner_y2, inner_x1:inner_x2] = False
    pixels = sample[mask]
    if pixels.size < 24:
        pixels = sample.reshape((-1, 3))
    return pixels.reshape((-1, 3))


def edge_density(gray_crop: Any, sample_mask: Any = None) -> float:
    import numpy as np

    if gray_crop.size == 0:
        return 0.0
    gy, gx = np.gradient(gray_crop.astype("float32"))
    mag = np.sqrt(gx * gx + gy * gy)
    if sample_mask is not None:
        values = mag[sample_mask]
        return float(np.count_nonzero(values > 18.0) / max(1, values.size))
    return float(np.count_nonzero(mag > 18.0) / max(1, mag.size))


def sampled_colors(pixels: Any, limit: int = 5) -> List[str]:
    import numpy as np

    if pixels.size == 0:
        return []
    quant = (pixels // 16) * 16
    colors, counts = np.unique(quant.astype("uint8"), axis=0, return_counts=True)
    order = np.argsort(counts)[::-1][:limit]
    return [f"#{int(colors[i][0]):02X}{int(colors[i][1]):02X}{int(colors[i][2]):02X}" for i in order]


def classify_region(arr: Any, gray: Any, region: Dict[str, Any]) -> Dict[str, Any]:
    import numpy as np

    height, width = arr.shape[:2]
    bbox = region.get("bbox", {})
    meta = region_meta(region)
    pad = max(8, min(28, int(max(float(bbox.get("w", 1)), float(bbox.get("h", 1))) * 0.18)))
    pixels = sample_ring(arr, bbox, pad)
    crop_box = clamp_box(bbox, width, height, pad)
    x1, y1, x2, y2 = crop_box
    gray_crop = gray[y1:y2, x1:x2]
    bx1, by1, bx2, by2 = clamp_box(bbox, width, height, 0)
    ring_mask = np.ones(gray_crop.shape, dtype=bool)
    ring_mask[max(0, by1 - y1) : max(0, by2 - y1), max(0, bx1 - x1) : max(0, bx2 - x1)] = False

    std = float(np.mean(np.std(pixels.astype("float32"), axis=0))) if pixels.size else 0.0
    colors = sampled_colors(pixels)
    edges = edge_density(gray_crop, ring_mask)
    confidence = 0.55
    notes = f"localColorStd={std:.2f}; edgeDensity={edges:.3f}"

    if any(token in meta for token in ("chart", "axis", "plot", "graph", "data point")):
        bg = "chart_area"
        confidence = 0.82
    elif any(token in meta for token in ("icon", "glyph", "pictogram")):
        bg = "icon_area"
        confidence = 0.78
    elif any(token in meta for token in ("table", "cell", "matrix", "row", "column", "grid")):
        bg = "table_cell"
        confidence = 0.80
    elif any(token in meta for token in ("rule", "divider", "underline", "border line")):
        bg = "rule_line"
        confidence = 0.72
    elif any(
        token in meta
        for token in (
            "panel",
            "card",
            "badge",
            "box",
            "callout",
            "input_doc",
            "warning",
            "flow",
            "category",
            "bottom_statement",
            "page_indicator",
            "slide_code",
        )
    ):
        bg = "panel"
        confidence = 0.78
    elif any(token in meta for token in ("photo", "texture", "photoreal", "image")):
        bg = "photo_texture"
        confidence = 0.82
    elif any(token in meta for token in ("gradient", "glow")):
        bg = "gradient"
        confidence = 0.72
    elif std <= 5.5 and edges <= 0.10:
        bg = "flat_color"
        confidence = 0.86
    elif std <= 22.0 and edges <= 0.08:
        bg = "gradient"
        confidence = 0.68
    elif std >= 34.0 and edges >= 0.16:
        bg = "photo_texture"
        confidence = 0.66
    elif edges >= 0.22:
        bg = "complex_unknown"
        confidence = 0.55
    else:
        bg = "panel" if std <= 18.0 else "complex_unknown"
        confidence = 0.62 if bg == "panel" else 0.50

    return {
        "textRegionId": str(region.get("id", "")),
        "backgroundType": bg,
        "sampledColors": colors,
        "recommendedRepair": REPAIR_BY_TYPE[bg],
        "confidence": round(confidence, 3),
        "notes": notes,
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify backgrounds behind text regions")
    parser.add_argument("--image", required=True, help="Source slide image")
    parser.add_argument("--regions", required=True, help="Resolved text_regions.json")
    parser.add_argument("--out", required=True, help="Output background_regions.json")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    image_path = Path(args.image)
    regions_path = Path(args.regions)
    out_path = Path(args.out)
    if not image_path.exists():
        print(f"error: image not found: {image_path}", file=sys.stderr)
        return 2
    if not regions_path.exists():
        print(f"error: regions not found: {regions_path}", file=sys.stderr)
        return 2

    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow and NumPy are required: pip install pillow numpy") from exc

    data = load_json(regions_path)
    regions = data.get("regions", [])
    if not isinstance(regions, list):
        print("error: text_regions.json regions must be a list", file=sys.stderr)
        return 2

    with Image.open(image_path).convert("RGB") as im:
        arr = np.asarray(im)
    gray = np.dot(arr[..., :3], [0.299, 0.587, 0.114]).astype("float32")

    classified = [classify_region(arr, gray, region) for region in regions if isinstance(region, dict)]
    doc = {
        "schemaVersion": "slide-text-layer-inpaint.background_regions.v1",
        "slide": slide_number(data, image_path.stem),
        "sourceImage": str(image_path),
        "textRegions": str(regions_path),
        "regions": classified,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {out_path} with {len(classified)} background classifications")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
