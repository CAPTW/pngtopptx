# kit API reference

Everything is drawn onto an abstract **surface** `s` using **source-pixel** coordinates
(origin top-left). The same calls render to PPTX and HTML. Import in `lib/slides.js`:

```js
const K = require('./kit');
const { C, bg, crop, imageAt, panel, rline, T, badge, icon, head, footer,
        banner, chevronBar, iconRows, detailRows } = K;
// K.ASSET is the asset dir; use it for raster paths:
//   s.img(require('path').join(K.ASSET,'my_crop.png'), x, y, w, h)
```

## Environment variables
| var | meaning | default |
|---|---|---|
| `DECK_PXW`, `DECK_PXH` | source-pixel canvas size (= your image resolution) | 1672, 941 |
| `DECK_ASSETS` | dir holding generated `bg.png`, `icons/`, crops, `manifest.json` | `../assets` |
| `DECK_PROFILE` | path to a `styles/*.json` style profile; drives palette / font / background / icon colors. Unset = original dark palette | (unset) |
| `DECK_TITLE`, `DECK_LANG` | HTML `<title>` and `<html lang>` | "Deck", "en" |
| `DECK_EYEBROW`, `DECK_TAG`, `DECK_PREFIX` | header eyebrow line / part-tag pill / title prefix | "" (omitted) |
| `DECK_FOOTER` | default footer text when `footer(s)` called with no arg | "" |
| `SLIDES` | comma list of slide numbers to render (e.g. `1,3,5`) | all |
| `TARGET` | `pptx` \| `html` \| `both` | (build.js arg) |
| `PPTX_OUT`, `HTML_OUT` | output paths | — |

## Palette `C` (hex strings, NO leading `#`)
`bg 020812 · panel 0B1B2D · panelHi 10263C · line 2A4A6E · lineHi 3D6390 · white F2F7FC ·
sub AEC4DA · gold E9B84A · goldDim C9A24A · cyan 3BC4ED · badge 1F6FB5 · badgeRed C13A33 ·
red D8453B · green 3FB950 · chevOn 1E6FB0 · chevOff 0C1C30 · chevLine 2C547E · orange E08A3C ·
steel 7FB6E6`. Font is `Pretendard` (great for Korean + Latin).

**These are the default (no-`DECK_PROFILE`) values.** When `DECK_PROFILE` points at a `styles/*.json`,
`kit.C` and `FONT` are built from that profile by `lib/profile.js` — the keys are identical, only the
values change — so every helper below renders in the profile's idiom. Full `profile → C` map is in
`references/style-integration.md`.

## Surface atoms (low-level, on `s`)
- `s.bgFill(hex)` — solid slide background.
- `s.img(absPath, x,y,w,h)` — place a raster image (crop, icon, bg).
- `s.rrect(x,y,w,h,{fill,fillTrans,line,lineW,radius,shadow})` — rounded rectangle. `fillTrans`
  is transparency 0–100. `radius` in px. `shadow:true` for a soft drop shadow.
- `s.ell(x,y,w,h,{fill,line,lineW})` — ellipse.
- `s.chev(x,y,w,h,{fill,fillTrans,line,lineW})` — right-pointing chevron (roadmap arrow).
- `s.ln(x,y,w,h,{color,width,dash})` — line. Horizontal: `h=0`; vertical: `w=0`. `dash:'dash'`.
- `s.txt(content, x,y,w,h, {sz,color,bold,italic,align,valign,lh,cs,wrap,shrink,margin})` —
  text box. `sz` is **points**. `align` left|center|right, `valign` top|middle|bottom,
  `lh` line-height multiple, `cs` letter spacing, `wrap` (default true), `shrink` (shrink-to-fit
  one line). **`content`** is either a string (`\n` = line break) **or** an array of runs:
  `[{text, bold, italic, color, breakLine}]` for mixed styling on one line.

## Kit helpers (high-level, prefer these)
- **`bg(s)`** — paints `C.bg` then the `bg.png` backdrop full-canvas.
- **`head(s, title, sub, opts?)`** — top band: optional eyebrow, optional part-tag pill,
  big title (with optional prefix), one-line cyan subtitle (auto shrink-to-fit). `opts` =
  `{eyebrow, tag, prefix, tagW, sz}`; omitted fields fall back to env then to nothing.
