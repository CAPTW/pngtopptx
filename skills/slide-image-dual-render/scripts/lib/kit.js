// ============================================================
//  kit.js — backend-agnostic palette + primitives
//  Every primitive draws onto a "surface" object `s` that
//  exposes unified atoms in SOURCE-PX coords:
//    s.bgFill(hex)
//    s.img(absPath, x,y,w,h)
//    s.rrect(x,y,w,h,{fill,fillTrans,line,lineW,radius,shadow})
//    s.ell(x,y,w,h,{fill,line,lineW})
//    s.chev(x,y,w,h,{fill,fillTrans,line,lineW})
//    s.ln(x,y,w,h,{color,width,dash})
//    s.txt(content,x,y,w,h,{sz(pt),color,bold,italic,align,valign,lh,cs,wrap,shrink,margin})
//        content = string ("\n" => line break) | [{text,bold,italic,color,breakLine}]
// ============================================================
const path = require('path');
const fs = require('fs');

// Source-pixel canvas = the resolution of your source slide images.
// 16:9 at 1672x941 is the default; override via env if your images differ.
const PXW = +(process.env.DECK_PXW || 1672), PXH = +(process.env.DECK_PXH || 941);
// Per-job generated assets (icons/, bg.png, crops, manifest.json) live here.
// Point DECK_ASSETS at your working asset dir; defaults to ../assets next to scripts/.
const ASSET = process.env.DECK_ASSETS || path.join(__dirname, '..', 'assets');
const ICON = path.join(ASSET, 'icons');
const _manPath = path.join(ASSET, 'manifest.json');
const MAN = fs.existsSync(_manPath) ? JSON.parse(fs.readFileSync(_manPath, 'utf8')) : {};

// palette + requested font now come from the active style PROFILE (DECK_PROFILE).
// With no DECK_PROFILE set, paletteC() returns the original hard-coded design
// system. The final font is resolved through a local-font parity policy so PPTX
// and HTML do not silently use different metrics.
// Keys of C are identical to the former literal, so no helper below has to change.
const { loadProfile, paletteC, resolveFontPolicy } = require('./profile');
const PROFILE = loadProfile();
const C = paletteC(PROFILE);
const FONT_POLICY = resolveFontPolicy(PROFILE);
const FONT = FONT_POLICY.resolved;

// ---- atomic-ish wrappers ----
function bg(s){ s.bgFill(C.bg); s.img(path.join(ASSET,'bg.png'), 0,0, PXW,PXH); }

function crop(s, name){
  const m = MAN[name]; if(!m){ console.log('!! missing crop', name); return; }
  s.img(path.join(ASSET, name+'.png'), m.x, m.y, m.w, m.h);
}
function imageAt(s, name, x,y,w,h){ s.img(path.join(ASSET, name+'.png'), x,y,w,h); }

function panel(s, x,y,w,h, o={}){
  s.rrect(x,y,w,h, {
    fill:o.fill||C.panel, fillTrans:o.trans!=null?o.trans:14,
    line:o.line||C.line, lineW:o.lw||1,
    radius:o.r!=null?o.r:9, shadow:!!o.shadow,
  });
}
function rline(s, x,y,w, color){ s.ln(x,y,w,0, {color:color||C.line, width:1}); }

function T(s, content, x,y,w,h, o={}){
  s.txt(content, x,y,w,h, {
    sz:o.sz||12, color:o.color||C.white, bold:!!o.b, italic:!!o.i,
    align:o.align||'left', valign:o.valign||'middle',
    lh:o.lh!=null?o.lh:1.0, cs:o.cs, wrap:o.wrap!=null?o.wrap:true,
    shrink:o.shrink, margin:o.margin!=null?o.margin:0,
  });
}

function badge(s, label, x,y, d, o={}){
  s.ell(x,y,d,d, { fill:o.fill||C.badge, line:o.line||(o.fill||C.badge), lineW:1 });
  s.txt(String(label), x,y,d,d, {
    sz:o.sz||Math.round(d*0.34), bold:true, color:o.color||'FFFFFF',
    align:'center', valign:'middle', margin:0, lh:1.0,
  });
}

function icon(s, concept, color, x,y, d){
  const f = path.join(ICON, `${concept}_${color}.png`);
  if(!fs.existsSync(f)){ console.log('!! missing icon', concept, color); return; }
  s.img(f, x,y,d,d);
}

function footer(s, text){
  icon(s,'warn','gold', 452, 901, 22);
  T(s, text || (process.env.DECK_FOOTER || ''),
    480, 898, 1180, 28, { sz:12.5, color:C.goldDim, align:'left', wrap:false });
}

// Header eyebrow / part-tag / title-prefix. Set once via env (DECK_EYEBROW,
// DECK_TAG, DECK_PREFIX) or override per call with the 4th opts arg. Any field
// left empty is simply omitted, so a clean title-only header just works.
const HEAD = {
  eyebrow: process.env.DECK_EYEBROW || '',
  tag:     process.env.DECK_TAG || '',
  prefix:  process.env.DECK_PREFIX || '',
};
function head(s, title, sub, o={}){
  const eyebrow = o.eyebrow!=null ? o.eyebrow : HEAD.eyebrow;
  const tag     = o.tag!=null     ? o.tag     : HEAD.tag;
  const prefix  = o.prefix!=null  ? o.prefix  : HEAD.prefix;
  if(eyebrow) T(s, eyebrow, 30, 10, 1000, 26, { sz:13, color:C.eyebrow });
  if(tag){
    const tw = o.tagW || 238;
    s.rrect(28,52,tw,38, { fill:C.tagFill, fillTrans:6, line:C.cyan, lineW:1.25, radius:6 });
    T(s, tag, 28, 52, tw, 38, { sz:14, b:true, color:C.white, align:'center', wrap:false, shrink:true });
  }
  const runs = prefix
    ? [{ text:prefix, bold:true, color:C.white }, { text:'  '+title, bold:true, color:C.white }]
    : [{ text:title, bold:true, color:C.white }];
  s.txt(runs, 34, 98, 1130, 74, { sz:o.sz||39, align:'left', valign:'middle', margin:0, wrap:true, shrink:true });
  T(s, sub, 38, 168, 1150, 30, { sz:17.5, color:C.cyan, wrap:false, shrink:true });
}

