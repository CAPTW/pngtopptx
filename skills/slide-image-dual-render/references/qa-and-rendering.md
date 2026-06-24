# QA & rendering

How to rasterize the outputs to inspect them, the hazards, and the Python snippets for
measuring coordinates off the source images.

## Codex sub-agent QA gate

Gate one slide at a time. A `slide_qa_gate` compares `src/slideN.png` against the rendered PPTX/HTML
image for slide N, then writes `work/slideXX/qa_report.md` with targeted fixes. The gate should name
the exact owning artifact:

- `work/slideXX/sN.fragment.js` for editable geometry, text boxes, icons, panels, tables, and
  chevrons.
- `work/slideXX/crop_plan.json` for crop boxes, feathering, or duplicated baked labels.
- `profile_override.json` only when the source-vs-render comparison proves a specific token mismatch.

Recommended report shape:

```markdown
# QA Report — slide N

slide number: N
status: pass | fail
source image: src/slideN.png
rendered PPTX raster: out/qa-NN.jpg
rendered HTML screenshot: out/html_sN.jpg

## Blocking Issues
- ...

## Noticeable Issues
- ...

## Minor Issues
- ...

## Suspected Root Cause
- ...

## Exact Suggested Fixes
- `sN.fragment.js`: coordinate/font/size change...
- `crop_plan.json`: crop/feather/trim change...

## Accepted Limitations
- ...
```

For a focused rerender after a fix:

Hard-Locked production path:

```bash
node scripts/slide_pipeline.js --slides N --target both --pptx-out out/slideN.pptx --html-out out/slideN.html
```

Legacy/manual debugging path only:

```bash
SLIDES=N TARGET=both PPTX_OUT=out/slideN.pptx HTML_OUT=out/slideN.html node build.js
```

## PPTX → images (LibreOffice headless)

The skill's `soffice` wrapper can hang; this manual route is reliable:

```bash
cd out
rm -rf /tmp/lohome && mkdir -p /tmp/lohome
setsid soffice --headless --norestore --invisible --nodefault --nologo --nofirststartwizard \
  -env:UserInstallation=file:///tmp/lohome \
  --convert-to pdf --outdir . deck.pptx > /tmp/soffice.log 2>&1 < /dev/null &
# poll generously — the FIRST conversion can take >45s while CJK fonts cache
for i in $(seq 1 60); do [ -f deck.pdf ] && { echo "ready ${i}s"; break; }; sleep 1; done
# clean up by EXACT PID (see hazard below), then rasterize
PID=$(ps -C soffice.bin -o pid= | tr -d ' '); [ -n "$PID" ] && kill -9 $PID 2>/dev/null
pdftoppm -jpeg -r 100 deck.pdf qa      # -> qa-01.jpg, qa-02.jpg, …
```

Then `view` each `qa-NN.jpg`.

LibreOffice is allowed here only as a QA/export tool, for example PPTX -> PDF -> PNG inspection.
It is explicitly forbidden as a creation path for the deliverable PPTX. Do not use LibreOffice to
convert HTML or PDF into PPTX; that bypasses the backend-agnostic renderer and fails Hard-Locked
Workflow validation.

### Hazards (learned the hard way)
- **NEVER `pkill -f soffice`.** The pattern `soffice` matches *your own bash command string*,
  so pkill kills the shell running it (returncode -1). Always kill by exact PID as above.
- **First run is slow.** If you kill too early and `pdftoppm` fires before the PDF exists you
  get `Couldn't open file …pdf`. Just wait and re-poll; the PDF appears shortly after.
- **Reset the profile** (`rm -rf /tmp/lohome`) if a run gets stuck.
- Korean renders fine in LibreOffice via the bundled Noto Sans CJK; `apt-get` is unavailable,
  so don't rely on installing fonts.

## HTML → image (wkhtmltoimage)

Preferred diagnostic HTML capture is the `slide-visual-polish-qa` capture script, not
`wkhtmltoimage`. Generated HTML supports `?qa=1` / `#qa` static mode for visual QA. In that mode:

- `.slide` renders at exactly `DECK_PXW × DECK_PXH`.
- presentation shadows/radius/gaps are suppressed.
- transform scale is disabled and recorded as `appliedScale = 1`.
- `html_screenshot_metadata.json` must record viewport, deviceScaleFactor, slide bounding box,
  computed transform, applied scale, QA/static usage, and exact PNG dimensions.

