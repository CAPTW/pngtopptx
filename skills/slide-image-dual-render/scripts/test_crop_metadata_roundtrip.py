#!/usr/bin/env python3
"""Regression test for crop-plan policy metadata round-tripping."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
MAKE_CROPS = SCRIPT_DIR / "make_crops.py"
GENERATE_EVIDENCE = SCRIPT_DIR / "generate_evidence.js"


def write_sources(src_dir):
    src_dir.mkdir(parents=True, exist_ok=True)
    for slide in (1, 2, 3):
        im = Image.new("RGB", (24, 24), (30 * slide, 40, 90))
        im.save(src_dir / f"slide{slide}.png")


def sample_crops():
    return [
        {
            "name": "photo_crop",
            "slide": 1,
            "x": 1,
            "y": 2,
            "w": 6,
            "h": 7,
            "feather_edges": "LB",
            "content_type": "photoreal",
            "reconstruction_reason": "source photograph cannot be rebuilt as native vectors",
            "editable_replacement": "partial",
            "allow_large_crop": True,
            "reason": "hero photo is source evidence",
            "reviewer_note": "preserve me",
        },
        {
            "name": "model_crop",
            "slide": 2,
            "x": 3,
            "y": 4,
            "w": 8,
            "h": 5,
            "feather_edges": "LRTB",
            "content_type": "3d",
            "reconstruction_reason": "3D render is unrecreatable",
            "editable_replacement": "none",
            "allow_large_crop": False,
            "reason": "3D model remains a crop",
            "custom_policy": {"tier": "strict"},
        },
        {
            "name": "legacy_crop",
            "slide": 3,
            "x": 0,
            "y": 0,
            "w": 4,
            "h": 4,
            "feather_edges": "",
        },
    ]


def run_make_crops(plan_payload):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        src_dir = root / "src"
        assets_dir = root / "assets"
        work_dir = root / "work"
        work_dir.mkdir(parents=True)
        write_sources(src_dir)
        plan_path = work_dir / "crop_plan.json"
        plan_path.write_text(json.dumps(plan_payload, indent=2), encoding="utf-8")

        env = os.environ.copy()
        env["SRC_DIR"] = str(src_dir)
        env["DECK_ASSETS"] = str(assets_dir)
        env["CROP_PLAN"] = str(plan_path)
        env.pop("CROP_PLAN_DIR", None)

        result = subprocess.run(
            [sys.executable, str(MAKE_CROPS)],
            cwd=str(root),
            env=env,
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            raise AssertionError(f"make_crops.py failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")

        node = os.environ.get("NODE", "node")
        result = subprocess.run(
            [
                node,
                str(GENERATE_EVIDENCE),
                "--project",
                str(root),
                "--slides",
                "1,2,3",
                "--pxw",
                "24",
                "--pxh",
                "24",
            ],
            cwd=str(root),
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            raise AssertionError(f"generate_evidence.js failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")

        manifest_path = assets_dir / "manifest.json"
        summary_path = root / "out" / "crop_coverage_summary.json"
        return (
            json.loads(manifest_path.read_text(encoding="utf-8")),
            json.loads(summary_path.read_text(encoding="utf-8")),
        )


def assert_roundtrip(manifest):
    photo = manifest["photo_crop"]
    assert photo["content_type"] == "photoreal"
    assert photo["reconstruction_reason"] == "source photograph cannot be rebuilt as native vectors"
    assert photo["editable_replacement"] == "partial"
    assert photo["allow_large_crop"] is True
    assert photo["reason"] == "hero photo is source evidence"
    assert photo["reviewer_note"] == "preserve me"
    assert photo["file"] == "photo_crop.png"
    assert photo["x"] == 1 and photo["y"] == 2 and photo["w"] == 6 and photo["h"] == 7

    model = manifest["model_crop"]
    assert model["content_type"] == "3d"
    assert model["reconstruction_reason"] == "3D render is unrecreatable"
    assert model["editable_replacement"] == "none"
    assert model["allow_large_crop"] is False
    assert model["reason"] == "3D model remains a crop"
    assert model["custom_policy"] == {"tier": "strict"}

    legacy = manifest["legacy_crop"]
    assert legacy["content_type"] == "dense_infographic"
    assert legacy["reconstruction_reason"].startswith("legacy crop metadata not supplied")
    assert legacy["editable_replacement"] == "none"
    assert legacy["metadataComplete"] is False
    assert legacy["metadataSource"] == "legacy_default"
    assert sorted(legacy["missingMetadata"]) == [
        "content_type",
        "editable_replacement",
        "reconstruction_reason",
    ]


def assert_evidence_summary(summary):
    photo = summary["slides"]["1"]["crops"][0]
    assert photo["content_type"] == "photoreal"
    assert photo["metadataComplete"] is True
    assert summary["slides"]["1"]["denseInfographicCropAreaRatio"] == 0

    model = summary["slides"]["2"]["crops"][0]
    assert model["content_type"] == "3d"
    assert model["metadataComplete"] is True
    assert summary["slides"]["2"]["denseInfographicCropAreaRatio"] == 0

    legacy = summary["slides"]["3"]["crops"][0]
    assert legacy["content_type"] == "dense_infographic"
    assert legacy["metadataComplete"] is False
    assert legacy["metadataSource"] == "legacy_default"


def assert_case(plan_payload):
    manifest, summary = run_make_crops(plan_payload)
    assert_roundtrip(manifest)
    assert_evidence_summary(summary)


def main():
    crops = sample_crops()
    assert_case(crops)
    assert_case({"crops": crops})
    assert_case({"crops": {c["name"]: {k: v for k, v in c.items() if k != "name"} for c in crops}})
    assert_case({"slides": {"1": [crops[0]], "2": [crops[1]], "3": [crops[2]]}})
    print("crop metadata round-trip regression passed")


if __name__ == "__main__":
    main()
