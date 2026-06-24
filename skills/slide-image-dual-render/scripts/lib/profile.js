// ============================================================
//  profile.js — load a style PROFILE (../styles/*.json) and map it
//  onto the renderer's design tokens (the kit `C` palette + FONT).
//
//  Contract:
//   - DECK_PROFILE unset  -> returns the ORIGINAL hard-coded design
//     system byte-for-byte, so existing decks render UNCHANGED.
//   - DECK_PROFILE=<path> -> every token is sourced from that profile,
//     so a classified style drives BOTH the PPTX and the HTML output.
//
//  Keys of the returned palette are IDENTICAL to the renderer's former
//  `C` literal, so no kit helper has to change shape — only the values
//  move with the profile.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- original hard-coded design system (backward-compatible default) -------
const DEFAULT_C = {
  bg:'020812', panel:'0B1B2D', panelHi:'10263C', line:'2A4A6E', lineHi:'3D6390',
  white:'F2F7FC', sub:'AEC4DA', gold:'E9B84A', goldDim:'C9A24A',
  cyan:'3BC4ED', badge:'1F6FB5', badgeRed:'C13A33', red:'D8453B',
  green:'3FB950', chevOn:'1E6FB0', chevOff:'0C1C30', chevLine:'2C547E',
  orange:'E08A3C', steel:'7FB6E6',
  // extra keys that absorb former in-helper literals (kit.js routes through these):
  eyebrow:'C7D6E6', tagFill:'0C2236', leadFill:'0C2236', bannerFill:'0E1A14',
  chevGoldFill:'2A2410', chevDangerFill:'2A0F0E', chevTextOn:'D7E6F4', rline:'1C3349',
};
const DEFAULT_FONT = 'Pretendard';
const FONT_FALLBACKS = ['Arial', 'Aptos', 'Malgun Gothic'];
const GENERIC_FONT_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji',
  'math', 'fangsong',
]);

