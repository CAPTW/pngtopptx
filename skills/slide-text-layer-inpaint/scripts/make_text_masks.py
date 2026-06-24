#!/usr/bin/env python3
"""Create robust text, pseudo-text, inpaint, and QA overlay masks from text_regions.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


VALID_CLASSES = {
    "semantic_text",
    "pseudo_text",
    "micro_text",
    "decorative_glyph",
    "unknown_text",
}

SEMANTIC_CLASSES = {"semantic_text", "micro_text"}
PSEUDO_CLASSES = {"pseudo_text", "decorative_glyph"}


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def image_size(path: Path) -> Tuple[int, int]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow is required: pip install pillow") from exc
    with Image.open(path) as im:
        return im.size


def region_errors(regions: Iterable[Dict[str, Any]]) -> List[str]:
    errors: List[str] = []
    seen = set()
    for idx, region in enumerate(regions, 1):
        rid = str(region.get("id") or f"#{idx}")
        if rid in seen:
            errors.append(f"{rid}: duplicate id")
        seen.add(rid)
        cls = region.get("class")
        if cls not in VALID_CLASSES:
            errors.append(f"{rid}: invalid class {cls!r}")
        bbox = region.get("bbox")
        if not isinstance(bbox, dict):
            errors.append(f"{rid}: missing bbox")
        else:
            for key in ("x", "y", "w", "h"):
                if not isinstance(bbox.get(key), (int, float)):
                    errors.append(f"{rid}: bbox.{key} must be numeric")
            if isinstance(bbox.get("w"), (int, float)) and bbox["w"] <= 0:
                errors.append(f"{rid}: bbox.w must be positive")
            if isinstance(bbox.get("h"), (int, float)) and bbox["h"] <= 0:
                errors.append(f"{rid}: bbox.h must be positive")
        if cls == "semantic_text" and not str(region.get("correctedText", "")).strip():
            errors.append(f"{rid}: semantic_text requires correctedText")
        if cls in PSEUDO_CLASSES:
            if str(region.get("correctedText", "")).strip():
                errors.append(f"{rid}: {cls} must not have correctedText")
            if str(region.get("nativeText", "")).strip():
                errors.append(f"{rid}: {cls} must not have nativeText")
            native = region.get("nativeReconstruction")
            if isinstance(native, dict) and native.get("required") is True:
                errors.append(f"{rid}: {cls} must not require native reconstruction")
        if cls == "unknown_text" and not (
            region.get("exceptionApproved") is True and str(region.get("exceptionReason", "")).strip()
        ):
            errors.append(f"{rid}: unknown_text must be resolved or exception-approved")
    return errors


def coordinate_space_errors(data: Dict[str, Any], width: int, height: int) -> List[str]:
    errors: List[str] = []
    cs = data.get("coordinateSpace")
    if not isinstance(cs, dict):
        return errors
    if cs.get("units") != "source_px":
        errors.append("coordinateSpace.units must be source_px")
    if cs.get("width") != width or cs.get("height") != height:
        errors.append(
            f"coordinateSpace {cs.get('width')}x{cs.get('height')} does not match image {width}x{height}"
        )
    return errors


def clamp_rect(bbox: Dict[str, Any], width: int, height: int, pad: int) -> Tuple[int, int, int, int]:
    x = int(round(float(bbox["x"]))) - pad
    y = int(round(float(bbox["y"]))) - pad
    w = int(round(float(bbox["w"]))) + pad * 2
    h = int(round(float(bbox["h"]))) + pad * 2
    x1 = max(0, min(x, width - 1))
    y1 = max(0, min(y, height - 1))
    x2 = max(x1 + 1, min(x + w, width))
    y2 = max(y1 + 1, min(y + h, height))
    return x1, y1, x2, y2


def text_meta(region: Dict[str, Any]) -> str:
    parts = [
        str(region.get("role", "")),
        str(region.get("style", "")),
        str(region.get("visual", "")),
        str(region.get("evidence", {}).get("notes", "")) if isinstance(region.get("evidence"), dict) else "",
    ]
    return " ".join(parts).lower()


def has_shadow_or_glow(region: Dict[str, Any]) -> bool:
    meta = text_meta(region)
    if any(token in meta for token in ("shadow", "glow", "halo", "blur")):
        return True
    effects = region.get("effects")
    if isinstance(effects, dict):
        return effects.get("shadow") is True or effects.get("glow") is True
    return False


def likely_bold_or_title(region: Dict[str, Any]) -> bool:
    meta = text_meta(region)
    if any(token in meta for token in ("title", "header", "headline", "bold", "label")):
        return True
    bbox = region.get("bbox", {})
    return float(bbox.get("h", 0) or 0) >= 34 and region.get("class") == "semantic_text"


def region_pad(region: Dict[str, Any], args: argparse.Namespace, mode: str = "expanded") -> int:
    inpaint_pad = int(region.get("inpaint", {}).get("paddingPx", 0) or 0)
    pad = max(int(args.min_region_pad), inpaint_pad)
    if mode == "base":
        return max(0, pad)

    cls = region.get("class")
    if cls == "semantic_text":
        pad += int(args.dilate_px)
    elif cls == "micro_text":
        pad += max(1, min(int(args.dilate_px), 2))
    elif cls in PSEUDO_CLASSES:
        pad += int(args.pseudo_dilate_px)
    else:
        pad += max(int(args.dilate_px), int(args.pseudo_dilate_px))

    if likely_bold_or_title(region):
        pad += max(2, int(args.dilate_px) // 2)
    confidence = region.get("confidence")
    if isinstance(confidence, (int, float)) and confidence < 0.78:
        pad += max(2, int(args.shadow_dilate_px) // 2)
    if has_shadow_or_glow(region):
        pad += int(args.shadow_dilate_px)
    return min(max(0, pad), 32)


def draw_region_on_mask(mask: Any, region: Dict[str, Any], width: int, height: int, pad: int) -> None:
    from PIL import ImageDraw

    draw = ImageDraw.Draw(mask)
    polygon = region.get("polygon")
    if isinstance(polygon, list) and len(polygon) >= 3 and pad == 0:
        pts = []
        for point in polygon:
            if not isinstance(point, dict):
                continue
            x = max(0, min(int(round(float(point.get("x", 0)))), width - 1))
            y = max(0, min(int(round(float(point.get("y", 0)))), height - 1))
            pts.append((x, y))
        if len(pts) >= 3:
            draw.polygon(pts, fill=255)
            return
    x1, y1, x2, y2 = clamp_rect(region["bbox"], width, height, pad)
    draw.rectangle([x1, y1, x2, y2], fill=255)


def build_mask(
    width: int,
    height: int,
    regions: Iterable[Dict[str, Any]],
    args: argparse.Namespace,
    mode: str = "expanded",
) -> Any:
    from PIL import Image, ImageChops, ImageFilter

    mask = Image.new("L", (width, height), 0)
    for region in regions:
        region_mask = Image.new("L", (width, height), 0)
        pad = region_pad(region, args, mode)
        draw_region_on_mask(region_mask, region, width, height, pad)
        mask = ImageChops.lighter(mask, region_mask)
    if int(args.feather_px) > 0 and mode == "expanded":
        mask = mask.filter(ImageFilter.GaussianBlur(radius=float(args.feather_px)))
    return mask


def make_box_overlay(image_path: Path, path: Path, regions: Iterable[Dict[str, Any]], width: int, height: int) -> None:
    from PIL import Image, ImageDraw

    colors = {
        "semantic_text": (255, 64, 64, 110),
        "micro_text": (255, 180, 0, 105),
        "pseudo_text": (190, 55, 255, 110),
        "decorative_glyph": (60, 170, 255, 105),
        "unknown_text": (0, 0, 0, 145),
    }
    with Image.open(image_path).convert("RGBA") as base:
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for region in regions:
            color = colors.get(region.get("class"), (0, 0, 0, 140))
            x1, y1, x2, y2 = clamp_rect(region["bbox"], width, height, 0)
            draw.rectangle([x1, y1, x2, y2], fill=color, outline=color[:3] + (220,), width=2)
            rid = str(region.get("id", ""))
            if rid:
                draw.text((x1 + 2, y1 + 2), rid, fill=(255, 255, 255, 230))
        Image.alpha_composite(base, overlay).save(path)


def make_mask_overlay(image_path: Path, mask: Any, path: Path, color: Tuple[int, int, int, int]) -> None:
    from PIL import Image

    with Image.open(image_path).convert("RGBA") as base:
        alpha = mask.point(lambda p: min(color[3], int(p * color[3] / 255)))
        overlay = Image.new("RGBA", base.size, color[:3] + (0,))
        overlay.putalpha(alpha)
        Image.alpha_composite(base, overlay).save(path)


def make_delta_overlay(image_path: Path, base_mask: Any, expanded_mask: Any, path: Path) -> None:
    from PIL import Image, ImageChops

    base_bin = base_mask.point(lambda p: 255 if p > 0 else 0)
    expanded_bin = expanded_mask.point(lambda p: 255 if p > 0 else 0)
    delta = ImageChops.subtract(expanded_bin, base_bin)
    with Image.open(image_path).convert("RGBA") as base:
        overlay = Image.new("RGBA", base.size, (255, 0, 200, 0))
        overlay.putalpha(delta.point(lambda p: 150 if p > 0 else 0))
        Image.alpha_composite(base, overlay).save(path)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create robust text-layer masks from resolved text_regions.json")
    parser.add_argument("--image", required=True, help="Source slide image path")
    parser.add_argument("--regions", required=True, help="Resolved text_regions.json path")
    parser.add_argument("--out-dir", required=True, help="Slide work directory")
    parser.add_argument("--dilate-px", "--dilate", dest="dilate_px", type=int, default=3, help="Semantic text dilation in pixels")
    parser.add_argument("--pseudo-dilate-px", type=int, default=2, help="Pseudo/decorative text dilation in pixels")
    parser.add_argument("--shadow-dilate-px", type=int, default=5, help="Extra dilation for shadow/glow/low-confidence text")
    parser.add_argument("--feather-px", type=int, default=1, help="Soft feather radius for expanded masks")
    parser.add_argument("--min-region-pad", type=int, default=2, help="Minimum per-region pad before class dilation")
    parser.add_argument("--debug-overlays", action="store_true", help="Retained for compatibility; QA overlays are always written")
    parser.add_argument(
        "--draft",
        action="store_true",
        help="Write masks even with unresolved unknown_text; outputs will not pass final enforcement",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    image_path = Path(args.image)
    regions_path = Path(args.regions)
    out_dir = Path(args.out_dir)
    if not image_path.exists():
        print(f"error: source image not found: {image_path}", file=sys.stderr)
        return 2
    if not regions_path.exists():
        print(f"error: text regions file not found: {regions_path}", file=sys.stderr)
        return 2

    data = load_json(regions_path)
    regions = data.get("regions", [])
    if not isinstance(regions, list):
        print("error: text_regions.json regions must be a list", file=sys.stderr)
        return 2

    width, height = image_size(image_path)
    errors = coordinate_space_errors(data, width, height) + region_errors(regions)
    if errors and not args.draft:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"draft warning: {error}", file=sys.stderr)

    out_dir.mkdir(parents=True, exist_ok=True)
    text_regions = [r for r in regions if r.get("class") in SEMANTIC_CLASSES]
    pseudo_regions = [r for r in regions if r.get("class") in PSEUDO_CLASSES]
    inpaint_regions = [
        r
        for r in regions
        if r.get("inpaint", {}).get("allowed", True) is True
        and (
            r.get("class") != "unknown_text"
            or (r.get("exceptionApproved") is True and str(r.get("exceptionReason", "")).strip())
            or args.draft
        )
    ]

    base_mask = build_mask(width, height, inpaint_regions, args, mode="base")
    text_mask = build_mask(width, height, text_regions, args, mode="expanded")
    pseudo_mask = build_mask(width, height, pseudo_regions, args, mode="expanded")
    inpaint_mask = build_mask(width, height, inpaint_regions, args, mode="expanded")

    text_mask.save(out_dir / "text_mask.png")
    pseudo_mask.save(out_dir / "pseudo_text_mask.png")
    inpaint_mask.save(out_dir / "inpaint_mask.png")
    make_box_overlay(image_path, out_dir / "mask_overlay.png", regions, width, height)
    make_mask_overlay(image_path, inpaint_mask, out_dir / "mask_expanded_overlay.png", (255, 32, 32, 155))
    make_delta_overlay(image_path, base_mask, inpaint_mask, out_dir / "mask_delta_overlay.png")

    print(f"wrote masks and overlays to {out_dir}")
    print(
        "mask expansion: "
        f"semantic={args.dilate_px}px pseudo={args.pseudo_dilate_px}px "
        f"shadow={args.shadow_dilate_px}px feather={args.feather_px}px minPad={args.min_region_pad}px"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
