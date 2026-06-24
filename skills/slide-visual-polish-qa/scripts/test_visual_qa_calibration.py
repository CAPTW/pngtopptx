#!/usr/bin/env python3
"""Regression tests for calibrated visual QA classification."""

from __future__ import annotations

from pathlib import Path
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import compare_slide_images as compare  # noqa: E402


def metrics(pixel: float, mae: float, edge: float, ssim: float, palette: float) -> dict:
    return {
        "pixel_difference_ratio": pixel,
        "mean_absolute_error": mae,
        "edge_difference_ratio": edge,
        "source_edge_density": 0.18,
        "render_edge_density": 0.16,
        "edge_density_delta": 0.02,
        "approx_ssim": ssim,
        "color_palette_drift": palette,
        "diff_mask_bbox": {"x": 0, "y": 0, "w": 100, "h": 100},
        "edge_diff_bbox": {"x": 0, "y": 0, "w": 100, "h": 100},
    }


def classify(slide: int, comparisons: dict, signals: list[dict] | None = None) -> dict:
    return compare.classify_visual_result(
        slide=slide,
        mode="qa-polish",
        comparisons=comparisons,
        issue_signals=signals or [],
        profile=compare.load_calibration_profile(),
    )


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_slide_1_like_metrics() -> None:
    result = classify(
        1,
        {
            "pptx_vs_source": metrics(0.2049, 0.0991, 0.1127, 0.6116, 0.1232),
            "html_vs_source": metrics(0.1888, 0.0925, 0.0944, 0.6363, 0.1346),
            "pptx_vs_html": metrics(0.1033, 0.0506, 0.0843, 0.8005, 0.0482),
        },
    )
    assert_true(result["overallStatus"] != "fail", f"slide 1-like metrics should not fail: {result}")
    assert_true(result["severity"] != "blocking", f"slide 1-like metrics should not be blocking: {result}")
    assert_true(result["editableReconstructionToleranceApplied"] is True, "slide 1-like metrics should use editable tolerance")


def test_slide_12_like_metrics() -> None:
    result = classify(
        12,
        {
            "pptx_vs_source": metrics(0.2647, 0.1310, 0.1478, 0.3764, 0.3102),
            "html_vs_source": metrics(0.2444, 0.1295, 0.1499, 0.3980, 0.3417),
            "pptx_vs_html": metrics(0.1437, 0.0681, 0.0936, 0.7036, 0.0804),
        },
    )
    assert_true(result["overallStatus"] == "fail", f"slide 12-like metrics should fail: {result}")
    assert_true(result["severity"] == "blocking", f"slide 12-like metrics should be blocking: {result}")


def test_slide_5_like_metrics() -> None:
    result = classify(
        5,
        {
            "pptx_vs_source": metrics(0.2335, 0.1279, 0.1303, 0.4507, 0.1981),
            "html_vs_source": metrics(0.2167, 0.1265, 0.1314, 0.4635, 0.2236),
            "pptx_vs_html": metrics(0.1267, 0.0628, 0.0806, 0.7496, 0.0608),
        },
    )
    assert_true(result["overallStatus"] == "needs_polish", f"slide 5-like metrics should need polish: {result}")
    assert_true(result["severity"] == "noticeable", f"slide 5-like metrics should be noticeable: {result}")


def test_missing_artifacts_fail() -> None:
    result = classify(
        99,
        {},
        [{"type": "missing_artifact", "severity": "blocking", "rationale": "required artifact missing"}],
    )
    assert_true(result["overallStatus"] == "fail", f"missing artifacts should fail: {result}")
    assert_true(result["severity"] == "blocking", f"missing artifacts should be blocking: {result}")