function splitFontFamilies(value){
  const text = String(value || '').trim();
  if(!text) return [];
  const families = [];
  let current = '';
  let quote = null;
  for(const ch of text){
    if((ch === '"' || ch === "'") && !quote){ quote = ch; continue; }
    if(ch === quote){ quote = null; continue; }
    if(ch === ',' && !quote){
      const family = current.trim();
      if(family) families.push(family);
      current = '';
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if(last) families.push(last);
  return families.map(f => f.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
}

function isGenericFontFamily(family){
  return GENERIC_FONT_FAMILIES.has(String(family || '').trim().toLowerCase());
}

function cssFontFamily(family){
  const value = String(family || '').trim();
  if(!value) return '';
  if(isGenericFontFamily(value)) return value;
  if(/^[A-Za-z0-9_-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "\\'")}'`;
}

function fontSearchDirs(){
  const dirs = [];
  if(process.platform === 'win32'){
    const winDir = process.env.WINDIR || 'C:\\Windows';
    dirs.push(path.join(winDir, 'Fonts'));
  } else if(process.platform === 'darwin'){
    dirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts'));
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts'));
  }
  return dirs;
}

const FONT_FILE_HINTS = {
  arial: ['arial.ttf', 'arialbd.ttf'],
  aptos: ['aptos.ttf', 'aptosdisplay.ttf', 'aptosbody.ttf'],
  'malgun gothic': ['malgun.ttf', 'malgunbd.ttf'],
  pretendard: ['pretendard-regular.otf', 'pretendardvariable.ttf', 'pretendardvariable.woff2'],
  'noto sans cjk kr': ['notosanscjk-regular.ttc', 'notosanscjkkR-regular.otf'],
};

function fontAvailable(family){
  const name = String(family || '').trim();
  if(!name || isGenericFontFamily(name)) return true;
  const normalized = name.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const hints = FONT_FILE_HINTS[normalized] || [];
  for(const dir of fontSearchDirs()){
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch(err){ continue; }
    const names = entries.filter(e => e.isFile()).map(e => e.name.toLowerCase());
    if(hints.some(hint => names.includes(hint.toLowerCase()))) return true;
    if(names.some(file => file.replace(/[^a-z0-9]/g, '').includes(compact))) return true;
  }
  return false;
}

function fontListFromEnv(name){
  return splitFontFamilies(process.env[name] || '');
}

function resolveFontPolicy(profile){
  const profileFamilies = splitFontFamilies(profile && profile.typography && profile.typography.family);
  const requested = (process.env.DECK_FONT || profileFamilies.find(f => !isGenericFontFamily(f)) || DEFAULT_FONT).trim();
  const envFallbacks = fontListFromEnv('DECK_FONT_FALLBACK');
  const candidates = [
    requested,
    ...envFallbacks,
    ...FONT_FALLBACKS,
    ...profileFamilies.filter(f => !isGenericFontFamily(f)),
  ].filter(Boolean);
  const checked = {};
  let resolved = null;
  for(const candidate of candidates){
    if(checked[candidate] == null) checked[candidate] = fontAvailable(candidate);
    if(checked[candidate]){
      resolved = candidate;
      break;
    }
  }
  if(!resolved && process.env.DECK_FONT_STRICT === '1'){
    throw new Error(`Requested deck font "${requested}" is not available locally. Install it for PPTX rasterization or set DECK_FONT_FALLBACK to a locally installed font.`);
  }
  if(!resolved){
    resolved = envFallbacks[0] || FONT_FALLBACKS[0];
    if(checked[resolved] == null) checked[resolved] = fontAvailable(resolved);
  }
  const fallbackApplied = resolved !== requested;
  const generic = profileFamilies.filter(isGenericFontFamily);
  const htmlFamilies = Array.from(new Set([resolved, ...candidates.filter(f => f !== resolved && checked[f]), ...generic, 'sans-serif']));
  return {
    schemaVersion: 'slide-image-dual-render.font-policy.v1',
    requested,
    resolved,
    fallbackApplied,
    fallbackReason: fallbackApplied ? `Requested font "${requested}" was not verified as locally available; using "${resolved}" for both PPTX and HTML.` : null,
    strict: process.env.DECK_FONT_STRICT === '1',
    checked,
    htmlCssFamily: htmlFamilies.map(cssFontFamily).join(', '),
    webFontImportsEnabled: false,
    webFontPolicy: 'disabled-for-pptx-html-parity',
  };
}

// ---- tiny hex helpers (all return 6-char hex, NO leading #) -----------------
function strip(h){ return String(h == null ? '' : h).replace(/^#/, '').trim(); }
function isHex(h){ return /^#?[0-9A-Fa-f]{6}$/.test(String(h == null ? '' : h).trim()); }
function toRgb(h){ h = strip(h); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
function toHex(r,g,b){ return [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('').toUpperCase(); }
function mix(a,b,t){ const A=toRgb(a), B=toRgb(b); return toHex(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t); }
function lighten(h,t){ return mix(h,'FFFFFF',t); }
function darken(h,t){ return mix(h,'000000',t); }

// parse a CSS color (hex or rgb/rgba) -> {hex, alpha} | null
function parseColor(c){
  c = String(c == null ? '' : c).trim();
  const m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if(m){ return { hex: toHex(+m[1],+m[2],+m[3]), alpha: m[4] != null ? +m[4] : 1 }; }
  if(isHex(c)) return { hex: strip(c).toUpperCase(), alpha: 1 };
  return null;
}
// composite a (possibly translucent) fill over a solid bg -> opaque hex | null
function solidOver(fill, bgHex){
  const p = parseColor(fill); if(!p) return null;
  if(p.alpha >= 0.999) return p.hex;
  const F = toRgb(p.hex), B = toRgb(bgHex);
  return toHex(B[0]+(F[0]-B[0])*p.alpha, B[1]+(F[1]-B[1])*p.alpha, B[2]+(F[2]-B[2])*p.alpha);
}
// first arg that is a usable hex (accepts #-prefixed), normalized -> no #
function pick(){ for(let i=0;i<arguments.length;i++){ const a=arguments[i]; if(a!=null && isHex(a)) return strip(a).toUpperCase(); } return null; }

function loadProfile(){
  const p = process.env.DECK_PROFILE;
  if(!p) return null;
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); }
  catch(e){ console.error('!! DECK_PROFILE not readable:', p, '-', e.message); return null; }
  try { return JSON.parse(txt); }
  catch(e){ console.error('!! DECK_PROFILE is not valid JSON:', p, '-', e.message); return null; }
}

function bgType(profile){
  return (profile && profile.dimensions && profile.dimensions.background && profile.dimensions.background.type) || '';
}
function isDarkProfile(profile){ return /dark/.test(bgType(profile)); }
function isLightProfile(profile){ return /light/.test(bgType(profile)); }

function fontOf(profile){
  return resolveFontPolicy(profile).resolved;
}

// Map a profile -> the kit `C` palette (same keys as DEFAULT_C).
function paletteC(profile){
  if(!profile) return Object.assign({}, DEFAULT_C);
  const pal  = profile.palette || {};
  const comp = profile.components || {};
  const d = comp.default || {}, warn = comp.warn || {};
  const acc = profile.accent || {}, ic = profile.icon || {};
  const dark = isDarkProfile(profile);

  const bg     = pick(pal.bg) || DEFAULT_C.bg;
  const line   = pick(pal.panelBorder) || DEFAULT_C.line;
  const white  = pick(pal.ink) || DEFAULT_C.white;
  const sub    = pick(pal.inkMuted) || DEFAULT_C.sub;
  const gold   = pick(pal.gold, pal.orange, ic.warnColor) || DEFAULT_C.gold;
  const cyan   = pick(pal.info, pal.teal, pal.blue) || DEFAULT_C.cyan;
  const red    = pick(pal.danger, ic.dangerColor) || DEFAULT_C.red;
  const green  = pick(pal.ok) || DEFAULT_C.green;
  const orange = pick(pal.orange, pal.gold) || DEFAULT_C.orange;
  const steel  = pick(pal.blue, pal.info, pal.inkMuted) || DEFAULT_C.steel;
  const badge  = pick(d.badge, pal.info, pal.navy, pal.blue) || DEFAULT_C.badge;
  const badgeRed = pick(warn.badge, pal.danger) || DEFAULT_C.badgeRed;
  const panel  = solidOver(d.fill || pal.panelFill || ('#'+DEFAULT_C.panel), '#'+bg) || DEFAULT_C.panel;
  const chevOn = pick(acc.stepNumberColor, d.badge, pal.info) || DEFAULT_C.chevOn;

  return {
    bg, panel,
    panelHi: dark ? lighten(panel, 0.06) : darken(panel, 0.04),
    line,
    lineHi: lighten(line, 0.12),
    white, sub, gold,
    goldDim: darken(gold, 0.14),
    cyan, badge, badgeRed, red, green,
    chevOn,
    chevOff: dark ? mix(bg, panel, 0.55) : mix(bg, line, 0.10),
    chevLine: line,
    orange, steel,
    // absorbed in-helper literals — derived defaults keep dark output faithful,
    // and a profile may override any of them by adding the matching key.
    eyebrow:        pick(acc.eyebrowColor) || mix(white, cyan, 0.35),
    tagFill:        dark ? darken(badge, 0.55) : lighten(badge, 0.85),
    leadFill:       dark ? darken(cyan, 0.55)  : lighten(cyan, 0.85),
    bannerFill:     dark ? darken(gold, 0.78)  : lighten(gold, 0.86),
    chevGoldFill:   dark ? darken(gold, 0.70)  : lighten(gold, 0.82),
    chevDangerFill: dark ? darken(red, 0.74)   : lighten(red, 0.86),
    chevTextOn:     dark ? mix(white, cyan, 0.15) : white,
    rline:          dark ? mix(bg, line, 0.5)  : line,
  };
}

module.exports = {
  loadProfile, paletteC, fontOf, resolveFontPolicy, fontAvailable,
  bgType, isDarkProfile, isLightProfile,
  DEFAULT_C, DEFAULT_FONT,
  _helpers: { strip, isHex, toRgb, toHex, mix, lighten, darken, parseColor, solidOver, pick, splitFontFamilies, cssFontFamily },
};
