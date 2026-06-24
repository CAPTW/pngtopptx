#!/usr/bin/env python3
"""Create clean background assets from a resolved inpaint mask."""

from __future__ import annotations

import argparse
import hashlib
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


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_regions(regions: Iterable[Dict[str, Any]]) -> List[str]:
    errors: List[str] = []
    for idx, region in enumerate(regions, 1):
        rid = str(region.get("id") or f"#{idx}")
        cls = region.get("class")
        if cls not in VALID_CLASSES:
            errors.append(f"{rid}: invalid class {cls!r}")
        if cls == "semantic_text" and not str(region.get("correctedText", "")).strip():
            errors.append(f"{rid}: semantic_text requires correctedText")
        if cls in {"pseudo_text", "decorative_glyph"}:
            if str(region.get("correctedText", "")).strip():
                errors.append(f"{rid}: {cls} must not have correctedText")
            if str(region.get("nativeText", "")).strip():
                errors.append(f"{rid}: {cls} must not have nativeText")
        if cls == "unknown_text" and not (
            region.get("exceptionApproved") is True and str(region.get("exceptionReason", "")).strip()
        ):
            errors.append(f"{rid}: unknown_text must be resolved or exception-approved before inpainting")
    return errors


def read_image_shape(image_path: Path, mask_path: Path) -> Tuple[int, int, int]:
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit("Pillow is required: pip install pillow") from exc

    with Image.open(image_path) as im:
        width, height = im.size
    with Image.open(mask_path) as mask:
        if mask.size != (width, height):
            raise SystemExit(
                f"mask size {mask.size[0]}x{mask.size[1]} does not match image size {width}x{height}"
            )
    return width, height, width * height


def inpaint(image_path: Path, mask_path: Path, out_path: Path, method: str, radius: float) -> Tuple[int, int]:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as exc:
        raise SystemExit("OpenCV and NumPy are required: pip install opencv-python numpy") from exc

    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise SystemExit(f"could not read image: {image_path}")
    if mask is None:
        raise SystemExit(f"could not read mask: {mask_path}")
    mask = np.where(mask > 0, 255, 0).astype("uint8")
    nonzero = int(np.count_nonzero(mask))
    flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
    result = cv2.inpaint(image, mask, float(radius), flag)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out_path), result):
        raise SystemExit(f"could not write clean background: {out_path}")
    return nonzero, int(mask.size)


