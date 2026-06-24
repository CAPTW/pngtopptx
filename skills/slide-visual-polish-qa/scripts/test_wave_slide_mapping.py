#!/usr/bin/env python3
"""Regression tests for source-slide to wave-output slide mapping."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from slide_mapping import (  # noqa: E402
    SlideMappingError,
    resolve_slide_mapping,
    slide_dir_name,
)


def fail(message: str) -> int:
    print(f"FAIL: {message}", file=sys.stderr)
    return 1


def assert_equal(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def test_source_slides_sequential() -> None:
    entries = resolve_slide_mapping(source_slides="8,10,11,12,13")
    assert_equal([entry.source_slide for entry in entries], [8, 10, 11, 12, 13], "source slides")
    assert_equal([entry.physical_slide for entry in entries], [1, 2, 3, 4, 5], "physical slides")
    assert_equal([entry.html_slide for entry in entries], [1, 2, 3, 4, 5], "html slides")
    assert_equal(entries[-1].source_slide, 13, "last source slide")
    assert_equal(entries[-1].physical_slide, 5, "source slide 13 physical slide")
    assert_equal([slide_dir_name(entry.source_slide) for entry in entries], ["slide08", "slide10", "slide11", "slide12", "slide13"], "output dirs")
    assert entries[0].inferred is True
    assert entries[0].mapping_mode == "source-slides-sequential"


def test_explicit_pairing() -> None:
    entries = resolve_slide_mapping(source_slides="8,10,11,12,13", physical_slides="1,2,3,4,5")
    assert_equal([entry.source_slide for entry in entries], [8, 10, 11, 12, 13], "paired source slides")
    assert_equal([entry.physical_slide for entry in entries], [1, 2, 3, 4, 5], "paired physical slides")
    assert entries[0].mapping_mode == "source-physical-slides"
    assert entries[0].inferred is False


def test_legacy_slides_are_physical() -> None:
    entries = resolve_slide_mapping(slides="8,10,11,12,13")
    assert_equal([entry.source_slide for entry in entries], [8, 10, 11, 12, 13], "legacy source slides")
    assert_equal([entry.physical_slide for entry in entries], [8, 10, 11, 12, 13], "legacy physical slides")
    assert entries[0].mapping_mode == "legacy-physical-slides"


def test_mismatch_lengths_fail() -> None:
    try:
        resolve_slide_mapping(source_slides="8,10", physical_slides="1")
    except SlideMappingError as exc:
        if "--source-slides has 2 item(s)" not in str(exc):
            raise AssertionError(f"unexpected mismatch error: {exc}") from exc
        return
    raise AssertionError("expected source/physical length mismatch to fail")


def test_slide_map_file() -> None:
    with tempfile.TemporaryDirectory(prefix="visual-qa-slide-map-") as tmp_s:
        path = Path(tmp_s) / "map.json"
        path.write_text(
            json.dumps(
                {
                    "slides": [
                        {"sourceSlide": 8, "physicalSlide": 1, "htmlSlide": 1},
                        {"sourceSlide": 10, "physicalSlide": 2, "htmlSlide": 2},
                        {"sourceSlide": 13, "physicalSlide": 5, "htmlSlide": 5},
                    ]
                }
            ),
            encoding="utf-8",
        )
        entries = resolve_slide_mapping(slide_map=path, source_slides="13")
        assert_equal(len(entries), 1, "filtered slide map length")
        assert_equal(entries[0].source_slide, 13, "slide map source")
        assert_equal(entries[0].physical_slide, 5, "slide map physical")
        assert_equal(entries[0].html_slide, 5, "slide map html")
        assert entries[0].mapping_mode == "slide-map"


def test_trace_mapping() -> None:
    with tempfile.TemporaryDirectory(prefix="visual-qa-trace-map-") as tmp_s:
        path = Path(tmp_s) / "render_trace.json"
        path.write_text(json.dumps({"SLIDES": "8,10,11,12,13"}), encoding="utf-8")
        entries = resolve_slide_mapping(trace=path)
        assert_equal([entry.source_slide for entry in entries], [8, 10, 11, 12, 13], "trace source slides")
        assert_equal([entry.physical_slide for entry in entries], [1, 2, 3, 4, 5], "trace physical slides")
        assert entries[0].trace_based is True


def main() -> int:
    tests = [
        test_source_slides_sequential,
        test_explicit_pairing,
        test_legacy_slides_are_physical,
        test_mismatch_lengths_fail,
        test_slide_map_file,
        test_trace_mapping,
    ]
    try:
        for test in tests:
            test()
    except Exception as exc:
        return fail(str(exc))
    print(json.dumps({"status": "ok", "tests": len(tests)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
