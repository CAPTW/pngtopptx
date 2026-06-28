#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const SCRIPT_DIR = path.resolve(__dirname);
const SCRIPT_ROOT = SCRIPT_DIR;
const SKILL_ROOT = path.basename(SCRIPT_DIR).toLowerCase() === 'scripts'
  ? path.dirname(SCRIPT_DIR)
  : SCRIPT_DIR;
const NODE = process.execPath;

function usage() {
  console.log(`final_gate.js - production delivery gate for slide-image-dual-render

Usage:
  node scripts/final_gate.js --target pptx|html|both --pptx out/deck.pptx --html out/deck.html [options]
  node C:\\Users\\USER\\.pngtopptx\\skills\\slide-image-dual-render\\scripts\\final_gate.js --project . --target both --pptx out\\deck.pptx --html out\\deck.html

Options:
  --project <path>      Deck project root. Defaults to current working directory.
  --trace <path>       Trace file. Defaults to out/render_trace.json under project root.
  --pptx <path>        Expected PPTX output path. Relative paths resolve from project root.
  --html <path>        Expected HTML output path. Relative paths resolve from project root.
  --target <target>    pptx, html, or both. Default: both.
  --slides <list>      Comma-separated selected slides for reconstruction validation.
  --quality <mode>     canary, preservation, or reconstruction. Default: trace value, canary output name, otherwise reconstruction.
  --require-qa         Require per-slide QA artifacts.
  --require-reconstruction
                       Require per-slide reconstruction artifacts and scores.
  --require-pptx-openable
                       Require strict PPTX package/openability validation. Defaults on in reconstruction mode when target includes PPTX.
  --self-test          Allow projectRoot equal to the installed Skill root.
  --help               Show this help.

A delivery is invalid unless it was produced by slide_pipeline.js with enforcement enabled and this gate passes.`);
}

