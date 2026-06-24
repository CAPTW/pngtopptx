# pptxgenjs gotchas

These are the constraints that cause **silent** failures or corrupt files. The surface in
`atoms_pptx.js` already obeys them; respect them in any new surface code or direct calls.

- **Hex colors: no leading `#`.** Use `"E9B84A"`, not `"#E9B84A"`. The palette `C` stores
  bare hex for this reason.
- **No 8-character hex.** Don't encode alpha in the color string. Transparency is a separate
  numeric property.
- **Transparency via the `transparency` prop (0–100), not alpha-hex.** In the surface this is
  the `fillTrans` option on `rrect`/`chev`.
- **No gradients.** pptxgenjs shape fills are solid. Any gradient (the slide background glow,
  etc.) must be **baked into `bg.png`** and placed as an image.
- **`rectRadius` only applies to `ShapeType.roundRect`.** Setting it on other shapes is
  ignored or errors. Use the rounded-rect shape when you want a corner radius.
- **Shadow `offset` must be ≥ 0.** Negative offsets throw. The surface's shadow uses
  `offset:2`.
- **Never reuse a single options object across shapes/text.** pptxgenjs can mutate or retain
  references; build a fresh object per call. (In slide code this means: don't hoist one
  `const opts = {…}` and pass it to several `addText`/`addShape` calls — inline or clone it.)
- **Line breaks in text** come from the run array (`breakLine:true` on a run) or from `\n`
  in a plain string; the surface's `toRuns` handles both.
- **Coordinates are inches internally.** The surface converts source-px → inches
  (`px * 13.333 / PXW` wide, `px * 7.5 / PXH` tall) for a 13.333×7.5in (16:9) layout. Author
  in px; never pass inches into the surface.
- **`shrinkText`** (autofit shrink-to-fit) is enabled per text via the `shrink` option — used
  by `head()` for long titles/subtitles so they stay on one line.
- **Faithful repro beats "minimalist" instincts.** General guidance discourages dense bordered
  boxes; here, matching a bordered-panel infographic exactly is the requirement, so reproduce
  it faithfully.

Quick smoke test that the file is valid (10-slide example):
```python
import zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile('out/deck.pptx')
slides = sorted(n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml'))
for s in slides: ET.fromstring(z.read(s))      # raises on malformed XML
print(len(slides), 'valid slides;', len([n for n in z.namelist() if n.startswith('ppt/media/')]), 'media')
```
