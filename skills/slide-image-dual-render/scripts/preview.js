#!/usr/bin/env node
/*
 * preview.js — render a style PROFILE into a one-page "specimen" so you can
 * eyeball whether the extracted tokens actually match the source idiom.
 *
 *   node scripts/preview.js styles/clinical-dark.json out/clinical-dark.html
 *
 * The specimen exercises every token group: background, header, title coloring,
 * three panel variants (default / alt / warn), the step strip, a palette swatch
 * row, and the footer. Nothing here is content-specific — it is a style probe.
 *
 * Output is self-contained HTML, absolute-positioned on the profile canvas, with
 * NO CSS custom properties (kept compatible with the wkhtmltoimage QA path).
 */
const fs = require('fs');
const path = require('path');

const [, , profilePath, outArg] = process.argv;
if (!profilePath) { console.error('usage: node scripts/preview.js <profile.json> [out.html]'); process.exit(1); }
const P = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const out = outArg || path.join('out', path.basename(profilePath, '.json') + '.html');

const W = (P.canvas && P.canvas.w) || 1672;
const H = (P.canvas && P.canvas.h) || 941;
const pal = P.palette || {};
const typo = P.typography || {};
const comp = P.components || {};
const isDark = (P.dimensions && P.dimensions.background && /dark/.test(P.dimensions.background.type)) ? true : false;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = n => `${n}px`;
// absolutely-positioned box helper
function box(x, y, w, h, css = '', inner = '') {
  return `<div style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};${css}">${inner}</div>`;
}
function txt(x, y, css, s) { return `<div style="position:absolute;left:${px(x)};top:${px(y)};${css}">${s}</div>`; }

// ---- background ----------------------------------------------------------
let bg = '';
const bgd = (P.dimensions && P.dimensions.background) || {};
if (isDark) {
  const from = bgd.from || '#0E1A2B', to = bgd.to || '#070C14', ang = bgd.angle || 155;
  bg = `background:linear-gradient(${ang}deg, ${from} 0%, ${to} 100%);`;
} else {
  bg = `background:${bgd.base || pal.bg || '#FFFFFF'};`;
}

// faint decorative accent (non-essential; degrades gracefully)
let deco = '';
if (!isDark) {
  // corporate: a subtle diagonal navy wedge top-right + a faint wave at the foot
  deco += box(W - 360, -120, 520, 360, `background:${pal.navy || '#0E2A47'};opacity:0.05;transform:rotate(22deg);`);
  deco += `<svg width="${W}" height="120" style="position:absolute;left:0;top:${H - 120}px;opacity:0.10">
    <path d="M0,70 C320,20 620,120 940,60 C1240,10 1500,90 ${W},50 L${W},120 L0,120 Z" fill="${pal.navy || '#0E2A47'}"/></svg>`;
} else {
  // clinical: faint radial vignette
  deco += box(0, 0, W, H, `background:-webkit-radial-gradient(70% 30%, rgba(51,169,224,0.10), rgba(0,0,0,0) 55%);`);
}

// ---- header --------------------------------------------------------------
const hdr = P.header || {};
let headerHtml = '', titleY;
if (hdr.style === 'titlebar') {
  const barFill = hdr.barFill || '#FFFFFF', color = hdr.color || pal.navy || '#0E2A47', tick = hdr.tick || pal.orange || '#E8732A';
  headerHtml = box(0, 0, W, 92, `background:${barFill};box-shadow:0 1px 0 rgba(14,42,75,0.08);`,
    // ship glyph
    box(44, 22, 48, 48, '', `<svg width="48" height="48" viewBox="0 0 48 48"><path d="M8 30 L40 30 L34 40 L14 40 Z" fill="${color}"/><rect x="20" y="14" width="3" height="14" fill="${color}"/><rect x="24" y="18" width="12" height="3" fill="${color}"/></svg>`)
    + box(100, 18, 6, 56, `background:${tick};`)
    + txt(122, 24, `font:800 40px ${typo.family};color:${color};letter-spacing:0.5px;`, 'CHEMICAL TANKER OVERVIEW'));
  titleY = 128;
} else {
  const color = hdr.color || '#7FC6EE', sep = hdr.sep || '\u203a';
  const crumb = ['Phase 4', 'Part IV Cargo Operation', 'CH.38 \uACE0\uC810\uB3C4 \uD654\uBB3C'].join(`&nbsp;&nbsp;<span style="opacity:.6">${sep}</span>&nbsp;&nbsp;`);
  headerHtml = txt(44, 26, `font:600 17px ${typo.family};color:${color};letter-spacing:0.5px;`, crumb)
    + box(W - 174, 18, 130, 38, `border:1px solid ${(hdr.pill && hdr.pill.border) || '#27496A'};border-radius:8px;`,
      txt(0, 8, `width:130px;text-align:center;font:600 16px ${typo.family};color:${(hdr.pill && hdr.pill.ink) || '#AFC2D6'};`, '2 / 10'));
  titleY = 104;
}

