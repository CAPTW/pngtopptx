#!/usr/bin/env python3
"""Crop the regions of each source slide that CANNOT be faithfully rebuilt with
vector primitives (photoreal renders, 3D diagrams, photos, baked-in label art),
feather the edges that float on the background so they blend seamlessly, and emit
a JSON manifest of source-px boxes for exact placement by the renderer.

Per job you only edit the CROPS table below. Paths are env-configurable:
  SRC_DIR=/path/with/slide1.png...   (source images, named slide{N}.png)
  DECK_ASSETS=/path/to/assets        (crops + manifest.json are written here)
  python make_crops.py

Hard-Locked Workflow Mode passes an explicit crop plan through slide_pipeline.js --crop-plan <path>, which sets CROP_PLAN for this script. If --crop-plan is omitted, the documented production default is work/crop_plan.json.\n\nparallel worker jobs should not edit this shared file. Instead, write per-slide\nplans to work/slideXX/crop_plan.json, run integrate_parallel_work.js, then run:\n  CROP_PLAN=work/crop_plan.integrated.json python make_crops.py

Rule of thumb on WHAT to crop: rebuild everything you can as editable objects
(titles, panels, tables, bullets, icons, chevrons, callouts). Only crop what is
genuinely un-recreatable — gradients-on-metal, 3D wireframes, photographs, and
dense label art baked into a render. Keep crops tight; if a crop accidentally
includes a caption you will re-create natively, trim that strip off afterwards
(see TRIMMING in references/workflow.md) so it does not duplicate.
"""
import json
import os
import re
import numpy as np
from PIL import Image

SRC = os.path.join(os.environ.get("SRC_DIR", "src"), "slide{}.png")
ASSETS = os.environ.get("DECK_ASSETS", os.path.join(os.path.dirname(__file__), "assets"))
os.makedirs(ASSETS, exist_ok=True)
OUT = os.path.join(ASSETS, "{}.png")
LEGACY_RECONSTRUCTION_REASON = "legacy crop metadata not supplied; review before reconstruction delivery"
GENERATED_MANIFEST_FIELDS = {"name", "slide", "x", "y", "w", "h", "file"}
CROP_GENERATION_FIELDS = {"edges", "feather", "feather_edges"}
CROP_GEOMETRY_ALIAS_FIELDS = {"width", "height"}
CROP_CONTROL_FIELDS = GENERATED_MANIFEST_FIELDS | CROP_GENERATION_FIELDS | CROP_GEOMETRY_ALIAS_FIELDS
REQUIRED_POLICY_METADATA = ("content_type", "reconstruction_reason", "editable_replacement")

# ---- PER-JOB TABLE — replace with your own regions ----
# name -> (slide_number, x, y, w, h, feather_edges)
#   feather_edges: any of "LRTB"; those edges fade to transparent so the crop
#   blends into the background. Use "LRTB" for renders floating on the canvas;
#   use "LB" (etc.) for a photo anchored to a corner.
# The example below is a real 10-slide maritime deck — delete and write yours.
CROPS = {
    # ship photo (top-right): start right of the longest title, end above
    # every section header; fades on Left + Bottom into navy
    "ship1":  (1, 1190, 0, 482, 245, "LB"),
    "ship2":  (2, 1190, 0, 482, 245, "LB"),
    "ship3":  (3, 1190, 0, 482, 245, "LB"),
    "ship4":  (4, 1190, 0, 482, 245, "LB"),
    "ship5":  (5, 1190, 0, 482, 245, "LB"),
    "ship6":  (6, 1190, 0, 482, 245, "LB"),
    "ship7":  (7, 1190, 0, 482, 245, "LB"),
    "ship8":  (8, 1190, 0, 482, 245, "LB"),
    "ship9":  (9, 1190, 0, 482, 245, "LB"),
    "ship10": (10, 1190, 0, 482, 245, "LB"),

    # central / photoreal renders (float on navy -> feather all sides)
    "s1_block":   (1, 820, 372, 470, 180, "LRTB"),   # metallic corrosion block + magnified pit
    "s2_center":  (2, 785, 408, 105, 100, "LRTB"),   # corroded centre disc
    "s3_eccell":  (3, 422, 298, 765, 392, "LRTB"),   # full electrochemical cell render + labels
    "s4_galv":    (4, 598, 282, 500, 348, "LRTB"),   # two blocks underwater + labels
    "s4_series":  (4, 186, 270, 82, 405, "TB"),      # 10 colour badges + metal swatches column
    "s5_forms":   (5, 150, 320, 1212, 112, "LRTB"),  # 5 corrosion cross-sections row
    "s6_block":   (6, 688, 392, 304, 100, "LRTB"),   # cracked block
    "s6_trio":    (6, 693, 266, 300, 80, "LRTB"),    # env+stress+susceptibility icon trio
    "s7_system":  (7, 922, 282, 385, 372, "LRTB"),   # 3D tank system + callout labels
    "s8_section": (8, 492, 292, 695, 330, "LRTB"),   # coating cross-section + right labels
    "s10_photo":  (10, 538, 296, 600, 350, "LRTB"),  # good/bad wall comparison photo + labels
}


