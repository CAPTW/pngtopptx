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
const cp = require('child_process');

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

function fontSearchLocations(){
  const locations = [];
  const add = (dir, scope, source) => {
    if(!dir) return;
    const resolved = path.resolve(dir);
    if(!locations.some(item => item.path.toLowerCase() === resolved.toLowerCase())){
      locations.push({ path:resolved, scope, source });
    }
  };
  if(process.platform === 'win32'){
    const winDir = process.env.WINDIR || 'C:\\Windows';
    add(path.join(winDir, 'Fonts'), 'system', 'windows-font-directory');
    add(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts'), 'user', 'windows-user-font-directory');
    add(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Fonts'), 'user', 'windows-roaming-font-directory');
  } else if(process.platform === 'darwin'){
    add('/System/Library/Fonts', 'system', 'macos-system-font-directory');
    add('/Library/Fonts', 'system', 'macos-library-font-directory');
    add(path.join(os.homedir(), 'Library/Fonts'), 'user', 'macos-user-font-directory');
  } else {
    add('/usr/share/fonts', 'system', 'linux-system-font-directory');
    add('/usr/local/share/fonts', 'system', 'linux-local-font-directory');
    add(path.join(os.homedir(), '.fonts'), 'user', 'linux-user-font-directory');
    add(path.join(os.homedir(), '.local/share/fonts'), 'user', 'linux-user-data-font-directory');
  }
  for(const extra of String(process.env.DECK_FONT_DIRS || '').split(path.delimiter).map(v => v.trim()).filter(Boolean)){
    add(extra, 'explicit', 'DECK_FONT_DIRS');
  }
  return locations;
}

function fontSearchDirs(){
  return fontSearchLocations().map(item => item.path);
}

const FONT_FILE_HINTS = {
  arial: ['arial.ttf', 'arialbd.ttf'],
  aptos: ['aptos.ttf', 'aptosdisplay.ttf', 'aptosbody.ttf'],
  'malgun gothic': ['malgun.ttf', 'malgunbd.ttf'],
  pretendard: ['pretendard-regular.otf', 'pretendardvariable.ttf', 'pretendardvariable.woff2'],
  'noto sans cjk kr': ['notosanscjk-regular.ttc', 'notosanscjkkR-regular.otf'],
};

function normalizeFamilyKey(value){
  return String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function compactFamilyKey(value){
  return normalizeFamilyKey(value).replace(/[^a-z0-9\u00c0-\uffff]/g, '');
}

function cleanRegistryFamily(value){
  return String(value || '')
    .replace(/\s+\((?:TrueType|OpenType|All res|Raster)\)\s*$/i, '')
    .trim();
}

function windowsRegistryFonts(){
  if(process.platform !== 'win32') return [];
  const keys = [
    { key:'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', scope:'system' },
    { key:'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', scope:'user' },
  ];
  const rows = [];
  for(const item of keys){
    let text = '';
    try {
      text = cp.execFileSync('reg.exe', ['query', item.key], { encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','ignore'] });
    } catch(err){ continue; }
    for(const line of String(text).split(/\r?\n/)){
      const match = /^\s{2,}(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/.exec(line);
      if(!match) continue;
      const displayName = cleanRegistryFamily(match[1]);
      const families = displayName.split(/\s*&\s*/).map(v => v.trim()).filter(Boolean);
      for(const family of families){
        rows.push({ family, displayName, file:match[2].trim(), scope:item.scope, source:'windows-font-registry', registryKey:item.key });
      }
    }
  }
  return rows;
}

let FONT_INDEX_CACHE = null;
function buildFontIndex(){
  if(FONT_INDEX_CACHE) return FONT_INDEX_CACHE;
  const files = [];
  const searchedLocations = [];
  for(const location of fontSearchLocations()){
    const record = Object.assign({}, location, { exists:false, fileCount:0 });
    let entries = [];
    try {
      entries = fs.readdirSync(location.path, { withFileTypes:true });
      record.exists = true;
    } catch(err){
      record.error = err.code || err.message;
    }
    for(const entry of entries){
      if(!entry.isFile() || !/\.(?:ttf|ttc|otf|woff2?)$/i.test(entry.name)) continue;
      files.push({ name:entry.name, path:path.join(location.path, entry.name), scope:location.scope, source:location.source });
    }
    record.fileCount = files.filter(file => file.path.toLowerCase().startsWith(location.path.toLowerCase())).length;
    searchedLocations.push(record);
  }
  FONT_INDEX_CACHE = {
    builtAt:new Date().toISOString(),
    searchedLocations,
    registry:windowsRegistryFonts(),
    files,
  };
  return FONT_INDEX_CACHE;
}

function resetFontIndexCache(){ FONT_INDEX_CACHE = null; }

function fontAvailabilityEvidence(family){
  const name = String(family || '').trim();
  if(!name || isGenericFontFamily(name)){
    return { family:name, available:true, generic:true, matches:[], searchedLocations:fontSearchLocations() };
  }
  const normalized = normalizeFamilyKey(name);
  const compact = compactFamilyKey(name);
  const hints = FONT_FILE_HINTS[normalized] || [];
  const index = buildFontIndex();
  const matches = [];
  for(const row of index.registry){
    if(normalizeFamilyKey(row.family) === normalized || normalizeFamilyKey(row.displayName) === normalized){
      matches.push(Object.assign({ match:'registry-family-exact' }, row));
    }
  }
  for(const file of index.files){
    const lower = file.name.toLowerCase();
    const fileCompact = compactFamilyKey(path.basename(file.name, path.extname(file.name)));
    if(hints.some(hint => lower === hint.toLowerCase())){
      matches.push(Object.assign({ match:'known-file-hint' }, file));
    } else if(compact && (fileCompact === compact || fileCompact.startsWith(compact))){
      matches.push(Object.assign({ match:'filename-family-prefix' }, file));
    }
  }
  const unique = [];
  const seen = new Set();
  for(const match of matches){
    const key = `${match.source}|${match.path || match.file || ''}|${match.family || ''}`.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  return {
    family:name,
    available:unique.length > 0,
    generic:false,
    scopes:Array.from(new Set(unique.map(match => match.scope).filter(Boolean))),
    matches:unique.slice(0, 24),
    searchedLocations:index.searchedLocations,
    registryRowsScanned:index.registry.length,
    fontFilesScanned:index.files.length,
  };
}

function fontAvailable(family){
  return fontAvailabilityEvidence(family).available;
}

function compactFontEvidence(evidence){
  return {
    family:evidence.family,
    available:!!evidence.available,
    generic:!!evidence.generic,
    scopes:evidence.scopes || [],
    matches:(evidence.matches || []).slice(0, 8),
    registryRowsScanned:evidence.registryRowsScanned || 0,
    fontFilesScanned:evidence.fontFilesScanned || 0,
  };
}

function fontListFromEnv(name){
  return splitFontFamilies(process.env[name] || '');
}

const FONT_INSTALL_DECISIONS = new Set(['ask', 'approved', 'declined', 'unavailable', 'installed']);

function fontInstallDecision(){
  const value = String(process.env.DECK_FONT_INSTALL_DECISION || 'ask').trim().toLowerCase();
  if(!FONT_INSTALL_DECISIONS.has(value)){
    throw new Error(`Invalid DECK_FONT_INSTALL_DECISION "${value}". Expected ask, approved, declined, unavailable, or installed.`);
  }
  return value;
}

function approvalRequiredError(original){
  const err = new Error(`FONT_INSTALL_APPROVAL_REQUIRED: Original font "${original}" is not installed. Automatic installation is forbidden. Ask the user whether to install it; if installation is declined or unavailable, rerun with DECK_FONT_INSTALL_DECISION=declined or unavailable so conversion can continue with an explicit fallback mapping.`);
  err.code = 'FONT_INSTALL_APPROVAL_REQUIRED';
  err.originalFont = original;
  return err;
}

function resolveFontMapping(original, options={}){
  const requested = String(original || '').trim() || DEFAULT_FONT;
  const decision = options.installDecision || fontInstallDecision();
  const requestedEvidence = fontAvailabilityEvidence(requested);
  if(requestedEvidence.available){
    return {
      original:requested,
      resolved:requested,
      exact:true,
      fallbackApplied:false,
      status:'exact',
      approvalRequired:false,
      installDecision:decision,
      automaticInstallationAttempted:false,
      evidence:compactFontEvidence(requestedEvidence),
    };
  }

  if(decision === 'ask' || decision === 'approved'){
    const pending = {
      original:requested,
      resolved:null,
      exact:false,
      fallbackApplied:false,
      status:'approval-required',
      approvalRequired:true,
      installDecision:decision,
      automaticInstallationAttempted:false,
      evidence:compactFontEvidence(requestedEvidence),
      nextAction:decision === 'approved'
        ? 'Install the font outside this workflow, then rerun. If installation cannot be completed, rerun with decision unavailable.'
        : 'Ask the user whether to install the font. Do not install automatically.',
    };
    if(options.allowPending) return pending;
    throw approvalRequiredError(requested);
  }

  const candidates = Array.from(new Set((options.fallbackCandidates || []).concat(FONT_FALLBACKS).map(v => String(v || '').trim()).filter(v => v && normalizeFamilyKey(v) !== normalizeFamilyKey(requested))));
  let resolved = null;
  let resolvedEvidence = null;
  for(const candidate of candidates){
    const evidence = fontAvailabilityEvidence(candidate);
    if(evidence.available){ resolved = candidate; resolvedEvidence = evidence; break; }
  }
  if(!resolved){
    resolved = candidates[0] || FONT_FALLBACKS[0];
    resolvedEvidence = fontAvailabilityEvidence(resolved);
  }
  return {
    original:requested,
    resolved,
    exact:false,
    fallbackApplied:true,
    status:'fallback',
    approvalRequired:false,
    installDecision:decision,
    automaticInstallationAttempted:false,
    fallbackReason:decision === 'declined'
      ? 'User declined font installation; conversion continues with fallback.'
      : decision === 'installed'
        ? 'User reported installation, but the original font was still not detected; conversion continues with fallback.'
        : 'Font installation is unavailable; conversion continues with fallback.',
    evidence:compactFontEvidence(requestedEvidence),
    resolvedEvidence:compactFontEvidence(resolvedEvidence),
  };
}

function resolveFontPolicy(profile, options={}){
  const profileFamilies = splitFontFamilies(profile && profile.typography && profile.typography.family);
  const requested = (process.env.DECK_FONT || profileFamilies.find(f => !isGenericFontFamily(f)) || DEFAULT_FONT).trim();
  const envFallbacks = fontListFromEnv('DECK_FONT_FALLBACK');
  const candidates = [
    requested,
    ...envFallbacks,
    ...FONT_FALLBACKS,
    ...profileFamilies.filter(f => !isGenericFontFamily(f)),
  ].filter(Boolean);
  const checked = Object.fromEntries(candidates.map(candidate => [candidate, fontAvailable(candidate)]));
  const mapping = resolveFontMapping(requested, {
    allowPending:!!options.allowPending,
    installDecision:options.installDecision,
    fallbackCandidates:candidates.slice(1),
  });
  const resolved = mapping.resolved;
  const fallbackApplied = !!mapping.fallbackApplied;
  const generic = profileFamilies.filter(isGenericFontFamily);
  const htmlFamilies = Array.from(new Set([resolved, ...candidates.filter(f => f !== resolved && checked[f]), ...generic, 'sans-serif'].filter(Boolean)));
  return {
    schemaVersion: 'slide-image-dual-render.font-policy.v2',
    original:requested,
    requested,
    resolved,
    fallbackApplied,
    fallbackReason:mapping.fallbackReason || null,
    status:mapping.approvalRequired ? 'USER_DECISION_REQUIRED' : 'PASS',
    approvalRequired:!!mapping.approvalRequired,
    installDecision:mapping.installDecision,
    installPolicy:'ask-user-before-install; automatic-installation-forbidden',
    automaticInstallationAttempted:false,
    conversionPolicy:'exact-if-installed; fallback-after-user-decline-or-install-unavailable; never-stop-after-decision',
    strict:false,
    legacyStrictIgnored:process.env.DECK_FONT_STRICT === '1',
    checked,
    htmlCssFamily: htmlFamilies.map(cssFontFamily).join(', '),
    webFontImportsEnabled: false,
    webFontPolicy: 'disabled-for-pptx-html-parity',
    mappings:[mapping],
    search: {
      systemAndUserFontsScanned:true,
      locations:buildFontIndex().searchedLocations,
      registryRowsScanned:buildFontIndex().registry.length,
      fontFilesScanned:buildFontIndex().files.length,
    },
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
  loadProfile, paletteC, fontOf, resolveFontPolicy, resolveFontMapping,
  fontAvailable, fontAvailabilityEvidence, fontSearchDirs, fontSearchLocations,
  fontInstallDecision, approvalRequiredError, resetFontIndexCache,
  bgType, isDarkProfile, isLightProfile,
  DEFAULT_C, DEFAULT_FONT,
  _helpers: { strip, isHex, toRgb, toHex, mix, lighten, darken, parseColor, solidOver, pick, splitFontFamilies, cssFontFamily, normalizeFamilyKey, compactFamilyKey },
};
