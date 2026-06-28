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
const REQUIRED_NODE_PACKAGES = ['pptxgenjs', 'sharp', 'react', 'react-dom', 'react-icons'];

function usage() {
  console.log(`slide_pipeline.js - hard-locked slide-image-dual-render entrypoint

Usage:
  node scripts/slide_pipeline.js [options]
  node C:\\Users\\USER\\.pngtopptx\\skills\\slide-image-dual-render\\scripts\\slide_pipeline.js --project . [options]

Options:
  --project <path>      Deck project root. Defaults to current working directory.
  --slides 1,2,3       Selected slide numbers.
  --target <target>    pptx, html, or both. Default: both.
  --quality <mode>     canary, preservation, or reconstruction. Default: canary for canary outputs, otherwise reconstruction.
  --require-qa         Require per-slide QA artifacts in reconstruction mode.
  --require-reconstruction
                       Require per-slide reconstruction artifacts and scores.
  --max-batch-size <n> Maximum selected slides in reconstruction mode. Default: 5.
  --allow-large-batch  Allow a reconstruction batch larger than --max-batch-size.
  --profile <path>     DECK_PROFILE path. Relative paths resolve from project root.
  --assets <path>      DECK_ASSETS path. Relative paths resolve from project root.
  --crop-plan <path>   Crop plan JSON. Relative paths resolve from project root. Default: work/crop_plan.json.
  --node-path <path>   Node dependency directory, usually .\\node_modules. Relative paths resolve from project root.
  --pxw <number>       Source slide pixel width.
  --pxh <number>       Source slide pixel height.
  --pptx-out <path>    PPTX output path. Relative paths resolve from project root.
  --html-out <path>    HTML output path. Relative paths resolve from project root.
  --skip-assets        Skip background and icon generation.
  --skip-crops         Skip crop generation.
  --qa-only            Run validation/gate checks only; do not render.
  --dry-run            Print resolved paths and planned steps without executing them.
  --self-test          Allow running with projectRoot equal to the installed Skill root.
  --help               Show this help.

Dependency resolution order:
  1. --node-path
  2. existing NODE_PATH
  3. project-local node_modules
  4. Skill-local node_modules
  5. fail with install instructions

Production conversions must run from a deck project root or pass --project explicitly.`);
}

