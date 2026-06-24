# Pseudo Text Policy

Pseudo text is text-like visual content that should not become native editable text.
The point is to avoid creating false semantic content while still preserving the visual
appearance of the slide.

## Treat As Pseudo Text

- Fake words or labels in a mockup, illustration, or UI wireframe.
- Dense unreadable marks that resemble code, equations, labels, or interface copy.
- Blurry, cropped, distorted, or partially hidden text where transcription would be guesswork.
- Repeated placeholder strokes that visually imply paragraphs or list items.
- Synthetic chart labels, map labels, or texture text where exact words are not meaningful.

## Treat As Decorative Glyph

- Letter-like symbols used as pattern, wallpaper, or icon texture.
- Abstract glyph clusters that do not form language.
- Stylized typographic marks used as decoration rather than content.
- Tiny alphanumeric fragments embedded in icons or pictograms.

## Do Not Promote Without Review

OCR confidence is not a promotion signal. A pseudo text candidate may become
`semantic_text` only after visual review and a corrected transcription. When promoted,
it must move to `semantic_text` and receive `correctedText`.

If a region was previously classified as `pseudo_text`, the promotion must be explicit and
auditable, for example with `promotionApproved: true` and reviewer notes. Strict enforcement
rejects silent pseudo-to-semantic promotion because it is a common source of invented native
text.

## Downstream Reconstruction

For `pseudo_text` and `decorative_glyph`:

- Do not create native text boxes from OCR output.
- Do not invent words to make the region editable.
- Preserve only the visual role: crop, vector-like texture, glyph marks, or cleaned background,
  depending on the downstream reconstruction plan.
- If the region is removed into `clean_background.png`, the renderer must still decide whether
  a non-text visual replacement is needed.

Pseudo/decorative regions may need slightly different masks from semantic text. Use
`--pseudo-dilate-px` to cover anti-aliased glyph-like strokes without over-expanding into
nearby icons or chart marks. Pseudo text still must not become semantic text merely because
OCR produced a plausible string.

## Residual QA

Pseudo/decorative marks can leave ghost strokes after cleanup. `detect_residual_text.py`
checks repaired backgrounds around all masked text-like regions. High residual risk fails
strict validation; medium risk requires review. When residual pseudo marks are intentionally
preserved as visual texture, document the exception in region notes and downstream handoff
notes rather than reclassifying the marks as semantic text.

## Required Metadata

Each pseudo/decorative region should include `evidence.notes` explaining why it is not safe
native text. Examples:

```json
{
  "id": "r014",
  "class": "pseudo_text",
  "bbox": { "x": 782, "y": 310, "w": 116, "h": 18 },
  "evidence": {
    "ocrText": "S0lution",
    "notes": "Small blurred mockup label; not reliable semantic copy"
  },
  "inpaint": { "allowed": true, "paddingPx": 2 }
}
```