// gold emphasis banner with shield icons. text = string | runs[]
function banner(s, text, y, o={}){
  const x=28, w=1616, h=o.h||58;
  s.rrect(x,y,w,h, { fill:C.bannerFill, fillTrans:12, line:C.gold, lineW:1.6, radius:13 });
  icon(s, o.icon||'shieldcheck', 'gold', x+22, y+(h-34)/2, 34);
  icon(s, o.icon2||'chartline', 'gold', x+w-58, y+(h-34)/2, 34);
  s.txt(text, x+60, y, w-120, h, { sz:o.sz||23, bold:true, color:o.color||C.gold, align:'center', valign:'middle', margin:0, wrap:true, shrink:true });
}

// chevron roadmap. steps:[{label,icon,num?,danger?,gold?}], active idx, lead {l1,l2,icon}|null
function chevronBar(s, steps, active, y, lead){
  const x0=20, x1=1652, h=52;
  let cx = x0;
  if(lead){
    const lw=150;
    s.rrect(cx,y,lw,h, { fill:C.leadFill, fillTrans:6, line:C.cyan, lineW:1.1, radius:9 });
    icon(s, lead.icon||'helm','cyan', cx+10, y+(h-30)/2, 30);
    T(s, lead.l1+'\n'+lead.l2, cx+42, y, lw-46, h, { sz:11, b:true, color:C.white, lh:0.95, valign:'middle' });
    cx += lw + 6;
  }
  const n = steps.length;
  const totalW = x1 - cx;
  const cw = totalW / n;
  const overlap = 14;
  steps.forEach((st, i) => {
    const sx = cx + i*cw;
    const fill = st.gold ? C.chevGoldFill : (i===active ? C.chevOn : (st.danger ? C.chevDangerFill : C.chevOff));
    const lc = st.gold ? C.gold : (i===active ? C.cyan : (st.danger ? C.red : C.chevLine));
    s.chev(sx, y, cw+overlap, h, {
      fill, fillTrans:(i===active||st.gold||st.danger)?2:18, line:lc, lineW:(i===active||st.gold)?1.5:1,
    });
    let inx = sx + 16;
    const iconColor = st.danger ? 'red' : (st.gold ? 'gold' : (i===active ? 'cyan' : 'lblue'));
    if(st.num!=null){
      badge(s, st.num, sx+12, y+(h-26)/2, 26, { fill: st.danger?C.badgeRed:C.badge, sz:12 });
      inx = sx + 44;
    } else if(st.icon){
      icon(s, st.icon, iconColor, sx+14, y+(h-28)/2, 28);
      inx = sx + 48;
    }
    const tcol = st.danger ? C.red : (st.gold ? C.gold : (i===active ? C.white : C.chevTextOn));
    T(s, st.label, inx, y, (cw+overlap)-(inx-sx)-14, h, { sz: st.label.length>5?10:11, b:(i===active||st.gold), color:tcol, valign:'middle', lh:0.95 });
  });
}

// rows:[{ic,color,en,title,tcolor,sub}]
function iconRows(s, rows, x, y, w, rowH, o={}){
  rows.forEach((r,i)=>{
    const ry = y + i*rowH;
    if(r.ic) icon(s, r.ic, r.color||'lblue', x, ry+(o.iconDy!=null?o.iconDy:3), o.iconD||32);
    const tx = x + (o.textDx||44);
    s.txt([
      ...(r.en?[{text:r.en+'  ', color:r.tcolor||C.white, bold:true}]:[]),
      {text:r.title, color:r.tcolor||(r.en?C.sub:C.white), bold:!r.en},
    ], tx, ry-2, w-(o.textDx||44), 22, { sz:o.tsz||13, align:'left', valign:'middle', margin:0, wrap:true });
    if(r.sub) T(s, r.sub, tx, ry+(o.subDy!=null?o.subDy:20), w-(o.textDx||44), rowH-20, { sz:o.ssz||10.5, color:C.sub, lh:0.95 });
  });
}

// rows:[{ic,label,bullets:[]}]
function detailRows(s, rows, x, y, w, rowH, o={}){
  rows.forEach((r,i)=>{
    const ry=y+i*rowH;
    if(r.ic) icon(s, r.ic, o.icColor||'lblue', x, ry+3, 22);
    T(s, r.label, x+30, ry, (o.bx||132)-30, rowH, { sz:o.lsz||10.5, b:true, color:C.steel, valign:'top', lh:0.95 });
    T(s, r.bullets.map(b=>'· '+b).join('\n'), x+(o.bx||132), ry-2, w-(o.bx||132), rowH, { sz:o.bsz||9.5, color:C.sub, lh:1.0 });
    if(i<rows.length-1) rline(s, x, ry+rowH-3, w, C.rline);
  });
}

module.exports = {
  PXW, PXH, ASSET, ICON, MAN, C, FONT, FONT_POLICY,
  bg, crop, imageAt, panel, rline, T, badge, icon, footer, head, banner, chevronBar, iconRows, detailRows,
};