def test_explicit_pptx_html_clipping_blocks() -> None:
    result = classify(
        2,
        {
            "pptx_vs_source": metrics(0.2049, 0.0991, 0.1127, 0.6116, 0.1232),
            "html_vs_source": metrics(0.1888, 0.0925, 0.0944, 0.6363, 0.1346),
            "pptx_vs_html": metrics(0.1437, 0.0681, 0.0936, 0.7036, 0.0804),
        },
        [{"type": "clipping", "severity": "blocking", "rationale": "text clipped in HTML capture"}],
    )
    assert_true(result["overallStatus"] == "fail", f"explicit clipping should fail: {result}")
    assert_true(result["severity"] == "blocking", f"explicit clipping should be blocking: {result}")
    assert_true(result["pptxHtmlConsistency"]["severity"] == "blocking", "clipping should make PPTX/HTML mismatch blocking")


def test_slide_10_like_fix_plan_recommends_native_detail_density() -> None:
    plan = compare.issue_plan_for_metrics(
        10,
        "pptx_vs_source",
        metrics(0.248, 0.113, 0.155, 0.44, 0.231),
        {"domainTags": ["stop_flow"]},
    )
    assert_true(plan["type"] == "missing_detail_density", f"slide 10-like plan should flag missing detail density: {plan}")
    assert_true(plan["extra"]["cropAllowed"] is False, f"STOP/flow decoration should use native density first: {plan}")
    assert_true("native" in plan["recommendedFix"].lower(), f"STOP/flow fix should recommend native detail: {plan}")


def test_slide_11_like_fix_plan_allows_small_non_text_technical_crops() -> None:
    plan = compare.issue_plan_for_metrics(
        11,
        "pptx_vs_source",
        metrics(0.229, 0.112, 0.146, 0.456, 0.274),
        {"domainTags": ["schematic", "technical_diagram"]},
    )
    assert_true(
        plan["type"] in {"technical_diagram_under_detailed", "schematic_density_low"},
        f"slide 11-like plan should flag technical/schematic density: {plan}",
    )
    issue = plan["extra"]
    assert_true(issue["cropAllowed"] is True, f"technical detail may allow small non-text crops: {plan}")
    assert_true(compare.crop_policy_allows_content_type(issue, "3d") is True, f"3d non-text crop should be allowed: {plan}")
    assert_true("non_text_detail_crop_candidate" in issue["secondaryIssueTypes"], f"crop candidate marker missing: {plan}")


def test_slide_13_like_fix_plan_recommends_board_texture_crops() -> None:
    plan = compare.issue_plan_for_metrics(
        13,
        "html_vs_source",
        metrics(0.216, 0.113, 0.139, 0.479, 0.389),
        {"domainTags": ["board"]},
    )
    issue = plan["extra"]
    assert_true(plan["type"] == "board_texture_missing", f"slide 13-like plan should flag board texture: {plan}")
    assert_true(issue["cropAllowed"] is True, f"board texture drift can allow small non-text texture crops: {plan}")
    assert_true(compare.crop_policy_allows_content_type(issue, "texture") is True, f"texture crop should be allowed: {plan}")


def test_text_and_table_crop_recommendations_are_forbidden() -> None:
    plan = compare.issue_plan_for_metrics(
        12,
        "pptx_vs_source",
        metrics(0.229, 0.118, 0.144, 0.431, 0.264),
        {"domainTags": ["technical_diagram"]},
    )
    issue = plan["extra"]
    assert_true(compare.crop_policy_allows_content_type(issue, "text") is False, "text crop must be forbidden")
    assert_true(compare.crop_policy_allows_content_type(issue, "table") is False, "table crop must be forbidden")
    assert_true(compare.crop_policy_allows_content_type(issue, "label") is False, "label crop must be forbidden")


def main() -> int:
    tests = [
        test_slide_1_like_metrics,
        test_slide_12_like_metrics,
        test_slide_5_like_metrics,
        test_missing_artifacts_fail,
        test_explicit_pptx_html_clipping_blocks,
        test_slide_10_like_fix_plan_recommends_native_detail_density,
        test_slide_11_like_fix_plan_allows_small_non_text_technical_crops,
        test_slide_13_like_fix_plan_recommends_board_texture_crops,
        test_text_and_table_crop_recommendations_are_forbidden,
    ]
    for test in tests:
        test()
    print(f"PASS {len(tests)} visual QA calibration tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