function parseArgs(argv) {
  const args = { target: 'both', quality: null, slides: null, requireQa: false, requireReconstruction: false, requirePptxOpenable: false, raw: argv.slice() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = next();
    else if (a === '--trace') args.trace = next();
    else if (a === '--pptx') args.pptx = next();
    else if (a === '--html') args.html = next();
    else if (a === '--target') args.target = next();
    else if (a === '--slides') args.slides = next();
    else if (a === '--quality') args.quality = next();
    else if (a === '--require-qa') args.requireQa = true;
    else if (a === '--require-reconstruction') args.requireReconstruction = true;
    else if (a === '--require-pptx-openable') args.requirePptxOpenable = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function normal(p) {
  return path.resolve(p).toLowerCase();
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function resolveFromProject(projectRoot, value, defaultRel) {
  return path.resolve(projectRoot, value || defaultRel);
}

function resolveLayout(args) {
  const projectRoot = path.resolve(args.project || process.cwd());
  return {
    projectRoot,
    skillRoot: SKILL_ROOT,
    scriptRoot: SCRIPT_ROOT,
    tracePath: resolveFromProject(projectRoot, args.trace, path.join('out', 'render_trace.json')),
    expectedPptx: resolveFromProject(projectRoot, args.pptx, path.join('out', 'deck.pptx')),
    expectedHtml: resolveFromProject(projectRoot, args.html, path.join('out', 'deck.html')),
    slidesJsPath: path.join(projectRoot, 'lib', 'slides.js'),
    buildJsPath: path.join(SCRIPT_ROOT, 'build.js'),
    enforceContractPath: path.join(SCRIPT_ROOT, 'enforce_contract.js'),
    enforceReconstructionPath: path.join(SCRIPT_ROOT, 'enforce_reconstruction.js'),
    enforceQaPath: path.join(SCRIPT_ROOT, 'enforce_qa.js'),
    validatePptxPackagePath: path.join(SCRIPT_ROOT, 'validate_pptx_package.py'),
    pptxOpenabilityOutDir: path.join(projectRoot, 'out', 'pptx_openability_debug'),
    kitJsPath: path.join(SCRIPT_ROOT, 'lib', 'kit.js'),
    atomsPptxPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_pptx.js'),
    atomsHtmlPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_html.js'),
    nativeObjectManifestPath: path.join(projectRoot, 'out', 'native_object_manifest.json'),
    cropCoverageSummaryPath: path.join(projectRoot, 'out', 'crop_coverage_summary.json'),
    qaEvidenceSummaryPath: path.join(projectRoot, 'out', 'qa_evidence_summary.json'),
  };
}

function add(errors, msg) {
  errors.push(msg);
}

function requireField(obj, field, errors) {
  if (obj[field] === undefined || obj[field] === null || obj[field] === '') add(errors, `Trace is missing required field: ${field}`);
}

function traceOutput(trace, kind) {
  if (kind === 'pptx') return trace.pptxOut || (trace.generated && trace.generated.pptx) || '';
  return trace.htmlOut || (trace.generated && trace.generated.html) || '';
}

function assertSamePath(actual, expected, label, errors) {
  if (!actual) { add(errors, `Trace is missing ${label}.`); return; }
  if (normal(actual) !== normal(expected)) add(errors, `${label} mismatch. Trace=${actual}; requested/expected=${expected}`);
}

function validateRequestedPaths(args, layout, errors) {
  if (!['pptx', 'html', 'both'].includes(args.target)) add(errors, `--target must be pptx, html, or both; got ${args.target}`);
  if (looksLikeInstalledSkillRoot(layout.projectRoot) && !args.selfTest) add(errors, `projectRoot is the installed Skill directory (${layout.projectRoot}); final delivery must run from a deck project.`);
  const outputs = [];
  if (args.target === 'pptx' || args.target === 'both') outputs.push(['PPTX', layout.expectedPptx]);
  if (args.target === 'html' || args.target === 'both') outputs.push(['HTML', layout.expectedHtml]);
  for (const [kind, file] of outputs) {
    if (!isInside(layout.projectRoot, file)) add(errors, `${kind} output path is outside projectRoot: ${file}`);
    if (looksLikeInstalledSkillRoot(layout.skillRoot) && isInside(layout.skillRoot, file) && !args.selfTest) add(errors, `${kind} output path resolves inside installed Skill root: ${file}`);
  }
}

function validateTrace(args, layout, trace, errors) {
  const required = [
    'skillRoot', 'projectRoot', 'buildJsPath', 'slidesJsPath', 'kitJsPath', 'atomsPptxPath', 'atomsHtmlPath',
    'pptxOut', 'htmlOut', 'hashes', 'enforcementDisabled', 'strictMode', 'invokedByPipeline',
    'preflightValidation', 'postbuildValidation', 'finalValidation', 'startTimeMs', 'dependencyResolutionMode'
  ];
  for (const f of required) requireField(trace, f, errors);

  if (trace.enforcementDisabled === true) add(errors, 'Trace says enforcementDisabled: true. Production delivery is invalid.');
  if (!Object.prototype.hasOwnProperty.call(trace, 'nodePathUsed')) add(errors, 'Trace is missing required field: nodePathUsed.');
  if (trace.dependencyResolutionMode === 'missing') add(errors, 'Trace dependencyResolutionMode is missing; production dependencies were not resolved.');
  if (Array.isArray(trace.dependencyMissingPackages) && trace.dependencyMissingPackages.length) add(errors, 'Trace reports missing Node dependencies: ' + trace.dependencyMissingPackages.join(', '));
  if (trace.invokedByPipeline !== true) add(errors, 'Trace must say invokedByPipeline: true. Direct build output is invalid.');
  if (!trace.preflightValidation || trace.preflightValidation.passed !== true) add(errors, 'Trace preflightValidation.passed is not true.');
  if (!trace.postbuildValidation || trace.postbuildValidation.passed !== true) add(errors, 'Trace postbuildValidation.passed is not true.');
  if (!trace.finalValidation || trace.finalValidation.passed !== true) add(errors, 'Trace finalValidation.passed is not true.');
  if (trace.projectRoot && normal(trace.projectRoot) !== normal(layout.projectRoot)) add(errors, `Trace projectRoot differs from requested projectRoot: ${trace.projectRoot}`);
  if (trace.skillRoot && normal(trace.skillRoot) !== normal(layout.skillRoot)) add(errors, `Trace skillRoot differs from the executing Skill/script root: ${trace.skillRoot}`);
  assertSamePath(trace.slidesJsPath, layout.slidesJsPath, 'slidesJsPath', errors);
  assertSamePath(trace.buildJsPath, layout.buildJsPath, 'buildJsPath', errors);
  assertSamePath(trace.kitJsPath, layout.kitJsPath, 'kitJsPath', errors);
  assertSamePath(trace.atomsPptxPath, layout.atomsPptxPath, 'atomsPptxPath', errors);
  assertSamePath(trace.atomsHtmlPath, layout.atomsHtmlPath, 'atomsHtmlPath', errors);

  if (args.target === 'pptx' || args.target === 'both') assertSamePath(traceOutput(trace, 'pptx'), layout.expectedPptx, 'pptxOut', errors);
  if (args.target === 'html' || args.target === 'both') assertSamePath(traceOutput(trace, 'html'), layout.expectedHtml, 'htmlOut', errors);
}

function validateHashes(layout, trace, errors) {
  const files = {
    slidesJs: trace.slidesJsPath,
    buildJs: trace.buildJsPath,
    kitJs: trace.kitJsPath,
    atomsPptx: trace.atomsPptxPath,
    atomsHtml: trace.atomsHtmlPath,
  };
  for (const [key, file] of Object.entries(files)) {
    if (!file) continue;
    if (!fileExists(file)) { add(errors, `Hashed file is missing: ${file}`); continue; }
    const expected = trace.hashes && trace.hashes[key];
    if (!expected) { add(errors, `Trace is missing hash: hashes.${key}`); continue; }
    const actual = sha256(file);
    if (actual !== expected) add(errors, `Hash mismatch for ${key}. The file changed after the pipeline trace: ${file}`);
  }
}

function validateOutputs(args, layout, trace, errors) {
  const outputs = [];
  if (args.target === 'pptx' || args.target === 'both') outputs.push(['PPTX', layout.expectedPptx]);
  if (args.target === 'html' || args.target === 'both') outputs.push(['HTML', layout.expectedHtml]);
  const start = Number(trace.startTimeMs || Date.parse(trace.timestamp || ''));
  for (const [kind, file] of outputs) {
    if (!fileExists(file)) { add(errors, `${kind} output is missing: ${file}`); continue; }
    if (!isInside(layout.projectRoot, file)) add(errors, `${kind} output is outside projectRoot: ${file}`);
    if (looksLikeInstalledSkillRoot(layout.skillRoot) && isInside(layout.skillRoot, file) && !args.selfTest) add(errors, `${kind} output resolves inside installed Skill root: ${file}`);
    if (Number.isFinite(start) && fs.statSync(file).mtimeMs + 1 < start) add(errors, `${kind} output is older than pipeline start time: ${file}`);
  }
}


function manifestEntries(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.crops)) return data.crops;
  if (Array.isArray(data.assets)) return data.assets;
  if (typeof data === 'object') return Object.values(data).filter(v => v && typeof v === 'object');
  return [];
}

function validateCropTrace(layout, trace, errors) {
  const manifestPath = trace.cropManifestPath || path.join(layout.projectRoot, 'assets', 'manifest.json');
  let entries = [];
  if (fileExists(manifestPath)) {
    try { entries = manifestEntries(readJson(manifestPath)); }
    catch (err) { add(errors, `Crop manifest is not valid JSON: ${err.message}`); }
  }
  const cropsUsed = entries.length > 0 || !!trace.cropManifestHash;
  if (cropsUsed) {
    if (!trace.cropPlanPath) add(errors, 'Trace must record cropPlanPath when crops are used.');
    if (!trace.cropPlanHash) add(errors, 'Trace must record cropPlanHash when crops are used.');
    if (!trace.cropManifestPath) add(errors, 'Trace must record cropManifestPath when crops are used.');
    if (!trace.cropManifestHash) add(errors, 'Trace must record cropManifestHash when crops are used.');
  }
  if (trace.cropPlanPath) {
    if (!fileExists(trace.cropPlanPath)) add(errors, `Crop plan file is missing: ${trace.cropPlanPath}`);
    else if (trace.cropPlanHash && sha256(trace.cropPlanPath) !== trace.cropPlanHash) add(errors, `Crop plan hash mismatch: ${trace.cropPlanPath}`);
  }
  if (trace.cropManifestPath) {
    if (!fileExists(trace.cropManifestPath)) add(errors, `Crop manifest file is missing: ${trace.cropManifestPath}`);
    else if (trace.cropManifestHash && sha256(trace.cropManifestPath) !== trace.cropManifestHash) add(errors, `Crop manifest hash mismatch: ${trace.cropManifestPath}`);
  }
}
function parseSlides(value) {
  if (!value) return null;
  const slides = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (!slides.length) return null;
  return [...new Set(slides)].sort((a, b) => a - b);
}

function inferSlides(layout, trace) {
  const out = new Set();
  if (argsLikeSlides(trace && trace.SLIDES)) parseSlides(trace.SLIDES).forEach(n => out.add(n));
  const src = path.join(layout.projectRoot, 'src');
  if (fs.existsSync(src)) for (const name of fs.readdirSync(src)) { const m = /^slide(\d+)\./i.exec(name); if (m) out.add(Number(m[1])); }
  return [...out].sort((a, b) => a - b);
}

function argsLikeSlides(value) {
  return typeof value === 'string' && /\d/.test(value);
}

function loadJsonOptional(file, errors, label) {
  if (!fileExists(file)) { add(errors, `${label} is missing: ${file}`); return null; }
  try { return readJson(file); }
  catch (err) { add(errors, `${label} is invalid JSON: ${err.message}`); return null; }
}

function validateObjectiveEvidenceFiles(args, layout, trace, errors) {
  const quality = effectiveQuality(args, trace);
  if (quality !== 'reconstruction' && !args.requireReconstruction && !args.requireQa) return;
  const slides = parseSlides(args.slides) || inferSlides(layout, trace);
  const native = loadJsonOptional(layout.nativeObjectManifestPath, errors, 'native_object_manifest.json');
  const crop = loadJsonOptional(layout.cropCoverageSummaryPath, errors, 'crop_coverage_summary.json');
  const qaSummary = loadJsonOptional(layout.qaEvidenceSummaryPath, errors, 'qa_evidence_summary.json');
  for (const slide of slides) {
    const id = String(slide).padStart(2, '0');
    if (!native || !native.slides || !native.slides[String(slide)]) add(errors, `objective native manifest is missing slide ${slide}`);
    if (!crop || !crop.slides || !crop.slides[String(slide)]) add(errors, `objective crop coverage summary is missing slide ${slide}`);
    if (!qaSummary || !qaSummary.slides || !qaSummary.slides[String(slide)]) add(errors, `objective QA evidence summary is missing slide ${slide}`);
    for (const rel of [`work/slide${id}/qa_evidence.json`, `work/slide${id}/qa_result.json`, `work/slide${id}/reconstruction_score.json`]) {
      const file = path.join(layout.projectRoot, rel);
      if (!fileExists(file)) add(errors, `reconstruction delivery requires ${rel}`);
    }
  }
}

function runQaValidator(args, layout, trace) {
  const quality = effectiveQuality(args, trace);
  if (quality !== 'reconstruction' && !args.requireQa) return;
  const slides = parseSlides(args.slides) || inferSlides(layout, trace);
  const cmdArgs = ['--project', layout.projectRoot, '--slides', slides.join(','), '--require-evidence'];
  const result = cp.spawnSync(process.execPath, [layout.enforceQaPath, ...cmdArgs], { cwd: layout.projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`QA evidence validation failed with exit code ${result.status}`);
}

function recordObjectiveEvidenceSummary(layout, trace, args) {
  const quality = effectiveQuality(args, trace);
  if (quality !== 'reconstruction' && !args.requireReconstruction && !args.requireQa) return;
  trace.objectiveEvidenceSummary = {
    nativeObjectManifestPath: layout.nativeObjectManifestPath,
    nativeObjectManifestHash: fileExists(layout.nativeObjectManifestPath) ? sha256(layout.nativeObjectManifestPath) : '',
    cropCoverageSummaryPath: layout.cropCoverageSummaryPath,
    cropCoverageSummaryHash: fileExists(layout.cropCoverageSummaryPath) ? sha256(layout.cropCoverageSummaryPath) : '',
    qaEvidenceSummaryPath: layout.qaEvidenceSummaryPath,
    qaEvidenceSummaryHash: fileExists(layout.qaEvidenceSummaryPath) ? sha256(layout.qaEvidenceSummaryPath) : '',
    checkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(layout.tracePath, JSON.stringify(trace, null, 2), 'utf8');
}
function effectiveQuality(args, trace) {
  if (args.quality) return args.quality;
  if (trace && trace.quality) return trace.quality;
  const outputs = [trace && (trace.pptxOut || (trace.generated && trace.generated.pptx)), trace && (trace.htmlOut || (trace.generated && trace.generated.html))]
    .filter(Boolean).join(' ').toLowerCase();
  if (outputs.includes('canary')) return 'canary';
  return 'reconstruction';
}

function validateReconstructionTrace(args, trace, errors) {
  const quality = effectiveQuality(args, trace);
  if (!['canary', 'preservation', 'reconstruction'].includes(quality)) add(errors, `Invalid trace/argument quality: ${quality}`);
  if (quality !== 'reconstruction' && !args.requireReconstruction && !args.requireQa) return;
  for (const field of ['quality', 'requireQa', 'requireReconstruction', 'reconstructionValidation', 'cropCoverageSummary', 'qaSummary', 'objectiveEvidenceSummary']) {
    requireField(trace, field, errors);
  }
  if (trace.quality !== 'reconstruction') add(errors, `Trace quality must be reconstruction for production delivery; got ${trace.quality}`);
  if (trace.requireQa !== true) add(errors, 'Trace requireQa must be true in reconstruction delivery.');
  if (trace.requireReconstruction !== true) add(errors, 'Trace requireReconstruction must be true in reconstruction delivery.');
  if (!trace.reconstructionValidation || trace.reconstructionValidation.passed !== true) add(errors, 'Trace reconstructionValidation.passed is not true.');
}

function runReconstructionValidator(args, layout, trace) {
  const quality = effectiveQuality(args, trace);
  if (quality !== 'reconstruction' && !args.requireReconstruction && !args.requireQa) return;
  const cmdArgs = ['--project', layout.projectRoot, '--quality', quality, '--trace', layout.tracePath];
  if (args.slides) cmdArgs.push('--slides', args.slides);
  const result = cp.spawnSync(process.execPath, [layout.enforceReconstructionPath, ...cmdArgs], {
    cwd: layout.projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Reconstruction completeness validation failed with exit code ${result.status}`);
}

function targetIncludesPptx(target) {
  return target === 'pptx' || target === 'both';
}

function shouldRequirePptxOpenable(args, trace) {
  const quality = effectiveQuality(args, trace);
  return targetIncludesPptx(args.target) && (args.requirePptxOpenable || quality === 'reconstruction');
}

function recordPptxPackageValidation(layout, trace, validation) {
  if (!trace) return;
  trace.pptxPackageValidation = validation;
  fs.writeFileSync(layout.tracePath, JSON.stringify(trace, null, 2), 'utf8');
}

function runPptxPackageValidator(args, layout, trace) {
  if (!targetIncludesPptx(args.target)) return;
  if (!shouldRequirePptxOpenable(args, trace)) {
    recordPptxPackageValidation(layout, trace, {
      passed: null,
      skipped: true,
      reason: 'PPTX openability validation was not required for this delivery mode.',
      checkedAt: new Date().toISOString(),
    });
    return;
  }
  if (!fileExists(layout.validatePptxPackagePath)) {
    const failure = {
      passed: false,
      validator: layout.validatePptxPackagePath,
      pptx: layout.expectedPptx,
      error: 'validate_pptx_package.py is missing.',
      checkedAt: new Date().toISOString(),
    };
    recordPptxPackageValidation(layout, trace, failure);
    throw new Error(`PPTX package validator is missing: ${layout.validatePptxPackagePath}`);
  }
  if (!fileExists(layout.expectedPptx)) {
    const failure = {
      passed: false,
      validator: layout.validatePptxPackagePath,
      pptx: layout.expectedPptx,
      error: 'Requested PPTX output is missing.',
      checkedAt: new Date().toISOString(),
    };
    recordPptxPackageValidation(layout, trace, failure);
    throw new Error(`Requested PPTX output is missing: ${layout.expectedPptx}`);
  }

  const reportJson = path.join(layout.pptxOpenabilityOutDir, 'pptx_package_validation.json');
  const reportMarkdown = path.join(layout.pptxOpenabilityOutDir, 'pptx_package_validation.md');
  const python = process.env.PYTHON || 'python';
  const result = cp.spawnSync(python, [
    layout.validatePptxPackagePath,
    '--project', layout.projectRoot,
    '--pptx', layout.expectedPptx,
    '--out', layout.pptxOpenabilityOutDir,
    '--strict',
  ], {
    cwd: layout.projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const validation = {
    passed: result.status === 0 && !result.error,
    validator: layout.validatePptxPackagePath,
    pptx: layout.expectedPptx,
    reportJson,
    reportMarkdown,
    exitCode: result.status,
    checkedAt: new Date().toISOString(),
  };
  if (result.error) validation.error = result.error.message;
  recordPptxPackageValidation(layout, trace, validation);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PPTX package/openability validation failed with exit code ${result.status}. See ${reportMarkdown}`);
}
function runFinalValidator(args, layout) {
  const argv = [
    layout.enforceContractPath,
    '--phase', 'final',
    '--project', layout.projectRoot,
    '--target', args.target,
    '--trace', layout.tracePath,
  ];
  if (args.selfTest) argv.push('--self-test');
  const res = cp.spawnSync(NODE, argv, {
    cwd: layout.projectRoot,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`enforce_contract.js --phase final failed with exit code ${res.status}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const layout = resolveLayout(args);
  const errors = [];
  validateRequestedPaths(args, layout, errors);
  if (!fileExists(layout.tracePath)) {
    add(errors, `Trace file is missing: ${layout.tracePath}`);
  }
  let trace = null;
  if (!errors.length) {
    try { trace = readJson(layout.tracePath); }
    catch (err) { add(errors, `Trace is not valid JSON: ${err.message}`); }
  }
  if (trace) {
    validateTrace(args, layout, trace, errors);
    validateHashes(layout, trace, errors);
    validateOutputs(args, layout, trace, errors);
    validateCropTrace(layout, trace, errors);
    validateObjectiveEvidenceFiles(args, layout, trace, errors);
  }
  if (errors.length) throw new Error(`Final gate failed:\n- ${errors.join('\n- ')}`);

  runFinalValidator(args, layout);
  runPptxPackageValidator(args, layout, trace);
  runQaValidator(args, layout, trace);
  runReconstructionValidator(args, layout, trace);
  recordObjectiveEvidenceSummary(layout, trace, args);
  console.log(`[final-gate] passed for ${layout.projectRoot}`);
}

try { main(); }
catch (err) {
  console.error(`[final-gate] ERROR: ${err.message}`);
  process.exit(1);
}








