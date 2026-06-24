#!/usr/bin/env python3
"""Compare source slide images against PPTX rasters and HTML screenshots."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
from datetime import datetime, timezone
from typing import Any


Image = None
ImageDraw = None
np = None

DEFAULT_PROFILE_PATH = Path(__file__).resolve().parents[1] / "assets" / "calibration" / "default-visual-qa-profile.json"
SEVERITY_SCORE = {"pass": 0, "minor": 1, "noticeable": 2, "blocking": 3}
EXPLICIT_BLOCKING_SIGNAL_TYPES = {
    "missing_artifact",
    "missing_content",
    "full_slide_shortcut",
    "crop_shortcut",
    "content_loss",
    "missing_key_content",
    "clipping",
    "layout_break",
    "readability_loss",
    "wrong_slide",
}
TECHNICAL_DETAIL_TERMS = {
    "cargo pump",
    "pump",
    "hpu",
    "hydraulic",
    "power unit",
    "power supply",
    "esd",
    "discharge valve",
    "stripping",
    "heating",
    "cooling",
    "manifold",
    "valve",
}
SCHEMATIC_TERMS = {
    "cargo system flow",
    "line routing",
    "routing control",
    "liquid flow",
    "vapour return",
    "drain",
    "sample point",
    "deck line",
    "flow",
}
BOARD_TERMS = {"line-up board", "lineup board", "board", "open", "closed", "isolated", "date / time", "sign"}
STOP_FLOW_TERMS = {"stop criteria", "trigger", "wrong line-up suspicion"}
NO_TEXT_CROP_TYPES = {"text", "table", "label", "semantic_text", "pseudo_text", "micro_text"}
CROP_METADATA_FIELDS = ["content_type", "reconstruction_reason", "editable_replacement", "allow_large_crop"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_slides(value: str | None) -> list[int]:
    if not value:
        raise argparse.ArgumentTypeError("--slides is required")
    slides: list[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
            if start <= 0 or end < start:
                raise argparse.ArgumentTypeError(f"invalid slide range: {part}")
            slides.extend(range(start, end + 1))
        else:
            slide = int(part)
            if slide <= 0:
                raise argparse.ArgumentTypeError(f"invalid slide number: {part}")
            slides.append(slide)
    return sorted(dict.fromkeys(slides))


def resolve_path(project: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project / path
    return path.resolve()


def slide_dir_name(slide: int) -> str:
    return f"slide{slide:02d}"


def write_json(path: Path, payload: dict[str, Any]) -> None:
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


def source_path(source_dir: Path, slide: int) -> Path | None:
    candidates = [
        source_dir / f"slide{slide}.png",
        source_dir / f"slide{slide:02d}.png",
        source_dir / f"slide-{slide}.png",
        source_dir / f"slide-{slide:02d}.png",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def load_rgb(path: Path):
    return Image.open(path).convert("RGB")


def resample_filter():
    return getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def as_float_array(image):
    return np.asarray(image, dtype=np.float32) / 255.0


def grayscale(arr):
    return arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114


def resize_to_source(render_img, source_size: tuple[int, int]):
    if render_img.size == source_size:
        return render_img, False
    return render_img.resize(source_size, resample_filter()), True


def try_ssim(source_arr, render_arr) -> float | None:
    try:
        from skimage.metrics import structural_similarity  # type: ignore
    except Exception:
        return None
    try:
        return float(
            structural_similarity(
                grayscale(source_arr),
                grayscale(render_arr),
                data_range=1.0,
            )
        )
    except Exception:
        return None


def edge_mask(arr):
    gray = grayscale(arr)
    try:
        import cv2  # type: ignore

        u8 = np.clip(gray * 255.0, 0, 255).astype(np.uint8)
        return cv2.Canny(u8, 50, 150) > 0
    except Exception:
        gx = np.zeros_like(gray)
        gy = np.zeros_like(gray)
        gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
        gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
        mag = np.sqrt(gx * gx + gy * gy)
        if float(mag.max()) <= 0:
            return mag > 1.0
        threshold = max(float(np.percentile(mag, 85)), 0.04)
        return mag > threshold


def color_palette_drift(source_arr, render_arr) -> float:
    bins = 8
    src = source_arr.reshape(-1, 3)
    rnd = render_arr.reshape(-1, 3)
    src_hist, _ = np.histogramdd(src, bins=bins, range=((0, 1), (0, 1), (0, 1)))
    rnd_hist, _ = np.histogramdd(rnd, bins=bins, range=((0, 1), (0, 1), (0, 1)))
    src_hist = src_hist / max(float(src_hist.sum()), 1.0)
    rnd_hist = rnd_hist / max(float(rnd_hist.sum()), 1.0)
    return float(0.5 * np.abs(src_hist - rnd_hist).sum())


def bounding_box(mask) -> dict[str, int]:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1}


def write_diff_image(path: Path, source_arr, delta):
    heat = np.clip(delta / max(float(delta.mean()) * 3.0, 0.04), 0, 1)
    red = np.zeros_like(source_arr)
    red[..., 0] = 1.0
    out = source_arr * (1.0 - 0.65 * heat[..., None]) + red * (0.65 * heat[..., None])
    Image.fromarray(np.clip(out * 255.0, 0, 255).astype(np.uint8)).save(path)


def write_edge_diff_image(path: Path, source_arr, source_edges, render_edges):
    out = np.clip(source_arr * 0.65 + 0.2, 0, 1)
    source_only = np.logical_and(source_edges, np.logical_not(render_edges))
    render_only = np.logical_and(render_edges, np.logical_not(source_edges))
    out[source_only] = np.array([1.0, 0.82, 0.0])
    out[render_only] = np.array([0.95, 0.0, 1.0])
    Image.fromarray(np.clip(out * 255.0, 0, 255).astype(np.uint8)).save(path)


def compare_arrays(source_arr, render_arr, pixel_threshold: float) -> dict[str, Any]:
    diff = np.abs(source_arr - render_arr)
    delta = diff.mean(axis=2)
    source_edges = edge_mask(source_arr)
    render_edges = edge_mask(render_arr)
    edge_xor = np.logical_xor(source_edges, render_edges)
    source_edge_density = float(source_edges.mean())
    render_edge_density = float(render_edges.mean())
    return {
        "pixel_difference_ratio": float((delta > pixel_threshold).mean()),
        "mean_absolute_error": float(diff.mean()),
        "max_channel_error": float(diff.max()),
        "edge_difference_ratio": float(edge_xor.mean()),
        "source_edge_density": source_edge_density,
        "render_edge_density": render_edge_density,
        "edge_density_delta": float(source_edge_density - render_edge_density),
        "approx_ssim": try_ssim(source_arr, render_arr),
        "color_palette_drift": color_palette_drift(source_arr, render_arr),
        "diff_mask_bbox": bounding_box(delta > pixel_threshold),
        "edge_diff_bbox": bounding_box(edge_xor),
        "_delta": delta,
        "_source_edges": source_edges,
        "_render_edges": render_edges,
    }


def clean_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in metrics.items() if not k.startswith("_")}


def load_calibration_profile(profile_path: Path | None = None) -> dict[str, Any]:
    path = profile_path or DEFAULT_PROFILE_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {
        "schemaVersion": "slide-visual-polish-qa.calibration-profile.v1",
        "knownGoodMetricBands": {
            "sourceRenderSimilarity": {"pixelMax": 0.21, "maeMax": 0.105, "edgeMax": 0.115, "ssimMin": 0.6, "paletteMax": 0.15},
            "pptxHtmlConsistency": {"pixelMax": 0.11, "maeMax": 0.055, "edgeMax": 0.09, "ssimMin": 0.79, "paletteMax": 0.055},
        },
        "borderlineMetricBands": {
            "sourceRenderSimilarity": {"pixelMax": 0.24, "maeMax": 0.13, "edgeMax": 0.135, "ssimMin": 0.44, "paletteMax": 0.23},
            "pptxHtmlConsistency": {"pixelMax": 0.13, "maeMax": 0.065, "edgeMax": 0.09, "ssimMin": 0.74, "paletteMax": 0.07},
        },
        "knownBadMetricBands": {
            "sourceRenderSimilarity": {
                "pixelMin": 0.25,
                "maeMin": 0.14,
                "edgeMin": 0.145,
                "ssimMax": 0.42,
                "paletteMin": 0.28,
                "requiredSignalsForBlocking": 2,
            },
            "pptxHtmlConsistency": {
                "pixelMin": 0.13,
                "maeMin": 0.065,
                "edgeMin": 0.095,
                "ssimMax": 0.72,
                "paletteMin": 0.08,
                "requiredSignalsForBlocking": 3,
            },
        },
    }


def metric_number(metrics: dict[str, Any], key: str, default: float | None = None) -> float | None:
    value = metrics.get(key)
    if value is None:
        return default
    try:
        return float(value)
    except Exception:
        return default


def band_contains(metrics: dict[str, Any], band: dict[str, Any]) -> bool:
    checks = [
        ("pixel_difference_ratio", "pixelMax", "<="),
        ("mean_absolute_error", "maeMax", "<="),
        ("edge_difference_ratio", "edgeMax", "<="),
        ("color_palette_drift", "paletteMax", "<="),
        ("approx_ssim", "ssimMin", ">="),
    ]
    for metric_key, band_key, op in checks:
        if band_key not in band:
            continue
        value = metric_number(metrics, metric_key)
        if value is None:
            return False
        threshold = float(band[band_key])
        if op == "<=" and value > threshold:
            return False
        if op == ">=" and value < threshold:
            return False
    return True


def known_bad_signals(metrics: dict[str, Any], band: dict[str, Any]) -> list[dict[str, Any]]:
    checks = [
        ("pixel_difference_ratio", "pixelMin", ">=", "pixel_high"),
        ("mean_absolute_error", "maeMin", ">=", "mae_high"),
        ("edge_difference_ratio", "edgeMin", ">=", "edge_high"),
        ("color_palette_drift", "paletteMin", ">=", "palette_high"),
        ("approx_ssim", "ssimMax", "<=", "ssim_low"),
    ]
    signals: list[dict[str, Any]] = []
    for metric_key, band_key, op, name in checks:
        if band_key not in band:
            continue
        value = metric_number(metrics, metric_key)
        if value is None:
            continue
        threshold = float(band[band_key])
        tripped = value >= threshold if op == ">=" else value <= threshold
        if tripped:
            signals.append({"signal": name, "metric": metric_key, "value": value, "threshold": threshold})
    return signals


def classify_comparison_metrics(
    metrics: dict[str, Any],
    comparison_kind: str,
    profile: dict[str, Any],
    *,
    source_blocking: bool = False,
    explicit_blocking: bool = False,
) -> dict[str, Any]:
    good_band = profile.get("knownGoodMetricBands", {}).get(comparison_kind, {})
    borderline_band = profile.get("borderlineMetricBands", {}).get(comparison_kind, {})
    bad_band = profile.get("knownBadMetricBands", {}).get(comparison_kind, {})
    bad_signals = known_bad_signals(metrics, bad_band)
    required = int(bad_band.get("requiredSignalsForBlocking", 2))
    within_good = band_contains(metrics, good_band)
    within_borderline = band_contains(metrics, borderline_band)
    classification = "out_of_band"
    severity = "noticeable"
    rationale: list[str] = []

    if len(bad_signals) >= required:
        if comparison_kind == "pptxHtmlConsistency" and not (source_blocking or explicit_blocking):
            classification = "material_mismatch_needs_review"
            severity = "noticeable"
            rationale.append(
                "PPTX/HTML metrics are material, but no key-content, clipping, layout, readability, or source-render blocking signal was present."
            )
        else:
            classification = "known_bad_like"
            severity = "blocking"
            rationale.append(f"{len(bad_signals)} known-bad metric signals exceeded calibrated guardrails.")
    elif within_good:
        classification = "known_good_like"
        severity = "minor"
        rationale.append("Metrics fall inside the calibrated known-good editable reconstruction band.")
    elif within_borderline:
        classification = "borderline_like"
        severity = "noticeable"
        rationale.append("Metrics fall inside the calibrated borderline band.")
    else:
        severity = "noticeable"
        rationale.append("Metrics fall outside known-good and borderline bands but do not trip enough known-bad signals.")

    return {
        "comparisonKind": comparison_kind,
        "classification": classification,
        "severity": severity,
        "withinKnownGoodBand": within_good,
        "withinBorderlineBand": within_borderline,
        "knownBadSignals": bad_signals,
        "signalCount": len(bad_signals),
        "sourceBlockingContext": source_blocking,
        "explicitBlockingContext": explicit_blocking,
        "rationale": rationale,
    }


def classify_visual_result(
    slide: int,
    mode: str,
    comparisons: dict[str, Any],
    issue_signals: list[dict[str, Any]] | None = None,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profile = profile or load_calibration_profile()
    issue_signals = issue_signals or []
    metric_signals: dict[str, Any] = {}
    severity_values: list[str] = []
    rationale: list[str] = []
    source_results: list[dict[str, Any]] = []

    for label in ("pptx_vs_source", "html_vs_source"):
        metrics = comparisons.get(label)
        if not isinstance(metrics, dict) or "pixel_difference_ratio" not in metrics:
            continue
        result = classify_comparison_metrics(metrics, "sourceRenderSimilarity", profile)
        metric_signals[label] = result
        source_results.append(result)
        severity_values.append(result["severity"])
        rationale.extend(f"{label}: {item}" for item in result["rationale"])

    source_severity = max_severity([item["severity"] for item in source_results])
    source_blocking = source_severity == "blocking"
    explicit_blocking = any(
        signal.get("severity") == "blocking" and signal.get("type") in EXPLICIT_BLOCKING_SIGNAL_TYPES for signal in issue_signals
    )

    pptx_html_result = None
    pptx_html = comparisons.get("pptx_vs_html")
    if isinstance(pptx_html, dict) and "pixel_difference_ratio" in pptx_html:
        pptx_html_result = classify_comparison_metrics(
            pptx_html,
            "pptxHtmlConsistency",
            profile,
            source_blocking=source_blocking,
            explicit_blocking=explicit_blocking,
        )
        metric_signals["pptx_vs_html"] = pptx_html_result
        severity_values.append(pptx_html_result["severity"])
        rationale.extend(f"pptx_vs_html: {item}" for item in pptx_html_result["rationale"])

    for signal in issue_signals:
        severity_values.append(str(signal.get("severity", "noticeable")))
        if signal.get("rationale"):
            rationale.append(str(signal["rationale"]))

    severity = max_severity(severity_values)
    status = status_for_severity(severity)
    editable_tolerance = mode in {"qa-draft", "qa-polish"} and severity in {"minor", "noticeable"} and not explicit_blocking
    if editable_tolerance:
        rationale.append("Editable reconstruction tolerance was applied; metrics are used as evidence rather than raw-threshold failure.")

    confidence = 0.72
    if explicit_blocking or severity == "blocking":
        confidence = 0.9
    elif all(item.get("withinKnownGoodBand") for item in source_results) and (
        pptx_html_result is None or pptx_html_result.get("withinKnownGoodBand")
    ):
        confidence = 0.86
    elif severity == "noticeable":
        confidence = 0.78

    return {
        "overallStatus": status,
        "status": status,
        "severity": severity,
        "metricSignals": metric_signals,
        "issueSignals": issue_signals,
        "pptxHtmlConsistency": pptx_html_result
        or {
            "available": False,
            "severity": "pass",
            "classification": "not_available",
            "rationale": ["PPTX/HTML comparison was not available."],
        },
        "sourceRenderSimilarity": {
            "severity": source_severity,
            "comparisons": source_results,
            "classification": max(
                (item.get("classification", "not_available") for item in source_results),
                key=lambda value: SEVERITY_SCORE.get(
                    next((item["severity"] for item in source_results if item.get("classification") == value), "pass"),
                    0,
                ),
                default="not_available",
            ),
        },
        "editableReconstructionToleranceApplied": editable_tolerance,
        "confidence": round(confidence, 3),
        "rationale": rationale,
        "calibrationProfile": profile.get("name", "default-visual-qa-profile"),
    }


def severity_for_metrics(
    metrics: dict[str, Any],
    ssim_threshold: float,
    pixel_threshold: float,
    edge_threshold: float,
    comparison_kind: str = "sourceRenderSimilarity",
    profile: dict[str, Any] | None = None,
    source_blocking: bool = False,
    explicit_blocking: bool = False,
) -> str:
    del ssim_threshold, pixel_threshold, edge_threshold
    return classify_comparison_metrics(
        metrics,
        comparison_kind,
        profile or load_calibration_profile(),
        source_blocking=source_blocking,
        explicit_blocking=explicit_blocking,
    )["severity"]


def max_severity(severities: list[str]) -> str:
    order = {"pass": 0, "minor": 1, "noticeable": 2, "blocking": 3}
    return max(severities, key=lambda item: order.get(item, 0), default="pass")


def status_for_severity(severity: str) -> str:
    if severity == "blocking":
        return "fail"
    if severity == "noticeable":
        return "needs_polish"
    return "pass"


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def non_text_crop_policy(focus: str) -> dict[str, Any]:
    allowed = ["3d", "technical", "decorative", "texture", "photo"]
    if focus == "board_texture":
        allowed = ["decorative", "texture", "3d"]
    return {
        "allowedWhen": "Only after native reconstruction of text, tables, labels, and structural lines remains visibly worse than the source.",
        "allowedContentTypes": allowed,
        "forbiddenContentTypes": sorted(NO_TEXT_CROP_TYPES),
        "requiredMetadata": CROP_METADATA_FIELDS + ["reason when allow_large_crop is true or an exception is needed"],
        "mustAvoidTextRegions": True,
        "maxScope": "small local non-text detail only; never a full-slide, text, table, or label crop",
    }


def crop_policy_allows_content_type(issue: dict[str, Any], content_type: str) -> bool:
    policy = issue.get("cropPolicy") if isinstance(issue, dict) else None
    if not isinstance(policy, dict):
        return False
    normalized = str(content_type).strip().lower()
    forbidden = {str(item).lower() for item in policy.get("forbiddenContentTypes", [])}
    allowed = {str(item).lower() for item in policy.get("allowedContentTypes", [])}
    if normalized in forbidden:
        return False
    return normalized in allowed


def issue_plan_for_metrics(slide: int, label: str, metrics: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    tags = set(context.get("domainTags", []))
    palette = safe_float(metrics.get("color_palette_drift"))
    edge = safe_float(metrics.get("edge_difference_ratio"))
    pixel = safe_float(metrics.get("pixel_difference_ratio"))
    edge_delta = safe_float(metrics.get("edge_density_delta"))
    comparison = "pptx_html" if label == "pptx_vs_html" else "source_render"
    high_palette = palette >= 0.22
    high_edge = edge >= 0.135
    source_edge_low = edge_delta >= 0.006 and edge >= 0.10
    out_of_band = metrics.get("classification") == "out_of_band"
    base_extra: dict[str, Any] = {
        "comparison": label,
        "safeToAutoApply": False,
        "cropAllowed": False,
        "cropPolicy": {
            "forbiddenContentTypes": sorted(NO_TEXT_CROP_TYPES),
            "requiredMetadata": CROP_METADATA_FIELDS,
            "mustAvoidTextRegions": True,
        },
        "secondaryIssueTypes": [],
    }

    if comparison == "pptx_html":
        issue_type = "pptx_html_edge_mismatch" if edge >= 0.095 or edge > pixel * 0.75 else "pptx_html_mismatch"
        base_extra["fixStrategy"] = "helper_layout_parity"
        return {
            "type": issue_type,
            "observed": "PPTX raster and HTML screenshot disagree at a noticeable level.",
            "expected": "PPTX and HTML should replay the same reconstruction in the same source-pixel coordinate space.",
            "likelyCause": "Helper usage, text box geometry, line/rule normalization, font fallback, or surface-specific layout behavior diverged.",
            "recommendedFix": "Fix the per-slide helper usage or shared helper parity while preserving hardlock gates; do not relax visual thresholds or accept scaled screenshots.",
            "extra": base_extra,
        }

    if "board" in tags and high_palette:
        base_extra.update(
            {
                "fixStrategy": "native_board_structure_plus_non_text_texture",
                "cropAllowed": True,
                "cropPolicy": non_text_crop_policy("board_texture"),
                "secondaryIssueTypes": ["palette_drift", "non_text_detail_crop_candidate"],
            }
        )
        return {
            "type": "board_texture_missing",
            "observed": "Board or panel material differs from the source enough to drive palette drift.",
            "expected": "Board structure, text, table/status content, and labels stay native while non-text surface texture is locally preserved when needed.",
            "likelyCause": "The reconstruction uses flat native fills for a textured board or panel area.",
            "recommendedFix": "Keep board text, table cells, headers, and status labels native; add native board/rule density first, then consider small metadata-rich non-text decorative texture crops only for surface material.",
            "extra": base_extra,
        }

    if "stop_flow" in tags and (high_edge or high_palette or source_edge_low):
        base_extra.update(
            {
                "fixStrategy": "native_stop_flow_detail_density",
                "secondaryIssueTypes": ["edge_density_low" if source_edge_low or high_edge else "palette_drift"],
            }
        )
        return {
            "type": "missing_detail_density",
            "observed": "STOP or flow-control decoration is less dense than the source.",
            "expected": "STOP/flow emphasis should retain source-like halos, rules, connectors, icons, and color emphasis as native editable objects.",
            "likelyCause": "Native reconstruction simplified technical decoration, connector density, or color emphasis.",
            "recommendedFix": "Increase native halo/rule/icon/connector density and color emphasis in the per-slide fragment; do not use text/table crops or threshold relaxation.",
            "extra": base_extra,
        }

    if "technical_diagram" in tags and (high_edge or high_palette or source_edge_low):
        base_extra.update(
            {
                "fixStrategy": "native_technical_density_then_small_non_text_crops",
                "cropAllowed": True,
                "cropPolicy": non_text_crop_policy("technical_detail"),
                "secondaryIssueTypes": ["edge_density_low", "non_text_detail_crop_candidate"],
            }
        )
        return {
            "type": "technical_diagram_under_detailed",
            "observed": "Technical diagram detail density is lower or visually flatter than the source.",
            "expected": "Semantic text, labels, tables, and callouts remain native while pumps, valves, nodes, and connector detail approach source density.",
            "likelyCause": "Dense technical machinery or illustration detail was approximated with too few native lines, nodes, connectors, or icons.",
            "recommendedFix": "Add native line/node/connector/detail density first; if native approximation remains visibly worse, use small metadata-rich non-text technical crops that avoid text regions and preserve native semantic text.",
            "extra": base_extra,
        }

    if "schematic" in tags and (high_edge or source_edge_low):
        base_extra.update(
            {
                "fixStrategy": "native_schematic_density_then_small_non_text_crops",
                "cropAllowed": True,
                "cropPolicy": non_text_crop_policy("technical_detail"),
                "secondaryIssueTypes": ["edge_density_low", "non_text_detail_crop_candidate"],
            }
        )
        return {
            "type": "schematic_density_low",
            "observed": "Routing, manifold, or schematic line density is lower than the source.",
            "expected": "Routes, valves, nodes, labels, and panels should preserve the source topology with editable native text.",
            "likelyCause": "Manifold/route topology, connector count, or technical nodes were simplified.",
            "recommendedFix": "Increase native route, valve, node, connector, and rule density first; use small non-text technical crops only for dense rendered detail that native vectors cannot match, never for labels or tables.",
            "extra": base_extra,
        }

    if source_edge_low or high_edge:
        base_extra.update({"fixStrategy": "native_edge_density", "secondaryIssueTypes": ["missing_detail_density"]})
        return {
            "type": "edge_density_low",
            "observed": "The rendered reconstruction has lower or mismatched edge density than the source.",
            "expected": "Visible line, rule, icon, and connector density should match the source closely enough for editable reconstruction.",
            "likelyCause": "Linework, icon detail, connector count, or rule placement is under-built.",
            "recommendedFix": "Add native rules, connectors, nodes, and icon detail in the per-slide fragment before considering any crop.",
            "extra": base_extra,
        }

    if high_palette:
        base_extra.update({"fixStrategy": "palette_and_material_tuning"})
        return {
            "type": "palette_drift",
            "observed": "Color palette drift is noticeable versus the source.",
            "expected": "Panel fills, accents, emphasis colors, and material tones should match the source palette.",
            "likelyCause": "Profile tokens or per-slide fills differ from source-specific colors or textured material.",
            "recommendedFix": "Tune source-specific fills, rule opacity, accent colors, and material panels in the per-slide fragment; do not widen thresholds.",
            "extra": base_extra,
        }

    if out_of_band:
        base_extra.update({"fixStrategy": "inspect_editable_simplification"})
        return {
            "type": "acceptable_native_simplification",
            "observed": "Metrics are outside known-good bands but do not show enough known-bad signals.",
            "expected": "Editable reconstruction drift may be acceptable when content is present, native, and readable.",
            "likelyCause": "Native editable redraw differs from a raster source without obvious content loss.",
            "recommendedFix": "Inspect diff images and keep the slide in needs_polish unless content loss, clipping, crop shortcuts, or key-detail loss is found.",
            "extra": base_extra,
        }

    base_extra.update({"fixStrategy": "spacing_layout_tuning"})
    return {
        "type": "spacing",
        "observed": "Source/render spacing differs at a noticeable level.",
        "expected": "Rendered slide should preserve source layout, content, color emphasis, and spacing.",
        "likelyCause": "Per-slide fragment geometry, typography, line-height, or panel dimensions differ from source.",
        "recommendedFix": "Inspect the diff and edge diff in visual_qa, then adjust the per-slide reconstruction fragment before changing shared renderer files.",
        "extra": base_extra,
    }


def issue_type_for_metrics(metrics: dict[str, Any]) -> str:
    return issue_plan_for_metrics(0, "pptx_vs_source", metrics).get("type", "spacing")


def target_fragment(slide: int) -> str:
    return f"work/{slide_dir_name(slide)}/s{slide}.fragment.js"


def build_issue(
    slide: int,
    idx: int,
    severity: str,
    issue_type: str,
    region: dict[str, int],
    observed: str,
    expected: str,
    cause: str,
    fix: str,
    target_file: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    issue = {
        "id": f"s{slide}_issue_{idx:03d}",
        "severity": severity,
        "type": issue_type,
        "region": region,
        "observed": observed,
        "expected": expected,
        "likelyCause": cause,
        "recommendedFix": fix,
        "targetFile": target_file or target_fragment(slide),
        "safeToAutoApply": False,
        "cropAllowed": False,
    }
    if extra:
        issue.update(extra)
        issue["safeToAutoApply"] = False
    return issue


def load_json_if_exists(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def find_slide_scoped_entries(data: Any, slide: int) -> list[Any]:
    entries: list[Any] = []

    def visit(obj: Any, scoped: bool = False) -> None:
        current_scoped = scoped
        if isinstance(obj, dict):
            for key, value in obj.items():
                key_l = str(key).lower()
                if key_l in {"slide", "slidenumber", "slide_number", "page", "index"}:
                    try:
                        value_i = int(value)
                        if value_i == slide or value_i == slide - 1:
                            current_scoped = True
                    except Exception:
                        pass
                if isinstance(value, str) and f"slide{slide}" in value.lower():
                    current_scoped = True
            if current_scoped:
                entries.append(obj)
            for value in obj.values():
                visit(value, current_scoped)
        elif isinstance(obj, list):
            for value in obj:
                visit(value, current_scoped)

    visit(data)
    return entries


def collect_text_values(obj: Any) -> list[str]:
    values: list[str] = []

    def visit(value: Any, key: str = "") -> None:
        key_l = key.lower()
        if isinstance(value, str):
            if key_l in {"correctedtext", "text", "ocrtext", "nativereplacement", "title", "label", "name", "content"}:
                values.append(value)
        elif isinstance(value, dict):
            for child_key, child_value in value.items():
                visit(child_value, str(child_key))
        elif isinstance(value, list):
            for child in value:
                visit(child, key)

    visit(obj)
    return values


def build_slide_context(project: Path, work_slide_dir: Path, slide: int) -> dict[str, Any]:
    text_values: list[str] = []
    for path in (
        work_slide_dir / "text_regions.json",
        work_slide_dir / "visual_qa" / "text_regions.json",
    ):
        data = load_json_if_exists(path)
        if data is not None:
            text_values.extend(collect_text_values(data))

    if not text_values:
        manifest = load_json_if_exists(project / "out" / "native_object_manifest.json")
        if manifest is not None:
            for entry in find_slide_scoped_entries(manifest, slide):
                text_values.extend(collect_text_values(entry))

    normalized_text = " ".join(text_values).lower()
    heading_text = " ".join(text_values[:8]).lower()
    tags: set[str] = set()
    technical_hits = [term for term in TECHNICAL_DETAIL_TERMS if term in normalized_text]
    schematic_hits = [term for term in SCHEMATIC_TERMS if term in normalized_text]
    board_hits = [term for term in BOARD_TERMS if term in normalized_text]
    stop_hits = [term for term in STOP_FLOW_TERMS if term in normalized_text]

    if stop_hits:
        tags.add("stop_flow")
    if "line-up board" in heading_text or "lineup board" in heading_text:
        tags.add("board")
    if any(term in normalized_text for term in ("cargo system flow", "line routing", "routing control", "manifold watch")):
        tags.add("schematic")
    elif len(schematic_hits) >= 3 and "flow" in normalized_text:
        tags.add("schematic")
    if "engine support" in normalized_text or any(term in normalized_text for term in ("pump · hpu", "pump hpu", "power · esd")):
        tags.add("technical_diagram")
    elif len(technical_hits) >= 4 and "independent verification" not in normalized_text:
        tags.add("technical_diagram")

    return {
        "available": bool(text_values),
        "domainTags": sorted(tags),
        "termHits": {
            "technical": sorted(technical_hits),
            "schematic": sorted(schematic_hits),
            "board": sorted(board_hits),
            "stopFlow": sorted(stop_hits),
        },
        "textSample": " | ".join(text_values[:12]),
    }


def detect_full_slide_shortcut(project: Path, slide: int) -> dict[str, Any]:
    candidates = [
        project / "out" / "crop_coverage_summary.json",
        project / "out" / "native_object_manifest.json",
    ]
    findings: list[str] = []
    for path in candidates:
        data = load_json_if_exists(path)
        if data is None:
            continue
        for entry in find_slide_scoped_entries(data, slide):
            text = json.dumps(entry, sort_keys=True).lower()
            if "full_slide" in text or "full-slide" in text or "full slide" in text:
                findings.append(f"{path.name}: full-slide marker in slide-scoped entry")
                continue
            coverage_values: list[float] = []
            if isinstance(entry, dict):
                for key, value in entry.items():
                    key_l = str(key).lower()
                    if any(token in key_l for token in ("coverage", "ratio", "area")):
                        try:
                            number = float(value)
                        except Exception:
                            continue
                        if 0.0 <= number <= 1.0:
                            coverage_values.append(number)
                        elif 1.0 < number <= 100.0 and "percent" in key_l:
                            coverage_values.append(number / 100.0)
            if coverage_values and max(coverage_values) >= 0.92 and "crop" in text:
                findings.append(f"{path.name}: crop coverage {max(coverage_values):.3f} for slide-scoped entry")
    return {"available": bool(candidates), "suspected": bool(findings), "findings": findings}


def compute_text_density(work_slide_dir: Path, source_img, render_images: dict[str, Any]) -> dict[str, Any]:
    mask_path = None
    for name in ("text_mask.png", "pseudo_text_mask.png", "inpaint_mask.png"):
        candidate = work_slide_dir / name
        if candidate.exists():
            mask_path = candidate
            break
    if mask_path is None:
        return {"available": False, "reason": "no text mask artifact found"}

    mask = Image.open(mask_path).convert("L").resize(source_img.size, resample_filter())
    mask_arr = np.asarray(mask, dtype=np.float32) > 128
    if not mask_arr.any():
        return {"available": True, "mask": str(mask_path), "reason": "mask contains no active pixels"}

    def density(img) -> float:
        arr = as_float_array(img.resize(source_img.size, resample_filter()))
        gray = grayscale(arr)
        edges = edge_mask(arr)
        active = np.logical_and(mask_arr, np.logical_or(gray < 0.62, edges))
        return float(active.sum() / max(float(mask_arr.sum()), 1.0))

    source_density = density(source_img)
    render_density: dict[str, Any] = {}
    for key, img in render_images.items():
        render_density[key] = {
            "density": density(img),
            "differenceFromSource": abs(density(img) - source_density),
        }
    return {
        "available": True,
        "mask": str(mask_path),
        "sourceDensity": source_density,
        "renders": render_density,
    }


def compute_layout_box_drift(work_slide_dir: Path) -> dict[str, Any]:
    candidates = [
        work_slide_dir / "visual_qa" / "layout_boxes.json",
        work_slide_dir / "layout_boxes.json",
    ]
    path = next((candidate for candidate in candidates if candidate.exists()), None)
    if path is None:
        return {"available": False, "reason": "no layout box metadata found"}
    data = load_json_if_exists(path)
    if not isinstance(data, list):
        return {"available": False, "path": str(path), "reason": "layout box metadata is not a list"}
    drifts: list[float] = []
    for item in data:
        if not isinstance(item, dict) or "source" not in item or "render" not in item:
            continue
        try:
            source = item["source"]
            render = item["render"]
            dx = abs(float(source["x"]) - float(render["x"]))
            dy = abs(float(source["y"]) - float(render["y"]))
            dw = abs(float(source["w"]) - float(render["w"]))
            dh = abs(float(source["h"]) - float(render["h"]))
            drifts.append(dx + dy + dw + dh)
        except Exception:
            continue
    return {
        "available": True,
        "path": str(path),
        "boxCount": len(drifts),
        "meanAbsoluteDrift": float(sum(drifts) / len(drifts)) if drifts else None,
        "maxAbsoluteDrift": float(max(drifts)) if drifts else None,
    }


def image_dimensions(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False}
    try:
        with Image.open(path) as img:
            return {"exists": True, "width": img.width, "height": img.height, "sha256": sha256_file(path)}
    except Exception as exc:
        return {"exists": True, "error": str(exc), "sha256": sha256_file(path)}


def write_report(path: Path, slide: int, status: str, severity: str, comparisons: dict[str, Any], issues: list[dict[str, Any]], mode: str) -> None:
    lines = [
        f"# Slide {slide} Visual Polish Report",
        "",
        f"- Mode: `{mode}`",
        f"- Status: `{status}`",
        f"- Severity: `{severity}`",
        "",
        "## Metrics",
    ]
    for label, metrics in comparisons.items():
        if not isinstance(metrics, dict) or "pixel_difference_ratio" not in metrics:
            continue
        ssim = metrics.get("approx_ssim")
        ssim_s = "unavailable" if ssim is None else f"{ssim:.4f}"
        lines.extend(
            [
                f"- {label}: pixel_diff={metrics['pixel_difference_ratio']:.4f}, "
                f"mae={metrics['mean_absolute_error']:.4f}, "
                f"edge_diff={metrics['edge_difference_ratio']:.4f}, "
                f"ssim={ssim_s}, palette_drift={metrics['color_palette_drift']:.4f}",
            ]
        )
    lines.extend(["", "## Issues"])
    if issues:
        for issue in issues:
            region = issue.get("region", {})
            lines.extend(
                [
                    f"- {issue['id']} [{issue['severity']}/{issue['type']}] "
                    f"x={region.get('x', 0)} y={region.get('y', 0)} w={region.get('w', 0)} h={region.get('h', 0)}",
                    f"  - Observed: {issue['observed']}",
                    f"  - Expected: {issue['expected']}",
                    f"  - Recommended fix: {issue['recommendedFix']}",
                    f"  - Target file: {issue.get('targetFile', 'other')}",
                    f"  - Safe to auto-apply: {str(issue.get('safeToAutoApply', False)).lower()}",
                ]
            )
            if issue.get("secondaryIssueTypes"):
                lines.append(f"  - Related issue types: {', '.join(issue['secondaryIssueTypes'])}")
            if issue.get("fixStrategy"):
                lines.append(f"  - Fix strategy: {issue['fixStrategy']}")
            if issue.get("cropAllowed"):
                policy = issue.get("cropPolicy", {})
                allowed = ", ".join(policy.get("allowedContentTypes", []))
                forbidden = ", ".join(policy.get("forbiddenContentTypes", []))
                lines.append(f"  - Crop allowed: yes, only for small non-text detail ({allowed}); forbidden: {forbidden}")
            else:
                lines.append("  - Crop allowed: no")
    else:
        lines.append("- No blocking or noticeable issues detected by automated comparison.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def compare_slide(
    project: Path,
    slide: int,
    source_dir_p: Path,
    qa_root: Path,
    mode: str,
    ssim_threshold: float,
    pixel_threshold: float,
    edge_threshold: float,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    profile = profile or load_calibration_profile()
    work_slide_dir = qa_root / slide_dir_name(slide)
    visual_dir = work_slide_dir / "visual_qa"
    visual_dir.mkdir(parents=True, exist_ok=True)
    src = source_path(source_dir_p, slide)
    pptx = visual_dir / "pptx_raster.png"
    html = visual_dir / "html_screenshot.png"
    issues: list[dict[str, Any]] = []
    comparisons: dict[str, Any] = {}
    dimensions: dict[str, Any] = {
        "source": image_dimensions(src) if src else {"exists": False},
        "pptx_raster": image_dimensions(pptx),
        "html_screenshot": image_dimensions(html),
    }
    resize_records: list[dict[str, Any]] = []
    issue_signals: list[dict[str, Any]] = []

    if src is None:
        issue_signals.append(
            {
                "type": "missing_artifact",
                "severity": "blocking",
                "rationale": "Source slide image is missing.",
            }
        )
        issue = build_issue(
            slide,
            1,
            "blocking",
            "missing_content",
            {"x": 0, "y": 0, "w": 0, "h": 0},
            "Source slide image is missing.",
            "A source image such as src/slide12.png must exist before visual QA.",
            "Missing or incorrectly named source artifact.",
            "Restore or point --source-dir at the source slide image directory, then rerun QA.",
            "other",
        )
        issues.append(issue)
        classification = classify_visual_result(slide, mode, {}, issue_signals, profile)
        metrics = {
            "createdAt": utc_now(),
            "slide": slide,
            "mode": mode,
            "status": classification["status"],
            "overallStatus": classification["overallStatus"],
            "severity": classification["severity"],
            "dimensions": dimensions,
            "comparisons": {},
            "metricSignals": classification["metricSignals"],
            "issueSignals": classification["issueSignals"],
            "pptxHtmlConsistency": classification["pptxHtmlConsistency"],
            "sourceRenderSimilarity": classification["sourceRenderSimilarity"],
            "editableReconstructionToleranceApplied": classification["editableReconstructionToleranceApplied"],
            "confidence": classification["confidence"],
            "rationale": classification["rationale"],
            "calibrationProfile": classification["calibrationProfile"],
            "issues": issues,
        }
        write_json(visual_dir / "visual_metrics.json", metrics)
        write_report(visual_dir / "visual_polish_report.md", slide, "fail", "blocking", {}, issues, mode)
        write_json(
            visual_dir / "visual_polish_fixes.json",
            {
                "fixPlanSchemaVersion": "slide-visual-polish-qa.fix-plan.v2",
                "slide": slide,
                "status": classification["status"],
                "overallStatus": classification["overallStatus"],
                "severity": classification["severity"],
                "metricSignals": classification["metricSignals"],
                "issueSignals": classification["issueSignals"],
                "confidence": classification["confidence"],
                "rationale": classification["rationale"],
                "issues": issues,
            },
        )
        return metrics

    shutil.copyfile(src, visual_dir / "source.png")
    source_img = load_rgb(src)
    source_arr = as_float_array(source_img)
    slide_context = build_slide_context(project, work_slide_dir, slide)
    render_images: dict[str, Any] = {}
    severity_values: list[str] = []
    source_classifications: list[dict[str, Any]] = []

    for label, path, diff_name, edge_name in (
        ("pptx_vs_source", pptx, "pptx_diff.png", "pptx_edge_diff.png"),
        ("html_vs_source", html, "html_diff.png", "html_edge_diff.png"),
    ):
        if not path.exists():
            issue_idx = len(issues) + 1
            severity_values.append("blocking")
            issue_signals.append(
                {
                    "type": "missing_artifact",
                    "severity": "blocking",
                    "rationale": f"{path.name} is missing.",
                }
            )
            issues.append(
                build_issue(
                    slide,
                    issue_idx,
                    "blocking",
                    "missing_content",
                    {"x": 0, "y": 0, "w": source_img.width, "h": source_img.height},
                    f"{path.name} is missing.",
                    f"{path.name} must exist for visual QA.",
                    "Rasterization or screenshot capture did not run or failed.",
                    "Run the diagnostic capture step for this slide and inspect its error metadata if it fails.",
                    "other",
                )
            )
            comparisons[label] = {"available": False, "missing": str(path)}
            continue
        render_img_original = load_rgb(path)
        render_images[label.split("_vs_")[0]] = render_img_original
        render_img, resized = resize_to_source(render_img_original, source_img.size)
        if resized:
            resize_records.append(
                {
                    "image": str(path),
                    "from": {"width": render_img_original.width, "height": render_img_original.height},
                    "to": {"width": source_img.width, "height": source_img.height},
                    "reason": "Diagnostic comparison requires a shared coordinate space.",
                }
            )
        render_arr = as_float_array(render_img)
        metrics_raw = compare_arrays(source_arr, render_arr, pixel_threshold)
        write_diff_image(visual_dir / diff_name, source_arr, metrics_raw["_delta"])
        write_edge_diff_image(visual_dir / edge_name, source_arr, metrics_raw["_source_edges"], metrics_raw["_render_edges"])
        metrics = clean_metrics(metrics_raw)
        metric_classification = classify_comparison_metrics(metrics, "sourceRenderSimilarity", profile)
        severity = metric_classification["severity"]
        metrics["severity"] = severity
        metrics["classification"] = metric_classification["classification"]
        metrics["metricSignals"] = metric_classification
        comparisons[label] = metrics
        severity_values.append(severity)
        source_classifications.append(metric_classification)
        if severity in {"blocking", "noticeable"}:
            plan = issue_plan_for_metrics(slide, label, metrics, slide_context)
            issues.append(
                build_issue(
                    slide,
                    len(issues) + 1,
                    severity,
                    plan["type"],
                    metrics.get("diff_mask_bbox", {"x": 0, "y": 0, "w": source_img.width, "h": source_img.height}),
                    plan["observed"],
                    plan["expected"],
                    plan["likelyCause"],
                    plan["recommendedFix"],
                    extra=plan.get("extra"),
                )
            )

    if pptx.exists() and html.exists():
        pptx_img, _ = resize_to_source(load_rgb(pptx), source_img.size)
        html_img, _ = resize_to_source(load_rgb(html), source_img.size)
        pptx_html_raw = compare_arrays(as_float_array(pptx_img), as_float_array(html_img), pixel_threshold)
        pptx_html_metrics = clean_metrics(pptx_html_raw)
        source_blocking = max_severity([item["severity"] for item in source_classifications]) == "blocking"
        explicit_blocking = any(
            signal.get("severity") == "blocking" and signal.get("type") in EXPLICIT_BLOCKING_SIGNAL_TYPES for signal in issue_signals
        )
        pptx_html_classification = classify_comparison_metrics(
            pptx_html_metrics,
            "pptxHtmlConsistency",
            profile,
            source_blocking=source_blocking,
            explicit_blocking=explicit_blocking,
        )
        pptx_html_severity = pptx_html_classification["severity"]
        comparisons["pptx_vs_html"] = pptx_html_metrics | {
            "severity": pptx_html_severity,
            "classification": pptx_html_classification["classification"],
            "metricSignals": pptx_html_classification,
        }
        if pptx_html_severity in {"blocking", "noticeable"}:
            severity_values.append(pptx_html_severity)
            plan = issue_plan_for_metrics(slide, "pptx_vs_html", comparisons["pptx_vs_html"], slide_context)
            issues.append(
                build_issue(
                    slide,
                    len(issues) + 1,
                    pptx_html_severity,
                    plan["type"],
                    pptx_html_metrics.get("diff_mask_bbox", {"x": 0, "y": 0, "w": source_img.width, "h": source_img.height}),
                    plan["observed"],
                    plan["expected"],
                    plan["likelyCause"],
                    plan["recommendedFix"],
                    extra=plan.get("extra"),
                )
            )

    shortcut = detect_full_slide_shortcut(project, slide)
    if shortcut.get("suspected"):
        severity_values.append("blocking")
        issue_signals.append(
            {
                "type": "full_slide_shortcut",
                "severity": "blocking",
                "rationale": "Crop coverage metadata suggests a full-slide screenshot or crop shortcut.",
            }
        )
        issues.append(
            build_issue(
                slide,
                len(issues) + 1,
                "blocking",
                "crop",
                {"x": 0, "y": 0, "w": source_img.width, "h": source_img.height},
                "Crop coverage metadata suggests a full-slide screenshot or full-slide crop shortcut.",
                "Editable reconstruction should use native objects except approved non-reconstructable regions.",
                "A crop plan or manifest entry may cover most of the slide.",
                "Replace the shortcut with native reconstruction elements or narrowly scoped crops while keeping crop coverage gates intact.",
                "work/crop_plan.json",
            )
        )

    text_density = compute_text_density(work_slide_dir, source_img, render_images)
    layout_box_drift = compute_layout_box_drift(work_slide_dir)
    classification = classify_visual_result(slide, mode, comparisons, issue_signals, profile)
    severity = classification["severity"]
    status = classification["status"]
    metrics = {
        "createdAt": utc_now(),
        "slide": slide,
        "mode": mode,
        "status": status,
        "overallStatus": classification["overallStatus"],
        "severity": severity,
        "thresholds": {
            "ssim": ssim_threshold,
            "pixel": pixel_threshold,
            "edge": edge_threshold,
        },
        "classificationThresholds": {
            "profile": profile.get("name", "default-visual-qa-profile"),
            "knownGoodMetricBands": profile.get("knownGoodMetricBands"),
            "borderlineMetricBands": profile.get("borderlineMetricBands"),
            "knownBadMetricBands": profile.get("knownBadMetricBands"),
        },
        "dimensions": dimensions,
        "hashes": {
            "source": sha256_file(src),
            "visual_qa_source": sha256_file(visual_dir / "source.png"),
            "pptx_raster": sha256_file(pptx),
            "html_screenshot": sha256_file(html),
        },
        "resizeApplied": bool(resize_records),
        "resizeRecords": resize_records,
        "dimension_mismatch_justification": "Rendered image dimensions were resized to source dimensions for diagnostic comparison only." if resize_records else None,
        "comparisons": comparisons,
        "metricSignals": classification["metricSignals"],
        "issueSignals": classification["issueSignals"],
        "pptxHtmlConsistency": classification["pptxHtmlConsistency"],
        "sourceRenderSimilarity": classification["sourceRenderSimilarity"],
        "editableReconstructionToleranceApplied": classification["editableReconstructionToleranceApplied"],
        "confidence": classification["confidence"],
        "rationale": classification["rationale"],
        "calibrationProfile": classification["calibrationProfile"],
        "textDensityDifference": text_density,
        "layoutBoxDrift": layout_box_drift,
        "slideContext": slide_context,
        "fullSlideShortcutCheck": shortcut,
        "issues": issues,
    }
    write_json(visual_dir / "visual_metrics.json", metrics)
    write_report(visual_dir / "visual_polish_report.md", slide, status, severity, comparisons, issues, mode)
    write_json(
        visual_dir / "visual_polish_fixes.json",
        {
            "fixPlanSchemaVersion": "slide-visual-polish-qa.fix-plan.v2",
            "slide": slide,
            "status": status,
            "overallStatus": classification["overallStatus"],
            "severity": severity,
            "metricSignals": classification["metricSignals"],
            "issueSignals": classification["issueSignals"],
            "pptxHtmlConsistency": classification["pptxHtmlConsistency"],
            "sourceRenderSimilarity": classification["sourceRenderSimilarity"],
            "editableReconstructionToleranceApplied": classification["editableReconstructionToleranceApplied"],
            "confidence": classification["confidence"],
            "rationale": classification["rationale"],
            "slideContext": slide_context,
            "issues": issues,
        },
    )
    return metrics


def contact_tile(path: Path | None, label: str, size: tuple[int, int]):
    width, height = size
    tile = Image.new("RGB", (width, height + 28), "white")
    draw = ImageDraw.Draw(tile)
    draw.rectangle((0, 0, width - 1, height + 27), outline=(210, 210, 210))
    if path and path.exists():
        try:
            img = load_rgb(path)
            img.thumbnail((width, height), resample_filter())
            x = (width - img.width) // 2
            y = (height - img.height) // 2
            tile.paste(img, (x, y))
        except Exception as exc:
            draw.text((8, height // 2), f"error: {exc}", fill=(180, 0, 0))
    else:
        draw.text((8, height // 2), "missing", fill=(180, 0, 0))
    draw.rectangle((0, height, width, height + 28), fill=(245, 245, 245), outline=(210, 210, 210))
    draw.text((8, height + 7), label, fill=(0, 0, 0))
    return tile


def write_contact_sheet(project: Path, slides: list[int], source_dir_p: Path, qa_root: Path) -> Path:
    thumb = (280, 158)
    labels = ["source", "pptx", "html", "pptx diff", "html diff"]
    row_h = thumb[1] + 28
    col_w = thumb[0]
    sheet = Image.new("RGB", (col_w * len(labels), row_h * len(slides)), "white")
    for row, slide in enumerate(slides):
        visual_dir = qa_root / slide_dir_name(slide) / "visual_qa"
        paths = [
            visual_dir / "source.png",
            visual_dir / "pptx_raster.png",
            visual_dir / "html_screenshot.png",
            visual_dir / "pptx_diff.png",
            visual_dir / "html_diff.png",
        ]
        for col, (label, path) in enumerate(zip(labels, paths)):
            tile = contact_tile(path, f"s{slide} {label}", thumb)
            sheet.paste(tile, (col * col_w, row * row_h))
    out = project / "out" / "qa" / "contact_sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return out


def deck_summary(project: Path, mode: str, slides: list[int], slide_metrics: list[dict[str, Any]], out_summary: Path, contact_sheet: Path | None) -> dict[str, Any]:
    counts = {"pass": 0, "fail": 0, "needs_polish": 0}
    issue_severity_counts = {"blocking": 0, "noticeable": 0, "minor": 0}
    issue_types: dict[str, int] = {}
    worst: list[dict[str, Any]] = []
    for metrics in slide_metrics:
        status = str(metrics.get("overallStatus") or metrics.get("status", "fail"))
        counts[status] = counts.get(status, 0) + 1
        issues = metrics.get("issues", [])
        for issue in issues:
            issue_types[issue.get("type", "other")] = issue_types.get(issue.get("type", "other"), 0) + 1
            severity_key = issue.get("severity")
            if severity_key in issue_severity_counts:
                issue_severity_counts[severity_key] += 1
        severity = metrics.get("severity", "blocking")
        score = {"blocking": 3, "noticeable": 2, "minor": 1, "pass": 0}.get(severity, 3)
        worst.append({"slide": metrics.get("slide"), "status": status, "severity": severity, "issueCount": len(issues), "score": score})
    worst.sort(key=lambda item: (item["score"], item["issueCount"]), reverse=True)
    summary = {
        "createdAt": utc_now(),
        "mode": mode,
        "project": str(project),
        "slidesRequested": slides,
        "counts": counts,
        "passed": counts.get("pass", 0),
        "needsPolish": counts.get("needs_polish", 0),
        "failed": counts.get("fail", 0),
        "issueSeverityCounts": issue_severity_counts,
        "blockingIssues": issue_severity_counts["blocking"],
        "noticeableIssues": issue_severity_counts["noticeable"],
        "minorIssues": issue_severity_counts["minor"],
        "commonIssueTypes": dict(sorted(issue_types.items(), key=lambda item: item[1], reverse=True)),
        "worstSlides": worst[:10],
        "contactSheet": str(contact_sheet) if contact_sheet else None,
        "slides": [
            {
                "slide": item.get("slide"),
                "status": item.get("status"),
                "severity": item.get("severity"),
                "issueCount": len(item.get("issues", [])),
                "metricsPath": str(project / "work" / slide_dir_name(int(item.get("slide", 0))) / "visual_qa" / "visual_metrics.json") if item.get("slide") else None,
            }
            for item in slide_metrics
        ],
    }
    write_json(out_summary, summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare source images against PPTX rasters and HTML screenshots.")
    parser.add_argument("--project", required=True, help="Project root.")
    parser.add_argument("--slides", required=True, help="Comma-separated slide numbers or ranges.")
    parser.add_argument("--source-dir", default="src", help="Source image directory. Default: src.")
    parser.add_argument("--qa-dir", default="work", help="QA work root. Default: work.")
    parser.add_argument("--out-summary", default="out/visual_qa_summary.json", help="Deck summary JSON path.")
    parser.add_argument("--mode", choices=["qa-draft", "qa-strict", "qa-polish"], default="qa-draft")
    parser.add_argument("--ssim-threshold", type=float, default=0.92)
    parser.add_argument("--pixel-threshold", type=float, default=0.08)
    parser.add_argument("--edge-threshold", type=float, default=0.10)
    parser.add_argument("--profile", default=None, help="Optional visual QA calibration profile JSON path.")
    args = parser.parse_args(argv)

    global Image, ImageDraw, np
    try:
        from PIL import Image as PILImage  # type: ignore
        from PIL import ImageDraw as PILImageDraw  # type: ignore
        import numpy as numpy  # type: ignore
    except Exception as exc:
        print(f"ERROR: Pillow and numpy are required for visual comparison: {exc}", file=sys.stderr)
        return 2
    Image = PILImage
    ImageDraw = PILImageDraw
    np = numpy

    project = Path(args.project).expanduser().resolve()
    slides = parse_slides(args.slides)
    source_dir_p = resolve_path(project, args.source_dir)
    qa_root = resolve_path(project, args.qa_dir)
    out_summary = resolve_path(project, args.out_summary)
    profile = load_calibration_profile(resolve_path(project, args.profile) if args.profile else None)

    if not source_dir_p.exists():
        print(f"ERROR: source directory not found: {source_dir_p}", file=sys.stderr)
        return 2

    slide_metrics = [
        compare_slide(
            project,
            slide,
            source_dir_p,
            qa_root,
            args.mode,
            args.ssim_threshold,
            args.pixel_threshold,
            args.edge_threshold,
            profile,
        )
        for slide in slides
    ]
    contact = write_contact_sheet(project, slides, source_dir_p, qa_root)
    summary = deck_summary(project, args.mode, slides, slide_metrics, out_summary, contact)
    print(json.dumps({"status": "ok", "counts": summary["counts"], "summary": str(out_summary)}, indent=2))

    if args.mode == "qa-strict" and summary["counts"].get("fail", 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
