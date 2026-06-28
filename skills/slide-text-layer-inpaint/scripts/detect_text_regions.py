#!/usr/bin/env python3
"""Generate text-like candidate regions for slide screenshots.

This script is a candidate generator, not a truth source. OCR text and detector boxes are
recorded as evidence only. Reviewers or mapper tools must resolve classes and corrected text
before mask generation and inpainting are considered production-ready.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


SCHEMA_VERSION = "slide-text-layer-inpaint.text_regions.v1"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_image_size(path: Path) -> Tuple[int, int]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow is required: pip install pillow") from exc

    with Image.open(path) as im:
        return im.size


def clamp_box(box: Dict[str, Any], width: int, height: int) -> Optional[Dict[str, int]]:
    try:
        x = int(round(float(box["x"])))
        y = int(round(float(box["y"])))
        w = int(round(float(box["w"])))
        h = int(round(float(box["h"])))
    except (KeyError, TypeError, ValueError):
        return None

    x = max(0, min(x, width - 1))
    y = max(0, min(y, height - 1))
    w = max(1, min(w, width - x))
    h = max(1, min(h, height - y))
    return {"x": x, "y": y, "w": w, "h": h}


def iou(a: Dict[str, int], b: Dict[str, int]) -> float:
    ax2 = a["x"] + a["w"]
    ay2 = a["y"] + a["h"]
    bx2 = b["x"] + b["w"]
    by2 = b["y"] + b["h"]
    ix1 = max(a["x"], b["x"])
    iy1 = max(a["y"], b["y"])
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union else 0.0


def cv_candidates(
    image_path: Path,
    width: int,
    height: int,
    min_area: int,
    min_width: int,
    min_height: int,
) -> List[Dict[str, Any]]:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        return []

    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []

    blur = cv2.GaussianBlur(img, (3, 3), 0)
    grad = cv2.morphologyEx(
        blur,
        cv2.MORPH_GRADIENT,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
    )
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(
        bw,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3)),
        iterations=1,
    )

    num, _labels, stats, _centroids = cv2.connectedComponentsWithStats(closed, 8)
    regions: List[Dict[str, Any]] = []
    for idx in range(1, num):
        x, y, w, h, area = [int(v) for v in stats[idx]]
        box = clamp_box({"x": x, "y": y, "w": w, "h": h}, width, height)
        if not box:
            continue
        if area < min_area or box["w"] < min_width or box["h"] < min_height:
            continue
        if box["w"] > width * 0.98 and box["h"] > height * 0.20:
            continue
        aspect = box["w"] / max(1, box["h"])
        confidence = min(0.72, max(0.18, 0.20 + min(aspect, 12) / 20 + min(area, 5000) / 20000))
        regions.append(
            {
                "bbox": box,
                "source": "cv_candidate",
                "confidence": round(confidence, 3),
                "evidence": {
                    "detector": "opencv_morphology",
                    "componentArea": area,
                    "notes": "Candidate only; resolve class and corrected text by visual review.",
                },
            }
        )

    regions.sort(key=lambda r: (r["bbox"]["y"], r["bbox"]["x"]))
    return merge_overlapping_candidates(regions)


def ocr_candidates(image_path: Path, width: int, height: int, lang: str) -> List[Dict[str, Any]]:
    try:
        from PIL import Image
        import pytesseract  # type: ignore
        from pytesseract import Output  # type: ignore
    except ImportError:
        return []

    with Image.open(image_path) as im:
        data = pytesseract.image_to_data(im, lang=lang, output_type=Output.DICT)

    regions: List[Dict[str, Any]] = []
    n = len(data.get("text", []))
    for i in range(n):
        text = str(data["text"][i]).strip()
        if not text:
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        box = clamp_box(
            {
                "x": data["left"][i],
                "y": data["top"][i],
                "w": data["width"][i],
                "h": data["height"][i],
            },
            width,
            height,
        )
        if not box:
            continue
        regions.append(
            {
                "bbox": box,
                "source": "ocr_candidate",
                "confidence": round(max(0.0, min(conf / 100.0, 1.0)), 3),
                "evidence": {
                    "detector": "pytesseract",
                    "ocrText": text,
                    "ocrConfidence": conf,
                    "notes": "OCR evidence only; do not use as corrected text without review.",
                },
            }
        )
    return regions


def merge_overlapping_candidates(regions: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for region in regions:
        box = region["bbox"]
        match = None
        for existing in merged:
            if iou(box, existing["bbox"]) >= 0.35:
                match = existing
                break
        if not match:
            merged.append(region)
            continue
        xb = min(match["bbox"]["x"], box["x"])
        yb = min(match["bbox"]["y"], box["y"])
        x2 = max(match["bbox"]["x"] + match["bbox"]["w"], box["x"] + box["w"])
        y2 = max(match["bbox"]["y"] + match["bbox"]["h"], box["y"] + box["h"])
        match["bbox"] = {"x": xb, "y": yb, "w": x2 - xb, "h": y2 - yb}
        match["confidence"] = max(float(match.get("confidence", 0)), float(region.get("confidence", 0)))
        match.setdefault("evidence", {}).setdefault("mergedSources", []).append(region.get("source", "unknown"))
        if region.get("evidence", {}).get("ocrText"):
            match.setdefault("evidence", {})["ocrText"] = region["evidence"]["ocrText"]
            match["evidence"]["ocrConfidence"] = region["evidence"].get("ocrConfidence")
    merged.sort(key=lambda r: (r["bbox"]["y"], r["bbox"]["x"]))
    return merged


def load_manual_regions(path: Optional[Path], width: int, height: int) -> List[Dict[str, Any]]:
    if not path:
        return []
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    raw_regions = data.get("regions", data) if isinstance(data, dict) else data
    if not isinstance(raw_regions, list):
        raise SystemExit("--manual-regions must be a JSON list or an object with a regions list")

    regions: List[Dict[str, Any]] = []
    for idx, raw in enumerate(raw_regions, 1):
        if not isinstance(raw, dict):
            continue
        box = clamp_box(raw.get("bbox", raw), width, height)
        if not box:
            continue
        region = dict(raw)
        region["bbox"] = box
        region.setdefault("id", f"m{idx:03d}")
        region.setdefault("class", "unknown_text")
        region.setdefault("source", "manual")
        region.setdefault("confidence", 1.0)
        region.setdefault("evidence", {})
        region["evidence"].setdefault("notes", "Manual region; verify class and text policy.")
        regions.append(region)
    return regions


def assign_ids(regions: List[Dict[str, Any]]) -> None:
    used = {str(r.get("id")) for r in regions if r.get("id")}
    counter = 1
    for region in regions:
        if region.get("id"):
            continue
        while f"r{counter:03d}" in used:
            counter += 1
        region["id"] = f"r{counter:03d}"
        used.add(region["id"])
        counter += 1


def default_region(candidate: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": candidate.get("id", ""),
        "class": candidate.get("class", "unknown_text"),
        "bbox": candidate["bbox"],
        "source": candidate.get("source", "cv_candidate"),
        "confidence": candidate.get("confidence", 0.0),
        "correctedText": candidate.get("correctedText", ""),
        "language": candidate.get("language", ""),
        "role": candidate.get("role", ""),
        "evidence": candidate.get("evidence", {}),
        "inpaint": candidate.get("inpaint", {"allowed": True, "paddingPx": 2}),
    }


def build_document(
    image_path: Path,
    slide_id: str,
    width: int,
    height: int,
    regions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    assign_ids(regions)
    source_hash = sha256_file(image_path)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "slideId": slide_id,
        "sourceImage": str(image_path),
        "sourceImageHash": source_hash,
        "coordinateSpace": {
            "width": width,
            "height": height,
            "units": "source_px",
        },
        "image": {
            "width": width,
            "height": height,
            "sha256": source_hash,
        },
        "status": "draft",
        "policy": {
            "ocrIsEvidenceOnly": True,
            "inpaintingIsBackgroundCleanupOnly": True,
            "nativeReconstructionRequiredForSemanticText": True,
        },
        "regions": [default_region(r) for r in regions],
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate text-like candidate regions. OCR/CV output is evidence only."
    )
    parser.add_argument("--image", required=True, help="Source slide image path")
    parser.add_argument("--slide-id", help="Slide id, for example slide01")
    parser.add_argument("--out", required=True, help="Output text_regions.json path")
    parser.add_argument("--manual-regions", help="Optional manual JSON regions to seed or override")
    parser.add_argument("--ocr", choices=["none", "tesseract"], default="none", help="Optional OCR evidence")
    parser.add_argument("--ocr-lang", default="eng", help="Tesseract language code")
    parser.add_argument("--min-area", type=int, default=24, help="Minimum connected component area")
    parser.add_argument("--min-width", type=int, default=4, help="Minimum candidate width in pixels")
    parser.add_argument("--min-height", type=int, default=4, help="Minimum candidate height in pixels")
    parser.add_argument("--force", action="store_true", help="Overwrite output if it exists")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    image_path = Path(args.image)
    out_path = Path(args.out)
    if not image_path.exists():
        print(f"error: source image not found: {image_path}", file=sys.stderr)
        return 2
    if out_path.exists() and not args.force:
        print(f"error: output exists; pass --force to overwrite: {out_path}", file=sys.stderr)
        return 2

    width, height = read_image_size(image_path)
    manual = load_manual_regions(Path(args.manual_regions) if args.manual_regions else None, width, height)
    cv = cv_candidates(image_path, width, height, args.min_area, args.min_width, args.min_height)
    ocr = ocr_candidates(image_path, width, height, args.ocr_lang) if args.ocr == "tesseract" else []

    candidates = merge_overlapping_candidates(cv + ocr)
    regions = list(manual)
    for candidate in candidates:
        if any(iou(candidate["bbox"], existing["bbox"]) >= 0.45 for existing in regions):
            continue
        regions.append(candidate)

    slide_id = args.slide_id or image_path.stem
    doc = build_document(image_path, slide_id, width, height, regions)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"wrote {out_path} with {len(regions)} candidate regions")
    print("resolve classes and correctedText before mask generation; OCR/CV is evidence only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
