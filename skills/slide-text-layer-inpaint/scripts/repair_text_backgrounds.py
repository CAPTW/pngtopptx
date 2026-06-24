#!/usr/bin/env python3
"""Repair text backgrounds with redraw-first routing and selective inpainting."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


REDRAW_TYPES = {"flat_color", "panel", "table_cell"}
INPAINT_TYPES = {"gradient", "photo_texture"}
NATIVE_TYPES = {"rule_line"}
REVIEW_TYPES = {"icon_area", "chart_area", "complex_unknown"}
ALLOWED_METHODS = {"redraw", "inpaint", "manual_review", "native_reconstruct"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def slide_number(data: Dict[str, Any], fallback: str = "") -> Any:
    raw = str(data.get("slideId") or data.get("slide") or fallback)
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


def inpaint_allowed(region: Dict[str, Any]) -> bool:
    if region.get("inpaint", {}).get("allowed", True) is not True:
        return False
    if region.get("class") == "unknown_text" and not (
        region.get("exceptionApproved") is True and str(region.get("exceptionReason", "")).strip()
    ):
        return False
    return True


def sample_redraw_color(arr: Any, mask: Any, bbox: Dict[str, Any], pad: int = 10) -> Tuple[int, int, int]:
    import numpy as np

    height, width = arr.shape[:2]
    x1, y1, x2, y2 = clamp_box(bbox, width, height, pad)
    bx1, by1, bx2, by2 = clamp_box(bbox, width, height, 0)
    sample = arr[y1:y2, x1:x2]
    sample_mask = mask[y1:y2, x1:x2] > 0
    if sample.size == 0:
        return (0, 0, 0)
    ring = np.ones(sample.shape[:2], dtype=bool)
    ring[max(0, by1 - y1) : max(0, by2 - y1), max(0, bx1 - x1) : max(0, bx2 - x1)] = False
    candidates = sample[ring & ~sample_mask]
    if candidates.size < 24:
        candidates = sample[~sample_mask]
    if candidates.size < 24:
        candidates = sample.reshape((-1, 3))
    color = np.median(candidates.reshape((-1, 3)), axis=0)
    return tuple(int(max(0, min(255, round(v)))) for v in color)


def route_method(background_type: str) -> str:
    if background_type in REDRAW_TYPES:
        return "redraw"
    if background_type in INPAINT_TYPES:
        return "inpaint"
    if background_type in NATIVE_TYPES:
        return "native_reconstruct"
    return "manual_review"


def try_cv2_inpaint(arr: Any, method_mask: Any, radius: float) -> Tuple[Any, Optional[str]]:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        return arr, "OpenCV unavailable; inpaint regions require review or deterministic redraw fallback"

    if int(method_mask.max()) == 0:
        return arr, None
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    mask_u8 = np.where(method_mask > 0, 255, 0).astype("uint8")
    repaired = cv2.inpaint(bgr, mask_u8, float(radius), cv2.INPAINT_TELEA)
    return cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB), None


def risk_from_methods(methods: Dict[str, int], region_results: List[Dict[str, Any]]) -> Tuple[str, str, str]:
    if any(r["status"] == "fail" for r in region_results):
        return "fail", "high", "high"
    if methods["manualReview"] > 0 or methods["nativeReconstruct"] > 0:
        return "partial", "medium", "medium"
    if methods["inpaint"] > methods["redraw"]:
        return "pass", "medium", "medium"
    return "pass", "low", "low"


def write_report_md(path: Path, report: Dict[str, Any]) -> None:
    lines = [
        "# Background Repair Report",
        "",
        f"- slide: {report.get('slide', '')}",
        f"- status: {report.get('status', '')}",
        f"- artifactRisk: {report.get('artifactRisk', '')}",
        f"- residualTextRisk: {report.get('residualTextRisk', '')}",
        "",
        "## Methods Used",
        "",
    ]
    for key, value in report.get("methodsUsed", {}).items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Region Results", ""])
    for region in report.get("regions", []):
        lines.append(
            f"- {region.get('id')}: {region.get('type')} on {region.get('backgroundType')} -> "
            f"{region.get('repairMethod')} ({region.get('status')}, residual {region.get('residualRisk')})"
        )
        if region.get("notes"):
            lines.append(f"  - {region.get('notes')}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair text backgrounds with redraw-first routing")
    parser.add_argument("--image", required=True, help="Source slide image")
    parser.add_argument("--regions", required=True, help="Resolved text_regions.json")
    parser.add_argument("--background-regions", required=True, help="background_regions.json")
    parser.add_argument("--mask", required=True, help="Expanded inpaint_mask.png")
    parser.add_argument("--out", required=True, help="Output clean_background.png")
    parser.add_argument("--report-json", required=True, help="Output inpainting_report.json")
    parser.add_argument("--report-md", required=True, help="Output inpainting_report.md")
    parser.add_argument("--radius", type=float, default=3.0, help="OpenCV inpaint radius for texture/gradient areas")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    image_path = Path(args.image)
    regions_path = Path(args.regions)
    bg_path = Path(args.background_regions)
    mask_path = Path(args.mask)
    out_path = Path(args.out)
    report_json = Path(args.report_json)
    report_md = Path(args.report_md)

    for label, file_path in (
        ("image", image_path),
        ("regions", regions_path),
        ("background regions", bg_path),
        ("mask", mask_path),
    ):
        if not file_path.exists():
            print(f"error: {label} not found: {file_path}", file=sys.stderr)
            return 2

    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow and NumPy are required: pip install pillow numpy") from exc

    text_doc = load_json(regions_path)
    bg_doc = load_json(bg_path)
    regions = text_doc.get("regions", [])
    if not isinstance(regions, list):
        print("error: text_regions.json regions must be a list", file=sys.stderr)
        return 2
    bg_regions = {
        str(item.get("textRegionId")): item
        for item in bg_doc.get("regions", [])
        if isinstance(item, dict) and item.get("textRegionId")
    }

    with Image.open(image_path).convert("RGB") as im:
        arr = np.asarray(im).copy()
    with Image.open(mask_path).convert("L") as mask_im:
        mask = np.asarray(mask_im)
    if mask.shape[:2] != arr.shape[:2]:
        print("error: mask dimensions do not match source image", file=sys.stderr)
        return 2

    repaired = arr.copy()
    inpaint_mask = np.zeros(mask.shape, dtype="uint8")
    region_results: List[Dict[str, Any]] = []
    methods = {"redraw": 0, "inpaint": 0, "manualReview": 0, "nativeReconstruct": 0}

    for region in regions:
        if not isinstance(region, dict) or not inpaint_allowed(region):
            continue
        rid = str(region.get("id", ""))
        bg = bg_regions.get(rid, {})
        background_type = str(bg.get("backgroundType", "complex_unknown"))
        method = route_method(background_type)
        x1, y1, x2, y2 = clamp_box(region["bbox"], arr.shape[1], arr.shape[0], 8)
        local_mask = mask[y1:y2, x1:x2] > 0
        status = "pass"
        residual_risk = "low"
        notes = str(bg.get("notes", ""))

        if method == "redraw":
            color = sample_redraw_color(arr, mask, region["bbox"])
            crop = repaired[y1:y2, x1:x2]
            crop[local_mask] = color
            repaired[y1:y2, x1:x2] = crop
            methods["redraw"] += 1
            notes = f"{notes}; filled masked pixels with sampled color #{color[0]:02X}{color[1]:02X}{color[2]:02X}".strip("; ")
        elif method == "inpaint":
            inpaint_mask[y1:y2, x1:x2] = np.where(local_mask, 255, inpaint_mask[y1:y2, x1:x2])
            methods["inpaint"] += 1
            residual_risk = "medium" if background_type == "photo_texture" else "low"
        elif method == "native_reconstruct":
            methods["nativeReconstruct"] += 1
            status = "partial"
            residual_risk = "medium"
            notes = f"{notes}; rule-backed region requires native shape/rule reconstruction".strip("; ")
        else:
            methods["manualReview"] += 1
            status = "fail" if background_type == "complex_unknown" else "partial"
            residual_risk = "high" if background_type == "complex_unknown" else "medium"
            notes = f"{notes}; not repaired automatically to avoid removing meaningful structure".strip("; ")

        region_results.append(
            {
                "id": rid,
                "type": region.get("class", ""),
                "backgroundType": background_type,
                "repairMethod": method,
                "status": status,
                "residualRisk": residual_risk,
                "notes": notes,
            }
        )

    inpaint_error = None
    if methods["inpaint"] > 0:
        inpainted, inpaint_error = try_cv2_inpaint(arr, inpaint_mask, args.radius)
        if inpaint_error is None:
            repaired[inpaint_mask > 0] = inpainted[inpaint_mask > 0]
        else:
            for item in region_results:
                if item["repairMethod"] == "inpaint":
                    item["status"] = "partial"
                    item["residualRisk"] = "medium"
                    item["notes"] = f"{item['notes']}; {inpaint_error}".strip("; ")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(repaired).save(out_path)

    status, artifact_risk, residual_risk = risk_from_methods(methods, region_results)
    errors = [r["notes"] for r in region_results if r["status"] == "fail"]
    warnings = [r["notes"] for r in region_results if r["status"] == "partial"]
    report = {
        "schemaVersion": "slide-text-layer-inpaint.inpainting_report.v1",
        "slide": slide_number(text_doc, image_path.stem),
        "slideId": text_doc.get("slideId", ""),
        "status": status,
        "artifactRisk": artifact_risk,
        "methodsUsed": methods,
        "residualTextRisk": residual_risk,
        "regions": region_results,
        "sourceImage": str(image_path),
        "sourceImageSha256": sha256_file(image_path),
        "textRegions": str(regions_path),
        "textRegionsSha256": sha256_file(regions_path),
        "backgroundRegions": str(bg_path),
        "backgroundRegionsSha256": sha256_file(bg_path),
        "mask": str(mask_path),
        "maskSha256": sha256_file(mask_path),
        "cleanBackground": str(out_path),
        "cleanBackgroundSha256": sha256_file(out_path),
        "policy": {
            "backgroundCleanupOnly": True,
            "inpaintingOnly": False,
            "nativeReconstructionReplacement": False,
            "ocrIsEvidenceOnly": True,
        },
        "policyStatus": status,
        "warnings": warnings,
        "errors": errors,
    }

    report_json.parent.mkdir(parents=True, exist_ok=True)
    with report_json.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")
    write_report_md(report_md, report)

    print(f"wrote {out_path}")
    print(f"wrote {report_json}")
    print(f"wrote {report_md}")
    return 0 if status in {"pass", "partial"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