- **`footer(s, text?)`** — gold warn icon + footer line (`text` or `DECK_FOOTER`).
- **`panel(s, x,y,w,h, opts?)`** — bordered rounded panel. `opts` = `{fill,trans,line,lw,r,shadow}`.
- **`rline(s, x,y,w, color?)`** — horizontal divider.
- **`T(s, content, x,y,w,h, opts?)`** — text convenience wrapper over `s.txt`. `opts` keys:
  `{sz,color,b(old),i(talic),align,valign,lh,cs,wrap,shrink,margin}`. Same `content` rules as `s.txt`.
- **`badge(s, label, x,y, d, opts?)`** — filled circle (diameter `d`) with centered label.
  `opts` = `{fill,line,color,sz}`. Great for numbered steps / `Cl⁻` style chips.
- **`icon(s, concept, color, x,y, d)`** — place an icon PNG (`concept`+`color` from the library)
  at size `d`. Missing concept → prints `!! missing icon` and skips.
- **`banner(s, text, y, opts?)`** — full-width gold emphasis bar at `y`. `opts` =
  `{h, icon, icon2, sz, color}` (icons sit at both ends; defaults shieldcheck / chartline).
- **`chevronBar(s, steps, active, y, lead?)`** — chevron roadmap. `steps` =
  `[{label, icon?, num?, danger?, gold?}]`; `active` is the index to highlight cyan; `gold:true`
  paints a gold step, `danger:true` a red step. `lead` = `{l1, l2, icon}` draws a two-line
  label pill at the left (or `null` for none).
- **`iconRows(s, rows, x,y,w,rowH, opts?)`** — vertical list of `{ic,color,en,title,tcolor,sub}`
  rows (icon + bold lead-in + title + sub-line). `opts` = `{iconD,iconDy,textDx,tsz,ssz,subDy}`.
- **`detailRows(s, rows, x,y,w,rowH, opts?)`** — list of `{ic,label,bullets:[…]}` rows: icon at
  left, bold steel label column, bullet column, faint divider between rows. `opts` =
  `{bx (bullet column x-offset, default 132), lsz (label pt), bsz (bullet pt), icColor}`.
- **`crop(s, name)`** — place a crop registered in `manifest.json` at its captured box.
- **`imageAt(s, name, x,y,w,h)`** — place `assets/<name>.png` at an explicit box.

## Icon concepts available (Tabler-backed)
`adjust alertcircle anchor atom bolt box brain brush chartline checkcircle circledot clipboard
clipboardlist clock cloud coins droplet droplets eye factory file flame flask gauge gear helm
helmet hexagon layers layersx molecule money octagon paint pin recycle refresh ripple ruler
search shield shieldcheck shieldhalf ship skull snow sparkles spray stophand target thermo tools
user wall warn warnfill wave weight wind wrench xcircle zoom`

Colors: `white lblue cyan red green gold blue`. To add a concept, add a `concept → 'TbXxx'`
entry to the `MAP` in `make_icons.js` (browse names at the react-icons Tabler set) and re-run
`node make_icons.js`. There is **no** `faucet`/`chain`/`organ` — substitute the closest
(`wave`, `droplet`, `molecule`, `user`).

## Minimal slide skeleton
```js
function s1(s){
  bg(s);
  head(s, 'Title', 'one-line subtitle', { tag:'Part I', prefix:'Ch.1' });
  panel(s, 28, 200, 800, 380);
  T(s, 'Panel heading', 28, 212, 800, 28, { sz:15, b:true, color:C.cyan, align:'center' });
  icon(s, 'gauge', 'lblue', 48, 256, 34);
  T(s, 'body text', 96, 256, 700, 40, { sz:12, color:C.sub });
  banner(s, 'Key takeaway', 710, { icon:'warn' });
  chevronBar(s, [{label:'A',num:'1'},{label:'B',num:'2'},{label:'C',num:'3'}], 1, 786,
             { l1:'Road', l2:'map', icon:'helm' });
  footer(s, 'source / disclaimer');
}
module.exports = { s1 /*, s2, ... */ };
```