// ---- title block ---------------------------------------------------------
const ey = typo.eyebrow || {};
let titleBlock = '';
if (ey.size) {
  const t = isDark ? '\uD559\uC2B5 \uBAA9\uD45C' : 'MARITIME ENGINEERING';
  titleBlock += txt(56, titleY, `font:700 ${ey.size}px ${typo.family};color:${ey.color};letter-spacing:${ey.tracking || 1}px;${ey.upper ? 'text-transform:uppercase;' : ''}`, esc(t));
}
const tY = titleY + (ey.size ? 30 : 0);
const krCol = typo.titleKRColor || pal.ink || '#fff';
const enCol = typo.titleENColor || pal.gold || pal.navy || '#fff';
const upper = typo.titleUpper ? 'text-transform:uppercase;' : '';
const krWord = isDark ? '\uB3C5\uC131\u00B7\uB178\uCD9C\uD55C\uACC4' : '\uD654\uBB3C \uC6B4\uC601';
const enWord = isDark ? 'Toxicity &amp; Exposure' : 'Cargo Operations';
titleBlock += txt(56, tY, `font:${typo.titleWeight || 800} ${typo.titleSize || 56}px ${typo.family};line-height:1.05;${upper}`,
  `<span style="color:${krCol}">${krWord}</span> <span style="color:${enCol}">${enWord}</span>`);
const sub = typo.subtitle || {};
titleBlock += txt(56, tY + (typo.titleSize || 56) + 18, `font:500 ${sub.size || 22}px ${typo.family};color:${sub.color || pal.inkMuted};`,
  `\uC774 \uC2A4\uD0C0\uC77C\uC740 \uC785\uB825 \uC2AC\uB77C\uC774\uB4DC\uC5D0\uC11C \uCD94\uCD9C\uD55C <span style="color:${sub.highlight || enCol};font-weight:700">style token</span>\uC73C\uB85C \uB80C\uB354\uB429\uB2C8\uB2E4.`);