Example:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-visual-polish-qa\scripts\capture_html_screenshot.py" `
  --project . --html out\deck.html --slides 1,5,12 --out-dir work --width 1672 --height 941
```

If the captured PNG is not exactly the source coordinate space, the capture should fail. Do not
resize or accept a hidden browser-fit transform as a visual QA artifact.

```bash
cd out
setsid wkhtmltoimage --quality 80 --width 1672 --javascript-delay 2000 \
  --disable-smart-width --enable-local-file-access deck.html /tmp/html.jpg \
  > /tmp/wk.log 2>&1 < /dev/null &
for i in $(seq 1 60); do [ -f /tmp/html.jpg ] && { sleep 2; break; }; sleep 1; done
```
The output is one tall image (all slides stacked); slice it in Python to view per-slide.

**Important caveat:** wkhtmltoimage uses an ancient WebKit and is not the parity reference. Use it to
sanity-check layout/content only. Modern-browser visual QA must use the generated HTML QA/static mode
and a local font stack that matches PPTX rasterization.

## Font parity

PPTX does not embed or load remote webfonts by default. HTML must not silently load a CDN font that
PowerPoint cannot use. The build resolves one local font for both outputs:

- requested family comes from `DECK_FONT` or `DECK_PROFILE.typography.family`;
- if unavailable locally, the resolver falls back to `DECK_FONT_FALLBACK` or a common local font such
  as `Arial`, `Aptos`, or `Malgun Gothic`;
- `DECK_FONT_STRICT=1` fails instead of falling back;
- `out/build_trace.json` records the requested/resolved family, fallback reason, and HTML CSS stack.

Do not loosen visual QA thresholds for a font setup problem. Install the intended font for PPTX
rasterization or use a documented fallback for both surfaces.

## Slice / contact-sheet helpers
```python
from PIL import Image
# slice the tall HTML render into per-slide crops
im = Image.open('/tmp/html.jpg'); w,h = im.size; sh = h//N        # N = slide count
for i in range(N): im.crop((0, sh*i, w, sh*(i+1))).save(f'/tmp/html_s{i+1}.jpg')

# build a contact sheet of the PPTX pages for a final holistic pass
ims = [Image.open(f'out/qa-{i:02d}.jpg') for i in range(1, N+1)]
W,H = ims[0].size; sc=0.30; tw,th=int(W*sc),int(H*sc); cols=2; rows=(N+1)//2; pad=10
sheet = Image.new('RGB',(cols*tw+pad*(cols+1), rows*th+pad*(rows+1)),(15,20,30))
for i,im in enumerate(ims):
    r,c = divmod(i, cols)
    sheet.paste(im.resize((tw,th)), (pad+c*(tw+pad), pad+r*(th+pad)))
sheet.save('/tmp/contact.jpg', quality=85)
```

## Measuring coordinates off a source image

Author in exact pixels — measure, don't guess.

```python
from PIL import Image
import numpy as np
im = np.array(Image.open('src/slide6.png').convert('RGB')).astype(int)
H,W,_ = im.shape
R,G,B = im[:,:,0], im[:,:,1], im[:,:,2]

# 1) vertical panel/divider borders within a horizontal band
borderish = ((R>30)&(R<95)&(G>55)&(G<120)&(B>90)&(B<175))   # tune to the line color
cc = borderish[230:560,:].sum(axis=0)
xs = np.where(cc>150)[0]
# cluster consecutive xs into border groups → panel left/right edges & column dividers

# 2) symbol / glyph column centers (e.g. ◎ △ ✕ matrix cells) by color mass
green=((R<140)&(G>150)&(B<150)); orange=((R>200)&(G>130)&(G<200)&(B<110)); red=((R>180)&(G<110)&(B<110))
colmass=(green|orange|red)[250:580,:].sum(axis=0)
# find local maxima of colmass → cell center x's

# 3) horizontal bands of a colored element (gold banner, cyan active chevron, footer)
goldish=((R>150)&(G>110)&(B<120)&(R-B>50)); gr=goldish.mean(axis=1)
ys=[y for y in range(560,941) if gr[y]>0.02]                # contiguous runs → band y-extents
```

When a region is too fiddly to reason about numerically, just crop and view it:
```python
Image.open('src/slide10.png').crop((0,575,1672,840)).save('/tmp/strip.png')   # then view it
```
