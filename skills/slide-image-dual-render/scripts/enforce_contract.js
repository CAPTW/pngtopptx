#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRIPT_DIR = path.resolve(__dirname);
const SCRIPT_ROOT = SCRIPT_DIR;
const SKILL_ROOT = path.basename(SCRIPT_DIR).toLowerCase() === 'scripts'
  ? path.dirname(SCRIPT_DIR)
  : SCRIPT_DIR;

function usage() {
  console.log(`enforce_contract.js - hard-locked slide-image-dual-render validator

Usage:
  node scripts/enforce_contract.js --phase preflight|postbuild|final [options]
  node C:\\Users\\USER\\.pngtopptx\\skills\\slide-image-dual-render\\scripts\\enforce_contract.js --project . --phase preflight

Options:
  --project <path>      Deck project root. Defaults to current working directory.
  --phase <phase>       preflight, postbuild, or final. Default: preflight.
  --slides 1,2,3       Selected slide numbers.
  --target <target>    pptx, html, or both. Default: both.
  --trace <path>       Trace path. Relative paths resolve from project root.
  --self-test          Allow projectRoot equal to the installed Skill root.
  --qa-only            Relax src/ existence check for QA-only workflows.
  --help               Show this help.

This validator reads deck-owned src/, lib/, assets/, work/, and out/ from --project/current directory, while approved renderer files resolve from the script installation.`);
}