def _num(value, field, name):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        raise ValueError(f"crop {name!r} has invalid numeric field {field!r}: {value!r}")


def _is_supplied(value):
    return value is not None and value != ""


def _first_supplied(data, *keys):
    for key in keys:
        if key in data and _is_supplied(data[key]):
            return data[key], True
    return None, False


def _legacy_metadata():
    return {
        "content_type": "dense_infographic",
        "reconstruction_reason": LEGACY_RECONSTRUCTION_REASON,
        "editable_replacement": "none",
        "metadataComplete": False,
        "metadataSource": "legacy_default",
        "missingMetadata": list(REQUIRED_POLICY_METADATA),
    }


def _metadata_from_dict(value):
    metadata = {k: v for k, v in value.items() if k not in CROP_CONTROL_FIELDS}
    missing = []

    content_type, supplied = _first_supplied(value, "content_type", "contentType")
    if supplied:
        metadata["content_type"] = content_type
    else:
        metadata["content_type"] = "dense_infographic"
        missing.append("content_type")

    reconstruction_reason, supplied = _first_supplied(value, "reconstruction_reason", "reconstructionReason")
    if supplied:
        metadata["reconstruction_reason"] = reconstruction_reason
    else:
        metadata["reconstruction_reason"] = LEGACY_RECONSTRUCTION_REASON
        missing.append("reconstruction_reason")

    editable_replacement, supplied = _first_supplied(value, "editable_replacement", "editableReplacement")
    if supplied:
        metadata["editable_replacement"] = editable_replacement
    else:
        metadata["editable_replacement"] = "none"
        missing.append("editable_replacement")

    allow_large_crop, supplied = _first_supplied(value, "allow_large_crop", "allowLargeCrop")
    if supplied:
        metadata["allow_large_crop"] = allow_large_crop

    reason, supplied = _first_supplied(value, "reason", "justification")
    if supplied:
        metadata["reason"] = reason

    if missing:
        metadata["metadataComplete"] = False
        metadata["metadataSource"] = "legacy_default"
        metadata["missingMetadata"] = missing

    return metadata


def _normalize_crop(name, value, fallback_slide=None):
    if isinstance(value, (list, tuple)):
        if len(value) < 5:
            raise ValueError(f"crop {name!r} list must contain slide,x,y,w,h[,edges]")
        sl, x, y, w, h = value[:5]
        edges = value[5] if len(value) > 5 else ""
        metadata = _legacy_metadata()
    elif isinstance(value, dict):
        name = value.get("name", name)
        sl = value.get("slide", fallback_slide)
        x, y, w, h = value.get("x"), value.get("y"), value.get("w"), value.get("h")
        edges = value.get("feather_edges", value.get("edges", value.get("feather", "")))
        metadata = _metadata_from_dict(value)
    else:
        raise ValueError(f"crop {name!r} must be a list or object")

    if not name:
        raise ValueError("crop entry missing name")
    if sl is None:
        raise ValueError(f"crop {name!r} missing slide")

    edges = str(edges or "").upper()
    if not re.fullmatch(r"[LRTB]*", edges):
        raise ValueError(f"crop {name!r} has invalid feather_edges {edges!r}")

    crop = dict(metadata)
    crop.update({
        "name": str(name),
        "slide": _num(sl, "slide", name),
        "x": _num(x, "x", name),
        "y": _num(y, "y", name),
        "w": _num(w, "w", name),
        "h": _num(h, "h", name),
        "feather_edges": edges,
    })
    return crop


def _merge_crop_entry(target, name, value, fallback_slide=None):
    crop = _normalize_crop(name, value, fallback_slide)
    crop_name = crop["name"]
    if crop_name in target:
        raise ValueError(f"duplicate crop name {crop_name!r}")
    target[crop_name] = crop


