"""Synthetic keyword-routing regressions; no slide files or captured metadata.

All pixels, region geometry, IDs, and example text are invented in this module.
The metadata cases exercise classifier vocabulary and unrelated word boundaries.
"""

import importlib.util
import os
from pathlib import Path
import unittest

import numpy as np


PROJECT = Path(__file__).resolve().parents[1]
SCRIPT = Path(os.environ.get(
    "CLASSIFIER_UNDER_TEST",
    PROJECT / "skills/slide-text-layer-inpaint/scripts/classify_background_regions.py",
))
SPEC = importlib.util.spec_from_file_location("synthetic_keyword_classifier", SCRIPT)
CLASSIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLASSIFIER)


class SyntheticKeywordRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rgb = np.full((72, 96, 3), 192, dtype=np.uint8)
        cls.gray = np.full((72, 96), 192, dtype=np.float32)

    def classify(self, words="", field="visual"):
        region = {"id": "example", "bbox": {"x": 16, "y": 18, "w": 24, "h": 12}}
        if field == "notes":
            region["evidence"] = {"notes": words}
        else:
            region[field] = words
        return CLASSIFIER.classify_region(self.rgb, self.gray, region)

    def assert_route(self, words, expected, field="visual"):
        result = self.classify(words, field)
        self.assertEqual(result["backgroundType"], expected)
        self.assertEqual(result["recommendedRepair"], CLASSIFIER.REPAIR_BY_TYPE[expected])
        return result

    def test_invented_photographic_regions(self):
        regions = (
            {
                "id": "example-a",
                "bbox": {"x": 14, "y": 17, "w": 23, "h": 11},
                "role": "caption",
                "correctedText": "Example note A",
                "visual": "photographic",
                "evidence": {"notes": "workflow paragraph"},
            },
            {
                "id": "example-b",
                "bbox": {"x": 51, "y": 43, "w": 17, "h": 13},
                "role": "caption",
                "correctedText": "Example note B",
                "evidence": {"notes": "photographic texture for a sample caption"},
            },
        )
        for region in regions:
            with self.subTest(region=region["id"]):
                result = CLASSIFIER.classify_region(self.rgb, self.gray, region)
                self.assertEqual(result["backgroundType"], "photo_texture")
                self.assertEqual(result["recommendedRepair"], "inpaint")
                self.assertEqual(result["confidence"], 0.82)

    def test_photo_vocabulary(self):
        for word in (
            "photo", "photos", "photo_texture", "photograph", "photographs",
            "photographic", "photography", "photoreal", "photorealistic",
            "texture", "textures", "image", "images",
        ):
            with self.subTest(word=word):
                self.assert_route(word, "photo_texture")

    def test_embedded_words_do_not_override_pixels(self):
        for word in (
            "paragraph", "workflow", "silicon", "stable", "arrow", "ruler",
            "overflow", "imageable", "afterglow",
        ):
            with self.subTest(word=word):
                self.assert_route(word, "flat_color")

    def test_exact_classifier_vocabulary(self):
        vocabulary = {
            "chart_area": ("chart", "axis", "plot", "graph", "data point"),
            "icon_area": ("icon", "glyph", "pictogram"),
            "table_cell": ("table", "cell", "matrix", "row", "column", "grid"),
            "rule_line": ("rule", "divider", "underline", "border line"),
            "panel": (
                "panel", "card", "badge", "box", "callout", "input_doc", "warning",
                "flow", "category", "bottom_statement", "page_indicator", "slide_code",
            ),
            "gradient": ("gradient", "glow"),
        }
        for expected, words in vocabulary.items():
            for word in words:
                with self.subTest(word=word):
                    self.assert_route(word, expected)

    def test_explicit_chart_compounds_stay_conservative(self):
        for word in (
            "flowchart", "scatterplot", "bargraph", "linegraph", "barplot",
            "boxplot", "lineplot", "barchart", "linechart", "piechart", "areachart",
        ):
            for value in (word, word + "s", word + "; photographic"):
                with self.subTest(value=value):
                    result = self.assert_route(value, "chart_area")
                    self.assertEqual(result["recommendedRepair"], "manual_review")

    def test_infographics_stay_conservative(self):
        for value in ("infographic", "infographics", "infographic; photo"):
            with self.subTest(value=value):
                result = self.assert_route(value, "chart_area")
                self.assertEqual(result["recommendedRepair"], "manual_review")
                self.assertEqual(result["confidence"], 0.82)

    def test_plural_keywords(self):
        for word, expected in (
            ("charts", "chart_area"), ("graphs", "chart_area"),
            ("data points", "chart_area"), ("icons", "icon_area"),
            ("cells", "table_cell"), ("panels", "panel"), ("boxes", "panel"),
        ):
            with self.subTest(word=word):
                self.assert_route(word, expected)

    def test_boundaries_and_metadata_fields(self):
        for field in ("role", "class", "backgroundType", "visual", "notes"):
            for value in ("chart_area", "CHART", "(graph)", "x-axis", "chart/photo"):
                with self.subTest(field=field, value=value):
                    self.assert_route(value, "chart_area", field)
        for value in ("photo_texture", "photo-texture", "PHOTOGRAPHIC"):
            with self.subTest(value=value):
                self.assert_route(value, "photo_texture", "backgroundType")

    def test_rule_precedence(self):
        for words, expected in (
            ("chart; photo", "chart_area"), ("icon; table; photo", "icon_area"),
            ("table; rule; photo", "table_cell"), ("rule; panel; photo", "rule_line"),
            ("panel; photo", "panel"), ("photo; gradient", "photo_texture"),
            ("flow; photographic", "panel"),
        ):
            with self.subTest(words=words):
                self.assert_route(words, expected)

    def test_uniform_pixels_without_metadata(self):
        result = self.classify()
        self.assertEqual(result["backgroundType"], "flat_color")
        self.assertEqual(result["recommendedRepair"], "redraw")
        self.assertEqual(result["confidence"], 0.86)
        self.assertEqual(result["sampledColors"], ["#C0C0C0"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
