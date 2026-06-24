#!/usr/bin/env python3
"""Generate the slide background -> assets/bg.png.

Design tokens come from the active style PROFILE when DECK_PROFILE is set:
  DECK_PROFILE=styles/clinical-dark.json DECK_ASSETS=/path/to/assets python make_bg.py
With NO DECK_PROFILE the output is the original dark-navy gradient, byte-for-byte
unchanged. A gradient-dark profile uses its from/to stops; a light profile paints a
near-white base with a faint cool glow + vignette so shadowed cards still separate.
(Gradients can't be drawn in PPTX, so they are baked into this image.)
"""
import os
import json
import numpy as np
from PIL import Image

ASSETS = os.environ.get("DECK_ASSETS", os.path.join(os.path.dirname(__file__), "assets"))
os.makedirs(ASSETS, exist_ok=True)
PXW, PXH = int(os.environ.get("DECK_PXW", 1672)), int(os.environ.get("DECK_PXH", 941))
# 2x for crispness
W, H = PXW * 2, PXH * 2


def hx(c, default):
    c = (c or "").strip()
    if c.startswith("#"):
        c = c[1:]
    if len(c) == 6:
        try:
            return [int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)]
        except ValueError:
            pass
    return list(default)


# --- read background tokens from the active profile (or the original defaults) ---
prof = None
pp = os.environ.get("DECK_PROFILE")
if pp:
    try:
        with open(pp, "r", encoding="utf-8") as f:
            prof = json.load(f)
    except Exception as e:  # noqa: BLE001
        print("!! DECK_PROFILE unreadable, using default bg:", e)
bgd = (prof or {}).get("dimensions", {}).get("background", {})
btype = bgd.get("type", "gradient-dark")

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx = xx / W
ny = yy / H

if "light" in btype:
    base_c = np.array(hx(bgd.get("base"), [255, 255, 255]), np.float32)
    panel_c = np.array(hx(bgd.get("panel"), [244, 247, 251]), np.float32)
    img = np.broadcast_to(base_c, (H, W, 3)).astype(np.float32).copy()
    # faint cool top glow so white cards + soft shadows separate from the field
    d = np.sqrt(((nx - 0.30) / 0.70) ** 2 + ((ny - 0.12) / 0.50) ** 2)
    glow = np.clip(1.0 - d, 0, 1) ** 1.8
    img = img + (panel_c - base_c)[None, None, :] * glow[..., None] * 0.6
    # gentle corner vignette toward the panel tone
    dv = np.sqrt(((nx - 0.5) / 0.72) ** 2 + ((ny - 0.5) / 0.72) ** 2)
    vig = np.clip(dv - 0.72, 0, 1) * 0.10
    img = img - (base_c - panel_c)[None, None, :] * vig[..., None]
else:
    # gradient-dark: vertical from->to, soft upper-left glow, corner vignette
    base_top = np.array(hx(bgd.get("from"), [6, 16, 30]), np.float32)   # #06101E
    base_bot = np.array(hx(bgd.get("to"), [2, 8, 18]), np.float32)      # #020812
    glow_col = np.minimum(base_top + np.array([7, 6, 10], np.float32), 255.0)  # #0D1628 default
    base = base_top[None, None, :] * (1 - ny[..., None]) + base_bot[None, None, :] * ny[..., None]
    d = np.sqrt(((nx - 0.42) / 0.55) ** 2 + ((ny - 0.20) / 0.42) ** 2)
    glow = np.clip(1.0 - d, 0, 1) ** 1.6
    img = base + (glow_col - base_bot)[None, None, :] * glow[..., None] * 0.9
    dv = np.sqrt(((nx - 0.5) / 0.72) ** 2 + ((ny - 0.5) / 0.72) ** 2)
    vig = np.clip(dv - 0.7, 0, 1) * 0.5
    img = img * (1 - vig[..., None] * 0.85)

img = np.clip(img, 0, 255).astype(np.uint8)
Image.fromarray(img, "RGB").save(os.path.join(ASSETS, "bg.png"))
print("bg.png", img.shape, "type=", btype)
