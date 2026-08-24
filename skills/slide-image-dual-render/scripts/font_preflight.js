#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadProfile,
  resolveFontPolicy,
  resolveFontMapping,
  fontInstallDecision,
  _helpers,
} = require('./lib/profile');

function parseArgs(argv){
  const args = {};
  for(let i=0; i<argv.length; i += 1){
    const arg = argv[i];
    const next = () => {
      if(i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      i += 1;
      return argv[i];
    };
    if(arg === '--project') args.project = next();
    else if(arg === '--font-usage') args.fontUsage = next();
    else if(arg === '--manifest') args.manifest = next();
    else if(arg === '--install-request') args.installRequest = next();
    else if(arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function usage(){
  console.log(`font_preflight.js - collect and resolve original fonts before conversion

Usage:
  node scripts/font_preflight.js --project <deck> [--font-usage work/font_usage.json]

The resolver scans system and user font locations. It never installs fonts.
Missing fonts create an approval request and exit code 3 until the user decides.
After a declined or unavailable decision, conversion continues with fallback mappings.`);
}

function resolveFrom(root, value, fallback){
  const raw = value || fallback;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

function readJson(file){
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value){
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function sourceRecord(source, detail, extra={}){
  return Object.assign({ source, detail }, extra);
}

function collectFonts(projectRoot, profile, usagePath){
  const byKey = new Map();
  const add = (value, provenance) => {
    for(const family of _helpers.splitFontFamilies(value)){
      if(!family || _helpers.normalizeFamilyKey(family) === 'sans-serif' || _helpers.normalizeFamilyKey(family) === 'serif') continue;
      const key = _helpers.normalizeFamilyKey(family);
      if(!byKey.has(key)) byKey.set(key, { original:family, sources:[] });
      const row = byKey.get(key);
      const encoded = JSON.stringify(provenance);
      if(!row.sources.some(item => JSON.stringify(item) === encoded)) row.sources.push(provenance);
    }
  };

  if(process.env.DECK_FONT) add(process.env.DECK_FONT, sourceRecord('environment', 'DECK_FONT'));
  if(profile && profile.typography && profile.typography.family){
    add(profile.typography.family, sourceRecord('profile', 'typography.family', { path:process.env.DECK_PROFILE || null }));
  }

  const slidesJs = path.resolve(process.env.SLIDES_JS || path.join(projectRoot, 'lib', 'slides.js'));
  if(fs.existsSync(slidesJs)){
    const source = fs.readFileSync(slidesJs, 'utf8');
    const regex = /\b(?:fontFace|fontFamily)\s*:\s*(['"])(.*?)\1/g;
    let match;
    while((match = regex.exec(source))){
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      add(match[2], sourceRecord('slides-js', 'fontFace/fontFamily literal', { path:slidesJs, line }));
    }
  }

  const usageFiles = [];
  if(usagePath) usageFiles.push(usagePath);
  const defaultUsage = path.join(projectRoot, 'work', 'font_usage.json');
  if(!usageFiles.some(file => path.resolve(file).toLowerCase() === defaultUsage.toLowerCase())) usageFiles.push(defaultUsage);
  const workDir = path.join(projectRoot, 'work');
  if(fs.existsSync(workDir)){
    for(const entry of fs.readdirSync(workDir, { withFileTypes:true })){
      if(entry.isDirectory() && /^slide\d+$/i.test(entry.name)) usageFiles.push(path.join(workDir, entry.name, 'font_usage.json'));
    }
  }

  const fontKeys = new Set(['fontface', 'fontfamily', 'font_name', 'fontname', 'typeface', 'originalfont', 'original_font']);
  const walk = (value, provenance, parents=[]) => {
    if(Array.isArray(value)){
      value.forEach((item, index) => walk(item, provenance, parents.concat(String(index))));
      return;
    }
    if(!value || typeof value !== 'object') return;
    for(const [key, child] of Object.entries(value)){
      const lower = key.toLowerCase();
      const parent = parents.length ? parents[parents.length - 1].toLowerCase() : '';
      const isFontName = fontKeys.has(lower) || (lower === 'name' && parent === 'font');
      if(isFontName && typeof child === 'string'){
        add(child, Object.assign({}, provenance, { jsonPath:parents.concat(key).join('.') }));
      } else {
        walk(child, provenance, parents.concat(key));
      }
    }
  };

  const seenFiles = new Set();
  for(const candidate of usageFiles){
    const file = path.resolve(candidate);
    const key = file.toLowerCase();
    if(seenFiles.has(key) || !fs.existsSync(file)) continue;
    seenFiles.add(key);
    walk(readJson(file), sourceRecord('font-usage-manifest', 'explicit original font inventory', { path:file }));
  }
  return Array.from(byKey.values());
}

function main(){
  const args = parseArgs(process.argv.slice(2));
  if(args.help){ usage(); return; }
  const projectRoot = path.resolve(args.project || process.env.DECK_PROJECT_ROOT || process.cwd());
  const manifestPath = resolveFrom(projectRoot, args.manifest || process.env.DECK_FONT_RESOLUTION_MANIFEST, path.join('out', 'font_resolution_manifest.json'));
  const requestPath = resolveFrom(projectRoot, args.installRequest || process.env.DECK_FONT_INSTALL_REQUEST, path.join('out', 'font_install_request.json'));
  const usagePath = args.fontUsage || process.env.DECK_FONT_USAGE
    ? resolveFrom(projectRoot, args.fontUsage || process.env.DECK_FONT_USAGE)
    : null;
  const decision = fontInstallDecision();
  const profile = loadProfile();
  const globalPolicy = resolveFontPolicy(profile, { allowPending:true, installDecision:decision });
  const collected = collectFonts(projectRoot, profile, usagePath);
  const globalKey = _helpers.normalizeFamilyKey(globalPolicy.original);
  if(!collected.some(row => _helpers.normalizeFamilyKey(row.original) === globalKey)){
    collected.unshift({ original:globalPolicy.original, sources:[sourceRecord('renderer-default', 'active deck font')] });
  }

  const fallbackCandidates = [
    globalPolicy.resolved,
    ..._helpers.splitFontFamilies(process.env.DECK_FONT_FALLBACK || ''),
    'Pretendard', 'Arial', 'Aptos', 'Malgun Gothic',
  ].filter(Boolean);
  const mappings = collected.map(row => {
    const mapping = _helpers.normalizeFamilyKey(row.original) === globalKey
      ? globalPolicy.mappings[0]
      : resolveFontMapping(row.original, { allowPending:true, installDecision:decision, fallbackCandidates });
    return Object.assign({}, mapping, { sources:row.sources });
  });
  const pending = mappings.filter(mapping => mapping.approvalRequired);
  const manifest = {
    schemaVersion:'slide-image-dual-render.font-resolution-manifest.v1',
    generatedAt:new Date().toISOString(),
    projectRoot,
    status:pending.length ? 'USER_DECISION_REQUIRED' : 'PASS',
    installPolicy:'ask-user-before-install; automatic-installation-forbidden',
    automaticInstallationAttempted:false,
    installDecision:decision,
    conversionContinuesAfterDecision:true,
    originalFontCount:mappings.length,
    exactCount:mappings.filter(mapping => mapping.exact).length,
    fallbackCount:mappings.filter(mapping => mapping.fallbackApplied).length,
    approvalRequiredCount:pending.length,
    search:globalPolicy.search,
    mappings,
  };
  writeJson(manifestPath, manifest);

  const installRequest = {
    schemaVersion:'slide-image-dual-render.font-install-request.v1',
    generatedAt:new Date().toISOString(),
    status:pending.length ? 'USER_DECISION_REQUIRED' : 'NOT_REQUIRED',
    automaticInstallationAttempted:false,
    userQuestion:pending.length
      ? `The following original fonts are not installed: ${pending.map(row => row.original).join(', ')}. May they be installed?`
      : null,
    requestedFonts:pending.map(row => ({ original:row.original, evidence:row.evidence, sources:row.sources })),
    allowedResponses:{
      install:'Install only after explicit user approval, outside this resolver, then rerun.',
      declined:'Rerun with DECK_FONT_INSTALL_DECISION=declined; fallback is applied and conversion continues.',
      unavailable:'Rerun with DECK_FONT_INSTALL_DECISION=unavailable; fallback is applied and conversion continues.',
    },
  };
  writeJson(requestPath, installRequest);

  if(pending.length){
    console.error(`[font-preflight] USER_DECISION_REQUIRED: ${pending.map(row => row.original).join(', ')}`);
    console.error('[font-preflight] Automatic font installation was not attempted. Ask the user before any installation.');
    console.error(`[font-preflight] Request: ${requestPath}`);
    console.error(`[font-preflight] Mapping: ${manifestPath}`);
    process.exitCode = 3;
    return;
  }
  console.log(`[font-preflight] PASS: ${mappings.length} original font(s), ${manifest.exactCount} exact, ${manifest.fallbackCount} fallback.`);
  console.log(`[font-preflight] mapping: ${manifestPath}`);
}

if(require.main === module){
  try { main(); }
  catch(err){ console.error(`[font-preflight] ERROR: ${err.message}`); process.exit(1); }
}

module.exports = { parseArgs, collectFonts };
