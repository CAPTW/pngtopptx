"""Synthetic-only regression tests for residual assessment semantics.

All images, text, geometry, and artifact metadata are invented in this file.
No source-slide fixture or external service is used. Run with unittest discovery.
SLIDE_TEXT_LAYER_SCRIPTS optionally selects another copy of the existing scripts.
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw


SCRIPTS = Path(os.environ.get(
    "SLIDE_TEXT_LAYER_SCRIPTS",
    Path(__file__).resolve().parents[1] / "skills/slide-text-layer-inpaint/scripts",
)).resolve()


class ResidualQualificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="residual-semantics-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.slide = self.root / "slide01"
        self.slide.mkdir()
        self.source = self.root / "source.png"
        before = Image.new("RGB", (96, 48), (250, 250, 250))
        ImageDraw.Draw(before).text((12, 12), "SAMPLE", fill=(20, 20, 20))
        before.save(self.source)
        after = Image.new("RGB", (96, 48), (250, 250, 250))
        ImageDraw.Draw(after).text((12, 12), "SAMPLE", fill=(246, 246, 246))
        after.save(self.slide / "clean_background.png")
        for name in ["text_mask.png", "pseudo_text_mask.png", "inpaint_mask.png"]:
            Image.new("L", (96, 48), 255).save(self.slide / name)
        after.save(self.slide / "mask_overlay.png")
        self.write("text_regions.json", {
            "schemaVersion": "slide-text-layer-inpaint.text_regions.v1",
            "slideId": "slide01",
            "sourceImageHash": hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "coordinateSpace": {"width": 96, "height": 48, "units": "source_px"},
            "policy": {"ocrIsEvidenceOnly": True},
            "regions": [{
                "id": "sample-text",
                "class": "semantic_text",
                "correctedText": "SAMPLE",
                "bbox": {"x": 8, "y": 8, "w": 70, "h": 22},
            }],
        })
        self.write("background_regions.json", {
            "schemaVersion": "slide-text-layer-inpaint.background_regions.v1",
            "regions": [{
                "textRegionId": "sample-text",
                "backgroundType": "flat_color",
                "recommendedRepair": "redraw",
            }],
        })
        self.write("inpainting_report.json", {
            "schemaVersion": "slide-text-layer-inpaint.inpainting_report.v1",
            "policy": {
                "backgroundCleanupOnly": True,
                "nativeReconstructionReplacement": False,
            },
            "status": "pass",
            "methodsUsed": {"redraw": 1},
            "regions": [{
                "id": "sample-text", "repairMethod": "redraw",
                "backgroundType": "flat_color", "status": "pass",
            }],
        })
        (self.slide / "inpainting_report.md").write_text("Synthetic artifact contract.\n")
        self.write("residual_text_report.json", self.legacy_residual())

    @staticmethod
    def legacy_residual():
        return {
            "schemaVersion": "slide-text-layer-inpaint.residual_text_report.v1",
            "slide": 1, "status": "pass", "residualTextRisk": "low",
            "regions": [{"id": "sample-text", "residualRisk": "low",
                         "residualPixelsApprox": 0, "notes": "Synthetic low edge energy"}],
        }

    def write(self, name, value):
        (self.slide / name).write_text(json.dumps(value), encoding="utf-8")

    def read(self, name):
        return json.loads((self.slide / name).read_text(encoding="utf-8"))

    def detect(self):
        return subprocess.run([
            sys.executable, str(SCRIPTS / "detect_residual_text.py"),
            "--before", str(self.source),
            "--after", str(self.slide / "clean_background.png"),
            "--regions", str(self.slide / "text_regions.json"),
            "--mask", str(self.slide / "inpaint_mask.png"),
            "--out-json", str(self.slide / "residual_text_report.json"),
            "--out-overlay", str(self.slide / "residual_text_overlay.png"),
        ], text=True, capture_output=True)

    def enforce(self, *options, human=False):
        result = subprocess.run([
            "node", str(SCRIPTS / "enforce_text_layer.js"),
            "--slide", str(self.slide), *options,
            *([] if human else ["--json"]),
        ], text=True, capture_output=True)
        if human:
            return result, None
        self.assertIn(result.returncode, (0, 1), result.stderr)
        return result, json.loads(result.stdout)["results"][0]

    def assert_unverified(self, result, required=False):
        qualification = result["cleanBackgroundQualification"]
        self.assertEqual(qualification["status"], "unverified")
        self.assertEqual(qualification["required"], required)
        self.assertIn("semantic", qualification["reason"].lower())

    def test_low_edge_producer_labels_without_changing_risk(self):
        result = self.detect()
        self.assertEqual(result.returncode, 0, result.stderr)
        doc = self.read("residual_text_report.json")
        self.assertEqual(doc["status"], "pass")
        self.assertEqual(doc["residualTextRisk"], "low")
        self.assertEqual(doc["regions"][0]["residualPixelsApprox"], 0)
        self.assertEqual(doc["assessment"], {
            "method": "masked_edge_energy", "scope": "heuristic_only",
            "semanticTextRemoval": "unverified",
        })
        self.assertIn("heuristic", result.stdout)
        self.assertIn("unverified", result.stdout)

    def test_empty_mask_stays_semantically_unverified(self):
        Image.new("L", (96, 48), 0).save(self.slide / "inpaint_mask.png")
        self.assertEqual(self.detect().returncode, 0)
        doc = self.read("residual_text_report.json")
        self.assertEqual(doc["status"], "pass")
        self.assertEqual(doc["assessment"]["semanticTextRemoval"], "unverified")

    def test_no_regions_stays_semantically_unverified(self):
        doc = self.read("text_regions.json")
        doc["regions"] = []
        self.write("text_regions.json", doc)
        self.assertEqual(self.detect().returncode, 0)
        doc = self.read("residual_text_report.json")
        self.assertEqual(doc["regions"], [])
        self.assertEqual(doc["assessment"]["semanticTextRemoval"], "unverified")

    def test_default_legacy_contract_still_passes(self):
        process, result = self.enforce()
        self.assertEqual(process.returncode, 0)
        self.assertTrue(result["ok"])
        self.assertTrue(result["artifactContractOk"])
        self.assert_unverified(result)

    def test_strict_low_edge_contract_still_passes(self):
        self.assertEqual(self.detect().returncode, 0)
        process, result = self.enforce("--strict", "--image", str(self.source),
                                       "--require-residual-check", "--max-residual-risk", "low")
        self.assertEqual(process.returncode, 0)
        self.assertTrue(result["artifactContractOk"])
        self.assert_unverified(result)

    def test_qualification_fails_closed_on_legacy_report(self):
        process, result = self.enforce("--require-clean-background")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["ok"])
        self.assertTrue(result["artifactContractOk"])
        self.assert_unverified(result, required=True)
        self.assertTrue(any("clean-background qualification" in e for e in result["errors"]))

    def test_qualification_fails_closed_on_producer_report(self):
        self.assertEqual(self.detect().returncode, 0)
        process, result = self.enforce("--strict", "--require-clean-background")
        self.assertEqual(process.returncode, 1)
        self.assertTrue(result["artifactContractOk"])
        self.assert_unverified(result, required=True)

    def test_injected_approval_cannot_qualify_background(self):
        for claims in [
            {"verified": True},
            {"semanticTextRemoval": "verified"},
            {"assessment": {"method": "independent_semantic_review", "scope": "semantic",
                            "semanticTextRemoval": "verified", "verified": True}},
            {"cleanBackgroundQualification": {"status": "pass", "verified": True}},
            {"independentVerifier": {"status": "pass", "verified": True}},
        ]:
            with self.subTest(claims=claims):
                report = self.legacy_residual()
                report.update(claims)
                self.write("residual_text_report.json", report)
                process, result = self.enforce("--require-clean-background")
                self.assertEqual(process.returncode, 1)
                self.assertTrue(result["artifactContractOk"])
                self.assert_unverified(result, required=True)

    def test_relaxed_risk_limit_cannot_unlock_qualification(self):
        for risk in ["low", "medium", "high"]:
            with self.subTest(risk=risk):
                process, result = self.enforce("--require-clean-background", "--max-residual-risk", risk)
                self.assertEqual(process.returncode, 1)
                self.assertTrue(result["artifactContractOk"])
                self.assert_unverified(result, required=True)

    def test_absent_residual_report_is_unverified_by_default(self):
        (self.slide / "residual_text_report.json").unlink()
        process, result = self.enforce()
        self.assertEqual(process.returncode, 0)
        self.assertTrue(result["artifactContractOk"])
        self.assert_unverified(result)

    def test_qualification_requires_residual_artifact(self):
        (self.slide / "residual_text_report.json").unlink()
        process, result = self.enforce("--require-clean-background")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["artifactContractOk"])
        self.assertIn("missing required residual artifact: residual_text_report.json", result["errors"])
        self.assert_unverified(result, required=True)

    def test_existing_strict_checks_still_fail(self):
        doc = self.read("text_regions.json")
        del doc["sourceImageHash"]
        self.write("text_regions.json", doc)
        process, result = self.enforce("--strict")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["artifactContractOk"])
        self.assertIn("text_regions.json: missing sourceImageHash", result["errors"])
        self.assert_unverified(result)

    def test_existing_risk_acceptance_matrix_unchanged(self):
        ranks = {"low": 0, "medium": 1, "high": 2}
        for risk in ranks:
            for limit in ranks:
                with self.subTest(risk=risk, limit=limit):
                    report = self.legacy_residual()
                    report["residualTextRisk"] = risk
                    report["regions"][0]["residualRisk"] = risk
                    self.write("residual_text_report.json", report)
                    process, result = self.enforce("--max-residual-risk", limit)
                    allowed = ranks[risk] <= ranks[limit]
                    self.assertEqual(process.returncode, 0 if allowed else 1)
                    self.assertEqual(result["ok"], allowed)

    def test_fail_report_still_fails_with_high_risk_limit(self):
        report = self.legacy_residual()
        report["status"] = "fail"
        self.write("residual_text_report.json", report)
        process, result = self.enforce("--max-residual-risk", "high")
        self.assertEqual(process.returncode, 1)
        self.assertIn("residual_text_report.json: status is fail", result["errors"])

    def test_missing_directory_has_both_assessments(self):
        self.slide = self.root / "missing"
        process, result = self.enforce("--require-clean-background")
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["artifactContractOk"])
        self.assert_unverified(result, required=True)

    def test_human_output_distinguishes_contract_from_quality(self):
        process, _ = self.enforce(human=True)
        self.assertEqual(process.returncode, 0)
        self.assertIn("artifact contract: PASS", process.stdout)
        self.assertIn("clean-background qualification: unverified", process.stdout)

    def test_human_qualification_failure_still_identifies_contract_pass(self):
        process, _ = self.enforce("--require-clean-background", human=True)
        self.assertEqual(process.returncode, 1)
        self.assertIn("artifact contract: PASS", process.stdout)
        self.assertIn("clean-background qualification: unverified", process.stdout)

    def test_help_documents_qualification_limit(self):
        process = subprocess.run(["node", str(SCRIPTS / "enforce_text_layer.js"), "--help"],
                                 text=True, capture_output=True)
        self.assertEqual(process.returncode, 0)
        self.assertIn("--require-clean-background", process.stdout)
        self.assertIn("semantic", process.stdout)


if __name__ == "__main__":
    unittest.main()