function parseArgs(argv) {
  const args = {
    target: 'both',
    quality: null,
    requireQa: false,
    requireReconstruction: false,
    maxBatchSize: null,
    allowLargeBatch: false,
    skipAssets: false,
    skipCrops: false,
    qaOnly: false,
    dryRun: false,
    selfTest: false,
    raw: argv.slice(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = next();
    else if (a === '--slides') args.slides = next();
    else if (a === '--target') args.target = next();
    else if (a === '--quality') args.quality = next();
    else if (a === '--require-qa') args.requireQa = true;
    else if (a === '--require-reconstruction') args.requireReconstruction = true;
    else if (a === '--max-batch-size') args.maxBatchSize = Number(next());
    else if (a === '--allow-large-batch') args.allowLargeBatch = true;
    else if (a === '--profile') args.profile = next();
    else if (a === '--assets') args.assets = next();
    else if (a === '--crop-plan') args.cropPlan = next();
    else if (a === '--node-path') args.nodePath = next();
    else if (a === '--pxw') args.pxw = next();
    else if (a === '--pxh') args.pxh = next();
    else if (a === '--pptx-out') args.pptxOut = next();
    else if (a === '--html-out') args.htmlOut = next();
    else if (a === '--skip-assets') args.skipAssets = true;
    else if (a === '--skip-crops') args.skipCrops = true;
    else if (a === '--qa-only') args.qaOnly = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function resolveFromProject(projectRoot, value, defaultRel) {
  const raw = value || defaultRel;
  if (!raw) return undefined;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}

function dirExists(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

function resolveLayout(args) {
  const projectRoot = path.resolve(args.project || process.cwd());
  const assetsDir = resolveFromProject(projectRoot, args.assets, 'assets');
  const pptxOut = resolveFromProject(projectRoot, args.pptxOut, path.join('out', 'deck.pptx'));
  const htmlOut = resolveFromProject(projectRoot, args.htmlOut, path.join('out', 'deck.html'));
  const profilePath = args.profile ? resolveFromProject(projectRoot, args.profile) : (process.env.DECK_PROFILE || '');
  const cropPlan = resolveCropPlan(projectRoot, args);
  return {
    projectRoot,
    skillRoot: SKILL_ROOT,
    scriptRoot: SCRIPT_ROOT,
    srcDir: path.join(projectRoot, 'src'),
    workDir: path.join(projectRoot, 'work'),
    outDir: path.join(projectRoot, 'out'),
    stylesDir: path.join(projectRoot, 'styles'),
    assetsDir,
    slidesJsPath: path.join(projectRoot, 'lib', 'slides.js'),
    buildJsPath: path.join(SCRIPT_ROOT, 'build.js'),
    enforceContractPath: path.join(SCRIPT_ROOT, 'enforce_contract.js'),
    enforceReconstructionPath: path.join(SCRIPT_ROOT, 'enforce_reconstruction.js'),
    generateEvidencePath: path.join(SCRIPT_ROOT, 'generate_evidence.js'),
    finalGatePath: path.join(SCRIPT_ROOT, 'final_gate.js'),
    makeBgPath: path.join(SCRIPT_ROOT, 'make_bg.py'),
    makeIconsPath: path.join(SCRIPT_ROOT, 'make_icons.js'),
    makeCropsPath: path.join(SCRIPT_ROOT, 'make_crops.py'),
    kitJsPath: path.join(SCRIPT_ROOT, 'lib', 'kit.js'),
    atomsPptxPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_pptx.js'),
    atomsHtmlPath: path.join(SCRIPT_ROOT, 'lib', 'atoms_html.js'),
    tracePath: path.join(projectRoot, 'out', 'render_trace.json'),
    manifestPath: path.join(projectRoot, 'assets', 'manifest.json'),
    nativeObjectManifestPath: path.join(projectRoot, 'out', 'native_object_manifest.json'),
    cropCoverageSummaryPath: path.join(projectRoot, 'out', 'crop_coverage_summary.json'),
    qaEvidenceSummaryPath: path.join(projectRoot, 'out', 'qa_evidence_summary.json'),
    pptxOut,
    htmlOut,
    profilePath,
    cropPlanPath: cropPlan.path,
    cropPlanSource: cropPlan.source,
  };
}

function resolveCropPlan(projectRoot, args) {
  if (args.cropPlan) return { source: 'cli', path: resolveFromProject(projectRoot, args.cropPlan) };
  if (process.env.CROP_PLAN) return { source: 'env', path: resolveFromProject(projectRoot, process.env.CROP_PLAN) };
  return { source: 'default', path: path.join(projectRoot, 'work', 'crop_plan.json') };
}

function validateTarget(target) {
  if (!['pptx', 'html', 'both'].includes(target)) throw new Error(`--target must be pptx, html, or both; got ${target}`);
}

function validatePaths(args, layout) {
  const errors = [];
  if (looksLikeInstalledSkillRoot(layout.projectRoot) && !args.selfTest) {
    errors.push(`projectRoot resolves to the installed Skill directory (${layout.projectRoot}). Run from a deck project or pass --project <deck>.`);
  }
  if (!fileExists(layout.buildJsPath)) errors.push(`Skill build.js not found: ${layout.buildJsPath}`);
  if (!fileExists(layout.enforceContractPath)) errors.push(`Skill enforce_contract.js not found: ${layout.enforceContractPath}`);
  if (!fileExists(layout.slidesJsPath) && !args.dryRun) errors.push(`Deck lib/slides.js is missing: ${layout.slidesJsPath}`);
  if (!dirExists(layout.srcDir) && !args.qaOnly && !args.dryRun) errors.push(`Deck src/ directory is missing: ${layout.srcDir}`);
  if (!args.skipCrops && !args.qaOnly && !args.dryRun && !fileExists(layout.cropPlanPath)) {
    errors.push(`Crop plan is missing: ${layout.cropPlanPath}. Create work/crop_plan.json, pass --crop-plan <path>, or pass --skip-crops only for a crop-free native-only deck.`);
  }
  for (const outPath of [layout.pptxOut, layout.htmlOut]) {
    if (!isInside(layout.projectRoot, outPath)) errors.push(`Output path must stay inside projectRoot: ${outPath}`);
    if (looksLikeInstalledSkillRoot(layout.skillRoot) && isInside(layout.skillRoot, outPath) && !args.selfTest) {
      errors.push(`Output path resolves inside the installed Skill directory: ${outPath}`);
    }
  }
  if (errors.length) {
    const e = new Error(`Path-contract validation failed:\n- ${errors.join('\n- ')}`);
    e.validationErrors = errors;
    throw e;
  }
}

function packageDir(nodeModulesDir, pkg) {
  return path.join(nodeModulesDir, ...pkg.split('/'));
}

function hasPackage(nodeModulesDir, pkg) {
  return fileExists(path.join(packageDir(nodeModulesDir, pkg), 'package.json')) || dirExists(packageDir(nodeModulesDir, pkg));
}

function dependencyStatus(nodeModuleDirs) {
  const dirs = nodeModuleDirs.filter(Boolean).map(p => path.resolve(p));
  const missing = [];
  for (const pkg of REQUIRED_NODE_PACKAGES) {
    if (!dirs.some(dir => hasPackage(dir, pkg))) missing.push(pkg);
  }
  return { ok: missing.length === 0, missing, dirs };
}

function splitNodePath(value) {
  return String(value || '').split(path.delimiter).map(p => p.trim()).filter(Boolean).map(p => path.resolve(p));
}

function resolveNodeDependencies(args, layout) {
  const searched = [];
  const check = (mode, source, dirs) => {
    const resolved = dirs.filter(Boolean).map(d => path.isAbsolute(d) ? path.resolve(d) : path.resolve(layout.projectRoot, d));
    searched.push({ mode, source, dirs: resolved });
    const status = dependencyStatus(resolved);
    return Object.assign({ mode, source, nodePathUsed: resolved.join(path.delimiter), searched }, status);
  };

  if (args.nodePath) {
    const cli = check('cli', '--node-path', [args.nodePath]);
    if (cli.ok) return cli;
    return cli;
  }
  if (process.env.NODE_PATH) {
    const env = check('env', 'NODE_PATH', splitNodePath(process.env.NODE_PATH));
    if (env.ok) return env;
  }
  const project = check('project', 'project-local node_modules', [path.join(layout.projectRoot, 'node_modules')]);
  if (project.ok) return project;
  const skill = check('skill', 'Skill-local node_modules', [path.join(layout.skillRoot, 'node_modules'), path.join(layout.scriptRoot, 'node_modules')]);
  if (skill.ok) return skill;
  return Object.assign({}, skill, { mode: 'missing', source: 'not found', searched });
}

function dependencyError(info, layout) {
  const looked = [];
  for (const item of info.searched || []) {
    for (const dir of item.dirs || []) looked.push(`- ${item.mode}: ${dir}`);
  }
  return `Missing required Node dependencies for slide-image-dual-render: ${info.missing.join(', ')}\n` +
    `Looked in:\n${looked.join('\n')}\n\n` +
    `Fix for Skill-installed layout:\n` +
    `  cd ${layout.projectRoot}\n` +
    `  npm i pptxgenjs sharp react react-dom react-icons\n` +
    `  node "%USERPROFILE%\\.pngtopptx\\skills\\slide-image-dual-render\\scripts\\slide_pipeline.js" --project . --node-path .\\node_modules ...\n\n` +
    `Fix for deck-local copied layout:\n` +
    `  cd ${layout.projectRoot}\n` +
    `  npm i pptxgenjs sharp react react-dom react-icons\n` +
    `  node scripts\\slide_pipeline.js --project . --node-path .\\node_modules ...`;
}

function runStep(label, cmd, argv, layout, envExtra) {
  console.log(`[slide-pipeline] ${label}`);
  const res = cp.spawnSync(cmd, argv, {
    cwd: layout.projectRoot,
    stdio: 'inherit',
    shell: false,
    env: Object.assign({}, process.env, envExtra || {}),
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${label} failed with exit code ${res.status}`);
}

function runNode(label, script, argv, layout, env) {
  runStep(label, NODE, [script].concat(argv), layout, env);
}

function runPython(label, script, argv, layout, env) {
  const python = process.env.PYTHON || 'python';
  runStep(label, python, [script].concat(argv || []), layout, env);
}

function baseEnv(args, layout, runId, deps) {
  const env = {
    DECK_PROJECT_ROOT: layout.projectRoot,
    DECK_ASSETS: layout.assetsDir,
    DECK_SRC: layout.srcDir,
    SRC_DIR: layout.srcDir,
    SLIDES_JS: layout.slidesJsPath,
    CROP_PLAN: layout.cropPlanPath,
    TARGET: args.target,
    SLIDES: args.slides || '',
    PPTX_OUT: layout.pptxOut,
    HTML_OUT: layout.htmlOut,
    DECK_PPTX_OUT: layout.pptxOut,
    DECK_HTML_OUT: layout.htmlOut,
    SLIDE_PIPELINE_RUN_ID: runId,
    SLIDE_PIPELINE_INVOKED: '1',
    SLIDE_PIPELINE_STRICT: '1',
    SLIDE_PIPELINE_ENFORCE: '1',
  };
  if (deps && deps.nodePathUsed) env.NODE_PATH = deps.nodePathUsed;
  if (layout.profilePath) env.DECK_PROFILE = layout.profilePath;
  if (args.pxw) env.DECK_PXW = String(args.pxw);
  if (args.pxh) env.DECK_PXH = String(args.pxh);
  return env;
}

function parsePipelineSlides(value) {
  if (!value) return null;
  const slides = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (!slides.length) throw new Error(`Invalid --slides value: ${value}`);
  return [...new Set(slides)].sort((a, b) => a - b);
}

function inferPipelineSlides(projectRoot) {
  const src = path.join(projectRoot, 'src');
  if (!fs.existsSync(src)) return [];
  return fs.readdirSync(src)
    .map(name => /^slide(\d+)\.(png|jpe?g|webp)$/i.exec(name))
    .filter(Boolean)
    .map(m => Number(m[1]))
    .filter(n => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

function inferPipelineQuality(args, layout) {
  if (args.quality) return args.quality;
  const outs = [layout && layout.pptxOut, layout && layout.htmlOut].filter(Boolean).join(' ').toLowerCase();
  if (outs.includes('canary')) return 'canary';
  if (process.env.RECONSTRUCTION_STRICT === '1') return 'reconstruction';
  return 'reconstruction';
}

function applyPipelineQualityDefaults(args, layout, slides) {
  args.quality = inferPipelineQuality(args, layout);
  if (!['canary', 'preservation', 'reconstruction'].includes(args.quality)) throw new Error(`--quality must be canary, preservation, or reconstruction; got ${args.quality}`);
  if (args.quality === 'reconstruction') {
    args.requireQa = true;
    args.requireReconstruction = true;
    if (!Number.isFinite(args.maxBatchSize) || args.maxBatchSize <= 0) args.maxBatchSize = 5;
    if (slides.length > args.maxBatchSize && !args.allowLargeBatch) {
      throw new Error(`Reconstruction mode requires wave-based processing. Run slides 1-5, 6-10, 11-15, 16-20 or pass --allow-large-batch with an explicit reason. Selected ${slides.length} slides; max batch size is ${args.maxBatchSize}.`);
    }
  } else if (!Number.isFinite(args.maxBatchSize) || args.maxBatchSize <= 0) {
    args.maxBatchSize = null;
  }
}

function evidenceArgs(args, layout) {
  const out = ['--project', layout.projectRoot, '--quality', args.quality || 'reconstruction'];
  if (args.slides) out.push('--slides', args.slides);
  out.push('--pxw', String(args.pxw || process.env.DECK_PXW || 1672));
  out.push('--pxh', String(args.pxh || process.env.DECK_PXH || 941));
  return out;
}

function readJsonIfExists(file) {
  try { return fileExists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch (_) { return null; }
}

function objectiveEvidenceTrace(layout) {
  const nativeManifest = readJsonIfExists(layout.nativeObjectManifestPath);
  const cropCoverage = readJsonIfExists(layout.cropCoverageSummaryPath);
  const qaEvidence = readJsonIfExists(layout.qaEvidenceSummaryPath);
  return {
    nativeObjectManifestPath: layout.nativeObjectManifestPath,
    nativeObjectManifestHash: fileExists(layout.nativeObjectManifestPath) ? sha256(layout.nativeObjectManifestPath) : '',
    cropCoverageSummaryPath: layout.cropCoverageSummaryPath,
    cropCoverageSummaryHash: fileExists(layout.cropCoverageSummaryPath) ? sha256(layout.cropCoverageSummaryPath) : '',
    qaEvidenceSummaryPath: layout.qaEvidenceSummaryPath,
    qaEvidenceSummaryHash: fileExists(layout.qaEvidenceSummaryPath) ? sha256(layout.qaEvidenceSummaryPath) : '',
    nativeSlides: nativeManifest && nativeManifest.slides ? Object.keys(nativeManifest.slides).map(Number).sort((a, b) => a - b) : [],
    cropSlides: cropCoverage && cropCoverage.slides ? Object.keys(cropCoverage.slides).map(Number).sort((a, b) => a - b) : [],
    qaSlides: qaEvidence && qaEvidence.slides ? Object.keys(qaEvidence.slides).map(Number).sort((a, b) => a - b) : [],
  };
}
function reconstructionArgs(args, layout) {
  const out = ['--project', layout.projectRoot, '--quality', args.quality || 'reconstruction', '--trace', layout.tracePath];
  if (args.slides) out.push('--slides', args.slides);
  return out;
}
function validationArgs(phase, args, layout) {
  const out = ['--phase', phase, '--project', layout.projectRoot, '--target', args.target, '--trace', layout.tracePath];
  if (args.slides) out.push('--slides', args.slides);
  if (args.selfTest) out.push('--self-test');
  return out;
}

function computeHashes(layout) {
  const hashes = {};
  for (const [key, file] of Object.entries({
    slidesJs: layout.slidesJsPath,
    buildJs: layout.buildJsPath,
    kitJs: layout.kitJsPath,
    atomsPptx: layout.atomsPptxPath,
    atomsHtml: layout.atomsHtmlPath,
  })) {
    if (fileExists(file)) hashes[key] = sha256(file);
  }
  return hashes;
}

function traceSkeleton(args, layout, runId, startTimeMs, deps) {
  const target = args.target;
  const cropPlanExists = fileExists(layout.cropPlanPath);
  const manifestExists = fileExists(layout.manifestPath);
  return {
    timestamp: new Date(startTimeMs).toISOString(),
    startTimeMs,
    runId,
    args: args.raw,
    commandArguments: args.raw,
    DECK_PROFILE: layout.profilePath || process.env.DECK_PROFILE || '',
    DECK_ASSETS: layout.assetsDir,
    DECK_PXW: args.pxw || process.env.DECK_PXW || '',
    DECK_PXH: args.pxh || process.env.DECK_PXH || '',
    SLIDES: args.slides || '',
    TARGET: target,
    target,
    quality: args.quality,
    requireQa: !!args.requireQa,
    requireReconstruction: !!args.requireReconstruction,
    maxBatchSize: args.maxBatchSize,
    allowLargeBatch: !!args.allowLargeBatch,
    skillRoot: layout.skillRoot,
    projectRoot: layout.projectRoot,
    buildJsPath: layout.buildJsPath,
    slidesJsPath: layout.slidesJsPath,
    kitJsPath: layout.kitJsPath,
    atomsPptxPath: layout.atomsPptxPath,
    atomsHtmlPath: layout.atomsHtmlPath,
    pptxOut: layout.pptxOut,
    htmlOut: layout.htmlOut,
    cropPlanPath: layout.cropPlanPath,
    cropPlanSource: layout.cropPlanSource,
    cropPlanHash: cropPlanExists ? sha256(layout.cropPlanPath) : '',
    cropManifestPath: layout.manifestPath,
    cropManifestHash: manifestExists ? sha256(layout.manifestPath) : '',
    nodePathUsed: deps && deps.nodePathUsed ? deps.nodePathUsed : '',
    dependencyResolutionMode: deps ? deps.mode : 'missing',
    dependencyResolutionSource: deps ? deps.source : 'not checked',
    dependencyRequiredPackages: REQUIRED_NODE_PACKAGES,
    dependencyMissingPackages: deps ? deps.missing : REQUIRED_NODE_PACKAGES,
    generated: {
      pptx: target === 'pptx' || target === 'both' ? layout.pptxOut : '',
      html: target === 'html' || target === 'both' ? layout.htmlOut : '',
    },
    hashes: computeHashes(layout),
    enforcementDisabled: process.env.SLIDE_PIPELINE_ENFORCE === '0',
    strictMode: true,
    invokedByPipeline: true,
    validation: { passed: false },
    preflightValidation: { passed: false },
    postbuildValidation: { passed: false },
    finalValidation: { passed: false },
    reconstructionValidation: { passed: false, slidesPassed: [], slidesFailed: [] },
    cropCoverageSummary: {},
    qaSummary: {},
    objectiveEvidenceSummary: {},
    buildTrace: {},
  };
}

function refreshTraceArtifacts(trace, layout) {
  trace.hashes = computeHashes(layout);
  trace.cropPlanHash = fileExists(layout.cropPlanPath) ? sha256(layout.cropPlanPath) : '';
  trace.cropManifestHash = fileExists(layout.manifestPath) ? sha256(layout.manifestPath) : '';
  trace.nativeObjectManifestHash = fileExists(layout.nativeObjectManifestPath) ? sha256(layout.nativeObjectManifestPath) : '';
  trace.cropCoverageSummaryHash = fileExists(layout.cropCoverageSummaryPath) ? sha256(layout.cropCoverageSummaryPath) : '';
  trace.qaEvidenceSummaryHash = fileExists(layout.qaEvidenceSummaryPath) ? sha256(layout.qaEvidenceSummaryPath) : '';
  trace.objectiveEvidenceSummary = objectiveEvidenceTrace(layout);
}

function writeTrace(layout, trace) {
  ensureDir(path.dirname(layout.tracePath));
  fs.writeFileSync(layout.tracePath, JSON.stringify(trace, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  validateTarget(args.target);
    const layout = resolveLayout(args);
    const qualitySlides = parsePipelineSlides(args.slides) || inferPipelineSlides(layout.projectRoot);
    applyPipelineQualityDefaults(args, layout, qualitySlides);
  validatePaths(args, layout);
  ensureDir(layout.outDir);
  ensureDir(layout.assetsDir);

  const deps = args.qaOnly || args.dryRun ? { ok: true, missing: [], mode: 'not-required', source: 'qa/dry-run', nodePathUsed: '', searched: [] } : resolveNodeDependencies(args, layout);
  if (!deps.ok && !args.dryRun) throw new Error(dependencyError(deps, layout));

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const startTimeMs = Date.now();
  const env = baseEnv(args, layout, runId, deps);
  const trace = traceSkeleton(args, layout, runId, startTimeMs, deps);

  const plan = [
    'preflight contract validation',
    args.skipAssets ? 'background/icon generation skipped' : 'background generation and icon generation',
    args.skipCrops ? 'crop generation skipped' : `crop generation from ${layout.cropPlanPath}`,
    args.qaOnly ? 'build skipped (--qa-only)' : `build.js TARGET=${args.target}`,
    'post-build contract validation',
    'final contract validation',
    `write trace ${layout.tracePath}`,
  ];

  if (args.dryRun) {
    console.log(JSON.stringify({ layout, plan, dependencyResolution: deps, env }, null, 2));
    return;
  }

  try {
    runNode('preflight contract validation', layout.enforceContractPath, validationArgs('preflight', args, layout), layout, env);
    trace.preflightValidation = { passed: true, timestamp: new Date().toISOString() };

    if (!args.qaOnly) {
      if (!args.skipAssets) {
        runPython('background generation', layout.makeBgPath, [], layout, env);
        runNode('icon generation', layout.makeIconsPath, [], layout, env);
      }
      if (!args.skipCrops) {
        runPython('crop generation', layout.makeCropsPath, [], layout, env);
        refreshTraceArtifacts(trace, layout);
      }
      runNode('approved build pipeline', layout.buildJsPath, [], layout, env);
      runNode('objective evidence summary generation', layout.generateEvidencePath, evidenceArgs(args, layout), layout, env);
      refreshTraceArtifacts(trace, layout);
    }

    trace.postbuildValidation = { passed: false, timestamp: new Date().toISOString() };
    refreshTraceArtifacts(trace, layout);
    writeTrace(layout, trace);
    runNode('post-build contract validation', layout.enforceContractPath, validationArgs('postbuild', args, layout), layout, env);
    trace.postbuildValidation = { passed: true, timestamp: new Date().toISOString() };
    refreshTraceArtifacts(trace, layout);
    writeTrace(layout, trace);

    if (args.requireReconstruction) {
      trace.reconstructionValidation = { passed: false, slidesPassed: [], slidesFailed: qualitySlides, timestamp: new Date().toISOString() };
      refreshTraceArtifacts(trace, layout);
      writeTrace(layout, trace);
      runNode('reconstruction completeness validation', layout.enforceReconstructionPath, reconstructionArgs(args, layout), layout, env);
      trace.reconstructionValidation = { passed: true, slidesPassed: qualitySlides, slidesFailed: [], timestamp: new Date().toISOString() };
      trace.qaSummary = { required: !!args.requireQa, passed: true };
      refreshTraceArtifacts(trace, layout);
      writeTrace(layout, trace);
    }

    runNode('final contract validation', layout.enforceContractPath, validationArgs('final', args, layout), layout, env);
    trace.finalValidation = { passed: true, timestamp: new Date().toISOString() };
    trace.validation = { passed: true, timestamp: new Date().toISOString() };
    trace.completedTimeMs = Date.now();
    trace.completedAt = new Date(trace.completedTimeMs).toISOString();
    refreshTraceArtifacts(trace, layout);
    writeTrace(layout, trace);
    console.log(`[slide-pipeline] trace written: ${layout.tracePath}`);
  } catch (err) {
    trace.validation = { passed: false, error: err.message, timestamp: new Date().toISOString() };
    trace.completedTimeMs = Date.now();
    trace.completedAt = new Date(trace.completedTimeMs).toISOString();
    refreshTraceArtifacts(trace, layout);
    try { writeTrace(layout, trace); } catch (_) {}
    throw err;
  }
}

try {
  main();
} catch (err) {
  console.error(`[slide-pipeline] ERROR: ${err.message}`);
  process.exit(1);
}