def _merge_crop_items(crops, items, path, fallback_slide=None):
    if isinstance(items, list):
        for entry in items:
            if not isinstance(entry, dict) or not entry.get("name"):
                raise ValueError(f"{path} has a crop list entry without name")
            _merge_crop_entry(crops, entry["name"], entry, fallback_slide)
    elif isinstance(items, dict):
        for name, value in items.items():
            _merge_crop_entry(crops, name, value, fallback_slide)
    else:
        raise ValueError(f"{path} has an unsupported crop collection")


def _load_crop_plan_file(path, fallback_slide=None):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        items = data
    elif isinstance(data, dict) and isinstance(data.get("crops"), list):
        items = data["crops"]
    elif isinstance(data, dict) and isinstance(data.get("crops"), dict):
        items = data["crops"]
    elif isinstance(data, dict) and isinstance(data.get("slides"), dict):
        crops = {}
        for slide_key, slide_items in data["slides"].items():
            m = re.fullmatch(r"(?:slide)?(\d+)", str(slide_key), flags=re.IGNORECASE)
            slide_fallback = int(m.group(1)) if m else fallback_slide
            _merge_crop_items(crops, slide_items, path, slide_fallback)
        return crops
    elif isinstance(data, dict):
        items = data
    else:
        raise ValueError(f"{path} must be a crop list or object")

    crops = {}
    _merge_crop_items(crops, items, path, fallback_slide)
    return crops


def _load_crop_plans_from_dir(plan_dir):
    crops = {}
    for entry in sorted(os.listdir(plan_dir)):
        slide_dir = os.path.join(plan_dir, entry)
        if not os.path.isdir(slide_dir):
            continue
        m = re.fullmatch(r"slide(\d+)", entry, flags=re.IGNORECASE)
        if not m:
            continue
        plan = os.path.join(slide_dir, "crop_plan.json")
        if not os.path.exists(plan):
            continue
        for name, value in _load_crop_plan_file(plan, int(m.group(1))).items():
            if name in crops:
                raise ValueError(f"duplicate crop name {name!r}")
            crops[name] = value
    return crops


def _active_crops():
    crop_plan = os.environ.get("CROP_PLAN")
    crop_plan_dir = os.environ.get("CROP_PLAN_DIR")
    if crop_plan:
        merged = {}
        for plan in crop_plan.split(os.pathsep):
            if not plan:
                continue
            for name, value in _load_crop_plan_file(plan).items():
                _merge_crop_entry(merged, name, value)
        print(f"loaded {len(merged)} crops from CROP_PLAN")
        return merged
    if crop_plan_dir:
        merged = _load_crop_plans_from_dir(crop_plan_dir)
        print(f"loaded {len(merged)} crops from CROP_PLAN_DIR")
        return merged
    return {name: _normalize_crop(name, value) for name, value in CROPS.items()}


def feather(arr, edges, fpx=26):
    h, w = arr.shape[:2]
    ax = np.ones(w, np.float32)
    ay = np.ones(h, np.float32)
    if "L" in edges:
        n = min(fpx, w); ax[:n] = np.minimum(ax[:n], np.linspace(0, 1, n))
    if "R" in edges:
        n = min(fpx, w); ax[-n:] = np.minimum(ax[-n:], np.linspace(1, 0, n))
    if "T" in edges:
        n = min(fpx, h); ay[:n] = np.minimum(ay[:n], np.linspace(0, 1, n))
    if "B" in edges:
        n = min(fpx, h); ay[-n:] = np.minimum(ay[-n:], np.linspace(1, 0, n))
    mask = np.outer(ay, ax)
    return mask


manifest = {}
for name, value in _active_crops().items():
    sl = value["slide"]
    x = value["x"]
    y = value["y"]
    w = value["w"]
    h = value["h"]
    edges = value.get("feather_edges", "")
    im = Image.open(SRC.format(sl)).convert("RGB")
    W, H = im.size
    x2, y2 = min(W, x + w), min(H, y + h)
    crop = im.crop((x, y, x2, y2)).convert("RGBA")
    a = np.array(crop).astype(np.float32)
    m = feather(a, edges)
    a[..., 3] = (a[..., 3] * m).astype(np.float32)
    file_name = f"{name}.png"
    Image.fromarray(a.astype(np.uint8), "RGBA").save(os.path.join(ASSETS, file_name))
    manifest_entry = {k: v for k, v in value.items() if k not in CROP_CONTROL_FIELDS}
    manifest_entry.update({"name": name, "slide": sl, "x": x, "y": y, "w": x2 - x, "h": y2 - y, "file": file_name})
    manifest[name] = manifest_entry
    print(f"{name:12s} slide{sl} ({x},{y},{x2-x},{y2-y}) edges={edges}")

with open(os.path.join(ASSETS, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
print("manifest written")