def write_report(
    report_json: Path,
    report_md: Path,
    report: Dict[str, Any],
) -> None:
    report_json.parent.mkdir(parents=True, exist_ok=True)
    with report_json.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")

    lines = [
        "# Inpainting Report",
        "",
        f"- slideId: {report.get('slideId', '')}",
        f"- status: {report.get('status', '')}",
        f"- artifactRisk: {report.get('artifactRisk', '')}",
        f"- residualTextRisk: {report.get('residualTextRisk', '')}",
        f"- sourceImage: {report.get('sourceImage', '')}",
        f"- cleanBackground: {report.get('cleanBackground', '')}",
        f"- method: {report.get('method', '')}",
        f"- radius: {report.get('radius', '')}",
        f"- maskCoverage: {report.get('maskCoverageRatio', 0):.6f}",
        f"- policyStatus: {report.get('policyStatus', '')}",
        "",
        "## Policy",
        "",
        "- Inpainting is background cleanup only.",
        "- Clean background is not a substitute for native reconstruction.",
        "- Semantic text must still be reconstructed downstream as native editable text.",
        "",
        "## Region Counts",
        "",
    ]
    for cls, count in sorted(report.get("regionCounts", {}).items()):
        lines.append(f"- {cls}: {count}")
    if report.get("methodsUsed"):
        lines.extend(["", "## Methods Used", ""])
        for method, count in sorted(report["methodsUsed"].items()):
            lines.append(f"- {method}: {count}")
    if report.get("regions"):
        lines.extend(["", "## Region Results", ""])
        for region in report["regions"]:
            lines.append(
                f"- {region.get('id')}: {region.get('type')} on {region.get('backgroundType')} -> "
                f"{region.get('repairMethod')} ({region.get('status')}, residual {region.get('residualRisk')})"
            )
            if region.get("notes"):
                lines.append(f"  - {region.get('notes')}")
    if report.get("errors"):
        lines.extend(["", "## Errors", ""])
        lines.extend([f"- {e}" for e in report["errors"]])
    if report.get("warnings"):
        lines.extend(["", "## Warnings", ""])
        lines.extend([f"- {w}" for w in report["warnings"]])
    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inpaint approved text-layer regions into a clean background")
    parser.add_argument("--image", required=True, help="Source slide image")
    parser.add_argument("--regions", required=True, help="Resolved text_regions.json")
    parser.add_argument("--mask", required=True, help="inpaint_mask.png")
    parser.add_argument("--out", required=True, help="Output clean_background.png")
    parser.add_argument("--report-json", required=True, help="Output inpainting_report.json")
    parser.add_argument("--report-md", required=True, help="Output inpainting_report.md")
    parser.add_argument("--method", choices=["telea", "ns"], default="telea", help="OpenCV inpaint method")
    parser.add_argument("--radius", type=float, default=3.0, help="OpenCV inpaint radius")
    parser.add_argument("--max-coverage", type=float, default=0.25, help="Maximum allowed mask coverage ratio")
    parser.add_argument(
        "--allow-high-coverage",
        action="store_true",
        help="Allow masks above --max-coverage and record a warning",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    image_path = Path(args.image)
    regions_path = Path(args.regions)
    mask_path = Path(args.mask)
    out_path = Path(args.out)
    report_json = Path(args.report_json)
    report_md = Path(args.report_md)

    for label, path in (("image", image_path), ("regions", regions_path), ("mask", mask_path)):
        if not path.exists():
            print(f"error: {label} not found: {path}", file=sys.stderr)
            return 2

    data = load_json(regions_path)
    regions = data.get("regions", [])
    if not isinstance(regions, list):
        print("error: text_regions.json regions must be a list", file=sys.stderr)
        return 2

    width, height, pixels = read_image_shape(image_path, mask_path)
    errors = validate_regions(regions)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 2

    mask_pixels, total_pixels = inpaint(image_path, mask_path, out_path, args.method, args.radius)
    coverage = mask_pixels / max(1, total_pixels)
    warnings: List[str] = []
    policy_status = "pass"
    if coverage > args.max_coverage:
        message = f"mask coverage {coverage:.6f} exceeds max coverage {args.max_coverage:.6f}"
        if args.allow_high_coverage:
            warnings.append(message)
            policy_status = "pass_with_exception"
        else:
            policy_status = "fail"
            errors.append(message)

    counts: Dict[str, int] = {}
    for region in regions:
        counts[str(region.get("class", "unknown"))] = counts.get(str(region.get("class", "unknown")), 0) + 1
    repaired_regions = [
        r
        for r in regions
        if r.get("inpaint", {}).get("allowed", True) is True
        and (
            r.get("class") != "unknown_text"
            or (r.get("exceptionApproved") is True and str(r.get("exceptionReason", "")).strip())
        )
    ]
    residual_risk = "high" if coverage > 0.18 else "medium" if coverage > 0.06 else "low"
    artifact_risk = "high" if coverage > args.max_coverage else "medium" if coverage > 0.10 else "low"
    status = "fail" if errors else "pass"
    region_reports = [
        {
            "id": str(region.get("id", "")),
            "type": region.get("class", ""),
            "backgroundType": "complex_unknown",
            "repairMethod": "inpaint",
            "status": "pass" if not errors else "fail",
            "residualRisk": residual_risk,
            "notes": "generic inpaint path; run classify_background_regions.py and repair_text_backgrounds.py for redraw-first repair",
        }
        for region in repaired_regions
    ]

    report = {
        "schemaVersion": "slide-text-layer-inpaint.inpainting_report.v1",
        "slide": data.get("slideId", ""),
        "slideId": data.get("slideId", ""),
        "status": status,
        "artifactRisk": artifact_risk,
        "methodsUsed": {
            "redraw": 0,
            "inpaint": len(repaired_regions),
            "manualReview": 0,
            "nativeReconstruct": 0,
        },
        "residualTextRisk": residual_risk,
        "regions": region_reports,
        "sourceImage": str(image_path),
        "sourceImageSha256": sha256_file(image_path),
        "textRegions": str(regions_path),
        "textRegionsSha256": sha256_file(regions_path),
        "mask": str(mask_path),
        "maskSha256": sha256_file(mask_path),
        "cleanBackground": str(out_path),
        "cleanBackgroundSha256": sha256_file(out_path),
        "imageSize": {"width": width, "height": height},
        "method": args.method,
        "radius": args.radius,
        "maskPixels": mask_pixels,
        "totalPixels": pixels,
        "maskCoverageRatio": coverage,
        "maxCoverageRatio": args.max_coverage,
        "regionCounts": counts,
        "policy": {
            "backgroundCleanupOnly": True,
            "inpaintingOnly": True,
            "nativeReconstructionReplacement": False,
            "ocrIsEvidenceOnly": True,
        },
        "policyStatus": policy_status,
        "warnings": warnings,
        "errors": errors,
    }
    write_report(report_json, report_md, report)

    if errors and not args.allow_high_coverage:
        print(f"error: inpainting policy failed; reports written to {report_json} and {report_md}", file=sys.stderr)
        return 2

    print(f"wrote {out_path}")
    print(f"wrote {report_json}")
    print(f"wrote {report_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