// ---- panels --------------------------------------------------------------
function iconSvg(color, style, mark) {
  if (style === 'filled-navy' || style === 'fill') {
    return `<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="16" fill="${color}"/><path d="M11 17 l4 4 l8 -9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return `<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" stroke="${color}" stroke-width="2" fill="none"/><path d="M11 17 l4 4 l8 -9" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function panel(x, c, title, b1, b2, iconColor) {
  const rad = (P.panel && P.panel.radius) || 12;
  const bw = (P.panel && P.panel.borderWidth) || 1;
  const pad = (P.panel && P.panel.pad) || 22;
  const shadow = c.shadow && c.shadow !== 'none' ? `box-shadow:${c.shadow};` : '';
  const badgeIsCircle = (P.accent && P.accent.stepStyle === 'circle-fill');
  const badge = badgeIsCircle
    ? `<div style="position:absolute;left:${pad}px;top:${pad}px;width:42px;height:42px;border-radius:50%;background:${c.badge};color:#fff;font:800 20px ${typo.family};text-align:center;line-height:42px">1</div>`
    : `<div style="position:absolute;left:${pad}px;top:${pad - 6}px;font:800 40px ${typo.family};color:${c.badge}">01</div>`;
  return box(x, 380, 470, 250,
    `background:${c.fill};border:${bw}px solid ${c.border};border-radius:${rad}px;${shadow}`,
    badge
    + box(470 - pad - 34, pad, 34, 34, '', iconSvg(iconColor || c.badge, (P.icon && P.icon.style) || 'line'))
    + txt(pad, pad + 56, `font:700 23px ${typo.family};color:${c.ink}`, esc(title))
    + txt(pad, pad + 98, `font:500 16px ${typo.family};color:${c.sub};line-height:1.7`, '\u00B7 ' + esc(b1) + '<br>\u00B7 ' + esc(b2)));
}
const panels =
  panel(56, comp.default || {}, '\uAE30\uBCF8 \uD328\uB110 / Default', 'panel fill \u00B7 border \u00B7 radius', 'number badge \u00B7 line icon', (P.icon && P.icon.color))
  + panel(556, comp.alt || {}, '\uB300\uCCB4 \uCE74\uB4DC / Alt', 'alternate surface', 'contrast variant', (comp.alt && comp.alt.badge))
  + panel(1056, comp.warn || {}, '\uACBD\uACE0 / Warning', 'caution / danger role', 'accent border', (P.icon && (P.icon.dangerColor || P.icon.warnColor)));

// ---- step strip ----------------------------------------------------------
const acc = P.accent || {};
const stepStyle = acc.stepStyle || 'numeral';
const stepLabels = ['\uD655\uC778', '\uC608\uC5F4', '\uAC10\uC2DC', '\uC870\uCE58'];
const n = 4, x0 = 150, x1 = W - 150, gap = (x1 - x0) / (n - 1), stepY = 690;
let steps = '';
for (let i = 0; i < n; i++) {
  const cx = x0 + gap * i;
  if (i < n - 1) {
    // connector
    const connColor = isDark ? (pal.panelBorder || '#27496A') : (pal.panelBorder || '#DCE5EE');
    steps += box(cx + 34, stepY + 24, gap - 68, 2, `background:${connColor};`);
  }
  if (stepStyle === 'circle-fill') {
    steps += box(cx - 26, stepY, 52, 52, `background:${acc.stepNumberColor || pal.navy};border-radius:50%;`,
      txt(0, 12, `width:52px;text-align:center;font:800 24px ${typo.family};color:#fff`, String(i + 1)));
  } else {
    steps += txt(cx - 18, stepY - 6, `font:800 56px ${typo.family};color:${acc.stepNumberColor || pal.info}`, String(i + 1));
  }
  steps += txt(cx - 60, stepY + 60, `width:120px;text-align:center;font:600 16px ${typo.family};color:${isDark ? pal.inkMuted : pal.inkMuted}`, esc(stepLabels[i]));
}

// ---- palette swatches ----------------------------------------------------
const swatchKeys = isDark
  ? [['info', 'info'], ['gold', 'gold'], ['danger', 'danger'], ['ok', 'ok'], ['ink', 'ink'], ['panelBorder', 'border']]
  : [['navy', 'navy'], ['blue', 'blue'], ['teal', 'teal'], ['orange', 'orange'], ['ink', 'ink'], ['panelBorder', 'border']];
let swatches = txt(56, 800, `font:700 15px ${typo.family};color:${pal.inkMuted};letter-spacing:1px`, 'PALETTE');
swatchKeys.forEach((k, i) => {
  const x = 56 + i * 168;
  const c = pal[k[0]] || '#888';
  swatches += box(x, 820, 150, 40, `background:${c};border-radius:6px;border:1px solid rgba(127,127,127,0.25)`);
  swatches += txt(x, 862, `font:500 13px ${typo.family};color:${pal.inkMuted}`, `${esc(k[1])} ${esc(c)}`);
});

// ---- footer --------------------------------------------------------------
const ft = P.footer || {};
const footTop = H - 38;
let footer = box(0, footTop, W, 1, `background:${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(14,42,75,0.10)'};`);
footer += txt(44, footTop + 9, `font:600 14px ${typo.family};color:${ft.ink || pal.inkMuted}`,
  '\u2693 IBC Code \uBC0F Chemical Tanker \u00B7 \uAD50\uC721\uC6A9 \u00B7 \uCD5C\uC2E0 \uADDC\uC815 \uC6B0\uC120 \uD655\uC778');
if (ft.tag) {
  footer += box(W - 120, footTop + 4, 80, 28, `background:${pal.info || pal.teal || '#33A9E0'};border-radius:6px;`,
    txt(0, 5, `width:80px;text-align:center;font:700 14px ${typo.family};color:#fff`, '38-02'));
}

// ---- assemble ------------------------------------------------------------
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0}
  *{box-sizing:border-box}
  body{font-family:${typo.family}}
</style></head><body>
<div style="position:relative;width:${px(W)};height:${px(H)};overflow:hidden;${bg}">
${deco}
${headerHtml}
${titleBlock}
${panels}
${steps}
${swatches}
${footer}
</div>
</body></html>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, `(${W}x${H}, ${P.id})`);