function parseArgs(argv) {
  const args = { phase: 'preflight', target: 'both', raw: argv.slice() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = next();
    else if (a === '--phase') args.phase = next();
    else if (a === '--slides') args.slides = next();
    else if (a === '--target') args.target = next();
    else if (a === '--trace') args.trace = next();
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--qa-only') args.qaOnly = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function normal(p) {
  return path.resolve(p).toLowerCase();
}

function slash(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

function isInside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function looksLikeInstalledSkillRoot(p) {
  const n = path.resolve(p).replace(/\\/g, '/').toLowerCase();
  return n.endsWith('/.pngtopptx/skills/slide-image-dual-render');
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

function dirExists(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolveFromProject(projectRoot, value, defaultRel) {
  const raw = value || defaultRel;
  return path.resolve(projectRoot, raw);
}

function resolveLayout(args) {
  const projectRoot = path.resolve(args.project || process.cwd());
  return {
    projectRoot,
    skillRoot: SKILL_ROOT,
    scriptRoot: SCRIPT_ROOT,
    srcDir: path.join(projectRoot, 'src'),
    assetsDir: path.join(projectRoot, 'assets'),
    outDir: path.join(projectRoot, 'out'),
    workDir: path.join(projectRoot, 'work'),
    slidesJsPath: path.join(projectRoot, 'lib', 'slides.js'),
    manifestPath: path.join(projectRoot, 'assets', 'manifest.json'),
    tracePath: resolveFromProject(projectRoot, args.trace, path.join('out', 'render_trace.json')),
    buildJsPath: path.join(SCRIPT_ROOT, 'build.js'),
    slidePipelinePath: path.join(SCRIPT_ROOT, 'slide_pipeline.js'),
    kitJsPath: path.join(SCRIPT_ROOT, 'lib', 'kit.js'),
    atomsPptxPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_pptx.js'),
    atomsHtmlPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_html.js'),
    pptxOut: path.join(projectRoot, 'out', 'deck.pptx'),
    htmlOut: path.join(projectRoot, 'out', 'deck.html'),
  };
}

function parseSlides(slidesArg, slidesText) {
  if (slidesArg) {
    return slidesArg.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  }
  const nums = new Set();
  const re = /(?:function\s+s|(const|let|var)\s+s)(\d+)\b/g;
  let m;
  while ((m = re.exec(slidesText))) nums.add(Number(m[2]));
  return Array.from(nums).sort((a, b) => a - b);
}

function add(errors, msg) {
  errors.push(msg);
}

function assertTarget(target, errors) {
  if (!['pptx', 'html', 'both'].includes(target)) add(errors, `--target must be pptx, html, or both; got ${target}`);
}

function assertPhase(phase, errors) {
  if (!['preflight', 'postbuild', 'final'].includes(phase)) add(errors, `--phase must be preflight, postbuild, or final; got ${phase}`);
}

function validatePathContract(args, layout, errors) {
  if (looksLikeInstalledSkillRoot(layout.projectRoot) && !args.selfTest) {
    add(errors, `projectRoot is the installed Skill directory (${layout.projectRoot}); run from a deck project or pass --project <deck>.`);
  }
  if (!fileExists(layout.buildJsPath)) add(errors, `Approved build.js not found: ${layout.buildJsPath}`);
  if (!fileExists(layout.kitJsPath)) add(errors, `Approved kit.js not found: ${layout.kitJsPath}`);
  if (!fileExists(layout.atomsPptxPath)) add(errors, `Approved PPTX backend not found: ${layout.atomsPptxPath}`);
  if (!fileExists(layout.atomsHtmlPath)) add(errors, `Approved HTML backend not found: ${layout.atomsHtmlPath}`);
  if (!fileExists(layout.slidesJsPath)) add(errors, `Deck lib/slides.js is missing: ${layout.slidesJsPath}`);
  if (!args.qaOnly && !dirExists(layout.srcDir)) add(errors, `Deck src/ directory is missing: ${layout.srcDir}`);
}

function validateSlidesJs(args, layout, errors) {
  if (!fileExists(layout.slidesJsPath)) return;
  const rawText = readText(layout.slidesJsPath);
  const text = stripJsComments(rawText);
  const selected = parseSlides(args.slides, text);
  if (!selected.length) add(errors, 'No slide functions found or selected. Expected functions such as s1(s), s2(s).');

  if (!/require\s*\(\s*['"](?:\.\/)?kit['"]\s*\)|from\s+['"](?:\.\/)?kit['"]|kit\./.test(text)) {
    add(errors, 'lib/slides.js must use the kit contract, e.g. require("./kit") or kit helpers.');
  }

  for (const n of selected) {
    const fn = new RegExp(`(?:function\\s+s${n}\\s*\\(|(?:const|let|var)\\s+s${n}\\s*=)`).test(text);
    const exp = new RegExp(`module\\.exports\\s*=\\s*\\{[^}]*\\bs${n}\\b|exports\\.s${n}\\s*=`).test(text);
    if (!fn) add(errors, `Selected slide s${n} is not defined in lib/slides.js.`);
    if (!exp) add(errors, `Selected slide s${n} is not exported from lib/slides.js.`);
  }

  const forbiddenBackend = [
    'pptxgenjs', 'pptx.', 'addSlide', 'writeFile({ fileName', 'makePptxSurface', 'makeHtmlSurface',
    'document.', 'window.', '<html', '<body',
    'python-pptx', 'libreoffice', 'soffice', 'html-to-pptx', 'html to pptx', 'pdf-to-pptx',
  ];
  for (const token of forbiddenBackend) {
    if (text.toLowerCase().includes(token.toLowerCase())) add(errors, `lib/slides.js must be backend-agnostic and must not contain: ${token}`);
  }
  if (/require\s*\(\s*['"]pptxgenjs['"]\s*\)|import\s+.*['"]pptxgenjs['"]/.test(text)) {
    add(errors, 'lib/slides.js must not directly import or require pptxgenjs.');
  }

  const sourceSlidePattern = /(?:src[\\/])?slide\s*\d+\.(?:png|jpe?g|webp)/i;
  const imageCallPattern = /\b(?:img|image|crop|background|bg|addImage)\b/i;
  if (sourceSlidePattern.test(text) && imageCallPattern.test(text)) {
    add(errors, 'lib/slides.js appears to place a full source slide image. Reconstruct native objects and use registered crops only for unrecreatable regions.');
  }
}

function normalizeManifest(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.crops)) return data.crops;
  if (Array.isArray(data.assets)) return data.assets;
  if (typeof data === 'object') {
    return Object.entries(data).filter(([, v]) => v && typeof v === 'object').map(([name, v]) => Object.assign({ name }, v));
  }
  return [];
}

function validateCropManifest(args, layout, errors) {
  if (!fileExists(layout.manifestPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(readText(layout.manifestPath));
  } catch (err) {
    add(errors, `assets/manifest.json is not valid JSON: ${err.message}`);
    return;
  }
  const crops = normalizeManifest(parsed);
  const pxw = Number(process.env.DECK_PXW || 1672);
  const pxh = Number(process.env.DECK_PXH || 941);
  const canvasArea = pxw * pxh;
  const textish = /text|caption|title|table|bullet|label|heading/i;
  crops.forEach((crop, idx) => {
    const label = crop.name || `crop[${idx}]`;
    for (const field of ['name', 'slide', 'x', 'y', 'w', 'h', 'file', 'content_type', 'reconstruction_reason', 'editable_replacement']) {
      if (crop[field] === undefined || crop[field] === null || crop[field] === '') add(errors, `Crop ${label} is missing required field: ${field}`);
    }
    const contentType = String(crop.content_type || '').toLowerCase();
    const allowedContentTypes = new Set(['photoreal', '3d', 'continuous_tone', 'text', 'table', 'chart', 'label', 'bullet', 'dense_infographic', 'mixed_text_visual', 'decorative', 'unspecified']);
    if (crop.content_type && !allowedContentTypes.has(contentType)) add(errors, `Crop ${label} has invalid content_type: ${crop.content_type}`);
    const area = Number(crop.w) * Number(crop.h);
    if (Number.isFinite(area) && canvasArea > 0) {
      const ratio = area / canvasArea;
      if (ratio > 0.85) {
        if (crop.allow_large_crop !== true || !String(crop.reason || '').trim()) {
          add(errors, `Crop ${label} covers ${(ratio * 100).toFixed(1)}% of the slide. Large crops require allow_large_crop: true and reason.`);
        }
      }
      if (ratio > 0.65 && /slide\s*\d+\.(png|jpe?g|webp)$/i.test(String(crop.file || ''))) {
        add(errors, `Crop ${label} appears to reuse a near-full source slide image without an explicit large-crop exception.`);
      }
    }
    if ((textish.test(String(crop.name || '')) || ['text', 'table', 'chart', 'label', 'bullet', 'mixed_text_visual'].includes(contentType)) && !String(crop.reason || crop.justification || crop.reconstruction_reason || '').trim()) {
      add(errors, `Crop ${label} suggests text/table/chart/label content. Text-like crops require an explicit reason/justification.`);
    }
  });
}

function shouldScanFile(projectRoot, file) {
  const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  if (rel === 'SKILL.md') return false;
  if (rel.startsWith('references/')) return false;
  if (rel.startsWith('assets/validation/')) return false;
  if (rel.startsWith('out/') || rel.startsWith('assets/') || rel.startsWith('work/') || rel.includes('/node_modules/')) return false;
  if (rel.endsWith('.md')) return false;
  const base = path.basename(rel);
  if (['enforce_contract.js', 'final_gate.js', 'install_hardlock.js', 'make_icons.js'].includes(base) && rel.startsWith('scripts/')) return false;
  return /\\.(js|mjs|cjs|py|sh|ps1)$/i.test(rel);
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'out', 'assets', 'work', '.git'].includes(e.name)) continue;
      walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
}

function validateDirectGenerationScan(args, layout, errors) {
  const files = [];
  walk(layout.projectRoot, files);
  const allowed = new Set([
    path.join(layout.projectRoot, 'scripts', 'build.js').toLowerCase(),
    path.join(layout.projectRoot, 'scripts', 'slide_pipeline.js').toLowerCase(),
    path.join(layout.projectRoot, 'scripts', 'lib', 'atoms_pptx.js').toLowerCase(),
  ]);
  const patterns = [
    { re: /new\s+pptxgen\s*\(/i, label: 'new pptxgen(' },
    { re: /pptxgenjs/i, label: 'pptxgenjs' },
    { re: /python-pptx/i, label: 'python-pptx' },
    { re: /\bPresentation\s*\(\s*\)/, label: 'Presentation()' },
    { re: /html-to-pptx/i, label: 'html-to-pptx' },
    { re: /(?:writeFileSync|writeFile|copyFileSync|copy-item|cp\s+|copy\s+).{0,120}\.pptx/i, label: '.pptx write/copy' },
    { re: /soffice.{0,120}--convert-to\s+pptx/i, label: 'soffice --convert-to pptx' },
  ];
  for (const file of files) {
    if (!shouldScanFile(layout.projectRoot, file)) continue;
    if (allowed.has(file.toLowerCase())) continue;
    const text = readText(file);
    for (const p of patterns) {
      if (p.re.test(text)) add(errors, `${slash(file)} contains forbidden direct PPTX generation pattern: ${p.label}`);
    }
  }
}

function readTrace(layout, errors) {
  if (!fileExists(layout.tracePath)) {
    add(errors, `Trace file is missing: ${layout.tracePath}`);
    return null;
  }
  try {
    return JSON.parse(readText(layout.tracePath));
  } catch (err) {
    add(errors, `Trace file is not valid JSON: ${err.message}`);
    return null;
  }
}

function tracePath(trace, key) {
  return trace && typeof trace[key] === 'string' ? path.resolve(trace[key]) : '';
}

function requireTraceFields(trace, fields, errors) {
  for (const f of fields) {
    if (trace[f] === undefined || trace[f] === null || trace[f] === '') add(errors, `Trace is missing required field: ${f}`);
  }
}

function validateOutputAndTrace(args, layout, errors) {
  if (!['postbuild', 'final'].includes(args.phase)) return;
  const trace = readTrace(layout, errors);
  if (!trace) return;
  requireTraceFields(trace, [
    'skillRoot', 'projectRoot', 'buildJsPath', 'slidesJsPath', 'kitJsPath', 'atomsPptxPath', 'atomsHtmlPath',
    'pptxOut', 'htmlOut', 'hashes', 'enforcementDisabled', 'strictMode', 'invokedByPipeline',
    'preflightValidation', 'postbuildValidation', 'finalValidation', 'startTimeMs', 'dependencyResolutionMode'
  ], errors);

  if (trace.projectRoot && normal(trace.projectRoot) !== normal(layout.projectRoot)) add(errors, `Trace projectRoot does not match current projectRoot: ${trace.projectRoot}`);
  if (trace.slidesJsPath && normal(trace.slidesJsPath) !== normal(layout.slidesJsPath)) add(errors, `Trace slidesJsPath must be deck lib/slides.js: ${trace.slidesJsPath}`);
  if (trace.buildJsPath && normal(trace.buildJsPath) !== normal(layout.buildJsPath)) add(errors, `Trace buildJsPath does not match approved build.js: ${trace.buildJsPath}`);
  if (trace.kitJsPath && normal(trace.kitJsPath) !== normal(layout.kitJsPath)) add(errors, `Trace kitJsPath does not match approved kit.js: ${trace.kitJsPath}`);
  if (trace.atomsPptxPath && normal(trace.atomsPptxPath) !== normal(layout.atomsPptxPath)) add(errors, `Trace atomsPptxPath does not match approved PPTX backend: ${trace.atomsPptxPath}`);
  if (trace.atomsHtmlPath && normal(trace.atomsHtmlPath) !== normal(layout.atomsHtmlPath)) add(errors, `Trace atomsHtmlPath does not match approved HTML backend: ${trace.atomsHtmlPath}`);
  if (trace.enforcementDisabled === true) add(errors, 'Trace indicates SLIDE_PIPELINE_ENFORCE was disabled. Production delivery is invalid.');
  if (!Object.prototype.hasOwnProperty.call(trace, 'nodePathUsed')) add(errors, 'Trace is missing required field: nodePathUsed.');
  if (trace.dependencyResolutionMode === 'missing') add(errors, 'Trace dependencyResolutionMode is missing; production dependencies were not resolved.');
  if (Array.isArray(trace.dependencyMissingPackages) && trace.dependencyMissingPackages.length) add(errors, 'Trace reports missing Node dependencies: ' + trace.dependencyMissingPackages.join(', '));
  if (trace.invokedByPipeline !== true) add(errors, 'Trace must show invokedByPipeline: true. Direct build outputs are not production-valid.');
  if (!trace.preflightValidation || trace.preflightValidation.passed !== true) add(errors, 'Trace must show preflightValidation.passed: true.');
  if (args.phase === 'final' && (!trace.postbuildValidation || trace.postbuildValidation.passed !== true)) add(errors, 'Trace must show postbuildValidation.passed: true.');

  const target = trace.target || trace.TARGET || args.target;
  const outputs = [];
  if (target === 'pptx' || target === 'both') outputs.push(['PPTX', trace.pptxOut || (trace.generated && trace.generated.pptx)]);
  if (target === 'html' || target === 'both') outputs.push(['HTML', trace.htmlOut || (trace.generated && trace.generated.html)]);
  const start = Number(trace.startTimeMs || Date.parse(trace.timestamp || ''));
  for (const [kind, out] of outputs) {
    if (!out) { add(errors, `Trace is missing ${kind} output path.`); continue; }
    const resolved = path.resolve(out);
    if (!isInside(layout.projectRoot, resolved)) add(errors, `${kind} output path is outside projectRoot: ${resolved}`);
    if (looksLikeInstalledSkillRoot(layout.skillRoot) && isInside(layout.skillRoot, resolved) && !args.selfTest) add(errors, `${kind} output path resolves inside installed Skill root: ${resolved}`);
    if (!fileExists(resolved)) { add(errors, `${kind} output does not exist: ${resolved}`); continue; }
    if (Number.isFinite(start) && fs.statSync(resolved).mtimeMs + 1 < start) add(errors, `${kind} output is older than pipeline start time: ${resolved}`);
  }
}

function runValidation(args) {
  const errors = [];
  assertTarget(args.target, errors);
  assertPhase(args.phase, errors);
  const layout = resolveLayout(args);
  validatePathContract(args, layout, errors);
  validateSlidesJs(args, layout, errors);
  validateCropManifest(args, layout, errors);
  validateDirectGenerationScan(args, layout, errors);
  validateOutputAndTrace(args, layout, errors);
  if (errors.length) {
    const err = new Error(`Contract validation failed:\n- ${errors.join('\n- ')}`);
    err.errors = errors;
    throw err;
  }
  console.log(`[enforce-contract] ${args.phase} passed for ${layout.projectRoot}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  runValidation(args);
}

if (require.main === module) {
  try { main(); }
  catch (err) {
    console.error(`[enforce-contract] ERROR: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, resolveLayout, runValidation, sha256 };





