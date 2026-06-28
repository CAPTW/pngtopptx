#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CROP_TYPES = new Set(['photoreal', '3d', 'continuous_tone', 'text', 'table', 'chart', 'label', 'bullet', 'dense_infographic', 'mixed_text_visual', 'decorative', 'unspecified']);
const TEXTUAL_TYPES = new Set(['text', 'table', 'chart', 'label', 'bullet', 'dense_infographic', 'mixed_text_visual']);
const COUNT_MAP = { text: 'text', panels: 'panels', rules: 'rules', icons: 'icons', tables: 'tables', charts: 'charts', badges: 'badges', callouts: 'callouts' };
const LEGACY_METADATA_RE = /legacy crop metadata not supplied/i;

function usage() {
  console.log(`Usage: node scripts/enforce_reconstruction.js [options]

Options:
  --project <path>        Deck project root. Defaults to current working directory.
  --slides <list>         Comma-separated slide numbers, for example 1,2,3.
  --quality <mode>        canary | preservation | reconstruction.
  --trace <path>          Trace path. Defaults to out/render_trace.json.
  --help                  Show this help.

Reconstruction mode validates worker claims against objective evidence:
  out/native_object_manifest.json
  out/crop_coverage_summary.json
  out/qa_evidence_summary.json
  work/slideXX/qa_evidence.json`);
}

function parseArgs(argv) {
  const args = { project: process.cwd(), slides: null, quality: null, trace: path.join('out', 'render_trace.json'), help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--slides') args.slides = argv[++i];
    else if (a === '--quality') args.quality = argv[++i];
    else if (a === '--trace') args.trace = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function resolvePath(root, p) { return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p); }
function fileExists(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function safeRead(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function slideDir(projectRoot, slide) { return path.join(projectRoot, 'work', `slide${String(slide).padStart(2, '0')}`); }

function readJson(file, errors, label = file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { errors.push(`invalid JSON in ${label}: ${err.message}`); return null; }
}

function readJsonStrict(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function parseSlides(value) {
  if (!value) return null;
  const slides = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (!slides.length) throw new Error(`Invalid --slides value: ${value}`);
  return [...new Set(slides)].sort((a, b) => a - b);
}

function inferSlides(projectRoot, trace) {
  const out = new Set();
  if (trace && Array.isArray(trace.slides)) trace.slides.forEach(n => Number.isInteger(Number(n)) && out.add(Number(n)));
  if (trace && typeof trace.SLIDES === 'string') trace.SLIDES.split(',').forEach(s => { const n = Number(s.trim()); if (Number.isInteger(n) && n > 0) out.add(n); });
  const src = path.join(projectRoot, 'src');
  if (fs.existsSync(src)) for (const name of fs.readdirSync(src)) { const m = /^slide(\d+)\.(png|jpe?g|webp)$/i.exec(name); if (m) out.add(Number(m[1])); }
  const work = path.join(projectRoot, 'work');
  if (fs.existsSync(work)) for (const name of fs.readdirSync(work)) { const m = /^slide(\d+)$/i.exec(name); if (m) out.add(Number(m[1])); }
  return [...out].sort((a, b) => a - b);
}

function normalizeCropList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.crops)) return value.crops;
  if (value.slides && typeof value.slides === 'object') return Object.entries(value.slides).flatMap(([slide, crops]) => Array.isArray(crops) ? crops.map(c => ({ slide: Number(slide), ...c })) : []);
  if (typeof value === 'object') return Object.entries(value).flatMap(([key, crops]) => {
    const m = /(?:slide)?(\d+)/i.exec(key);
    const slide = m ? Number(m[1]) : undefined;
    return Array.isArray(crops) ? crops.map(c => ({ slide, ...c })) : [];
  });
  return [];
}

function findException(score, predicate) {
  const exceptions = Array.isArray(score && score.exceptions) ? score.exceptions : [];
  return exceptions.find(predicate);
}

function hasTextualCropException(score, crop) {
  if (!(crop.allow_large_crop === true || String(crop.reason || '').trim())) return false;
  return !!findException(score, e => JSON.stringify(e).toLowerCase().includes(String(crop.name || '').toLowerCase()) || JSON.stringify(e).toLowerCase().includes(String(crop.content_type || '').toLowerCase()));
}

function hasIncompleteCropMetadata(crop) {
  return crop.metadataComplete === false ||
    crop.metadata_complete === false ||
    crop.metadataSource === 'legacy_default' ||
    crop.metadata_source === 'legacy_default' ||
    !String(crop.content_type || crop.contentType || '').trim() ||
    !String(crop.reconstruction_reason || crop.reconstructionReason || '').trim() ||
    !String(crop.editable_replacement || crop.editableReplacement || '').trim() ||
    LEGACY_METADATA_RE.test(String(crop.reconstruction_reason || crop.reconstructionReason || ''));
}

function loadTrace(projectRoot, tracePath) {
  const file = resolvePath(projectRoot, tracePath);
  if (!fileExists(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function inferQuality(args, trace) {
  if (args.quality) return args.quality;
  const outputs = [trace && (trace.pptxOut || trace.generatedPptxPath), trace && (trace.htmlOut || trace.generatedHtmlPath)].filter(Boolean).join(' ').toLowerCase();
  if (outputs.includes('canary')) return 'canary';
  return 'reconstruction';
}

function loadObjectiveEvidence(projectRoot, quality, errors) {
  const files = {
    native: path.join(projectRoot, 'out', 'native_object_manifest.json'),
    crops: path.join(projectRoot, 'out', 'crop_coverage_summary.json'),
    qa: path.join(projectRoot, 'out', 'qa_evidence_summary.json'),
  };
  const out = { files, native: null, crops: null, qa: null };
  if (quality !== 'reconstruction') return out;
  for (const [key, file] of Object.entries(files)) {
    if (!fileExists(file)) { errors.push(`missing objective evidence file: ${path.relative(projectRoot, file)}`); continue; }
    try { out[key] = readJsonStrict(file); }
    catch (err) { errors.push(`invalid objective evidence JSON ${file}: ${err.message}`); }
  }
  return out;
}

function objectiveSlide(evidence, slide) {
  const key = String(slide);
  return {
    native: evidence.native && evidence.native.slides ? evidence.native.slides[key] : null,
    crop: evidence.crops && evidence.crops.slides ? evidence.crops.slides[key] : null,
    qa: evidence.qa && evidence.qa.slides ? evidence.qa.slides[key] : null,
  };
}

function validateReceipt(projectRoot, slide, receipt, errors) {
  if (!receipt) return;
  const id = String(slide).padStart(2, '0');
  if (receipt.slide !== slide) errors.push(`slide ${slide}: worker_receipt.slide is ${receipt.slide}`);
  if (receipt.worker !== 'slide_reconstruct_worker') errors.push(`slide ${slide}: worker_receipt.worker must be slide_reconstruct_worker`);
  if (receipt.status !== 'completed') errors.push(`slide ${slide}: worker_receipt.status must be completed`);
  if (receipt.sharedFilesEdited !== false) errors.push(`slide ${slide}: worker_receipt.sharedFilesEdited must be false`);
  if (!Array.isArray(receipt.artifacts)) errors.push(`slide ${slide}: worker_receipt.artifacts must be an array`);
  const artifacts = new Set(Array.isArray(receipt.artifacts) ? receipt.artifacts : []);
  for (const name of ['measurements.json', 'profile_override.json', 'crop_plan.json', `s${slide}.fragment.js`, 'editability_inventory.md', 'reconstruction_score.json', 'qa_report.md']) {
    if (!artifacts.has(name)) errors.push(`slide ${slide}: worker_receipt missing artifact ${name}`);
  }
  if (artifacts.has('qa_report.md') && !fileExists(path.join(projectRoot, 'work', `slide${id}`, 'qa_report.md'))) errors.push(`slide ${slide}: worker_receipt claims qa_report.md but file is missing`);
}

function validateWorkerScore(slide, score, cropEntries, objective, errors) {
  if (!score || typeof score !== 'object') return;
  if (score.slide !== slide) errors.push(`slide ${slide}: reconstruction_score.slide is ${score.slide}`);
  if (score.quality !== 'reconstruction') errors.push(`slide ${slide}: reconstruction_score.quality must be "reconstruction" in reconstruction mode`);
  if (score.status !== 'pass') errors.push(`slide ${slide}: reconstruction_score.status is ${JSON.stringify(score.status)}, expected "pass"`);

  const src = score.sourceCoverage || {};
  for (const key of ['headerRebuilt', 'titleRebuilt', 'bodyStructureRebuilt', 'footerRebuilt']) if (src[key] !== true) errors.push(`slide ${slide}: sourceCoverage.${key} must be true`);

  const actualCounts = objective.native && objective.native.counts ? objective.native.counts : {};
  const reportedCounts = score.nativeObjectCounts || {};
  for (const [reportedKey, actualKey] of Object.entries(COUNT_MAP)) {
    const reported = Number(reportedCounts[reportedKey] || 0);
    const actual = Number(actualCounts[actualKey] || 0);
    if (!Number.isFinite(reported)) errors.push(`slide ${slide}: nativeObjectCounts.${reportedKey} must be numeric`);
    if (reported > actual) errors.push(`slide ${slide}: worker claims ${reported} ${reportedKey}, but native_object_manifest has ${actual}`);
  }

  const actualText = Number(actualCounts.text || 0);
  const actualEditableObjects = Number(objective.native && objective.native.editableObjectCount || 0);
  const actualTextLen = Number(objective.native && objective.native.editableTextLength || 0);
  const textThresholdException = findException(score, e => /native.*text|text.*threshold|min.*text/i.test(JSON.stringify(e)) && /reason/i.test(JSON.stringify(e)));
  if (actualText < 8 && !textThresholdException) errors.push(`slide ${slide}: actual native text object count ${actualText} is below reconstruction threshold 8`);
  if (actualEditableObjects < 12 && !textThresholdException) errors.push(`slide ${slide}: actual editable object count ${actualEditableObjects} is below reconstruction threshold 12`);
  if (actualTextLen < 80 && !textThresholdException) errors.push(`slide ${slide}: actual editable text length ${actualTextLen} is too low for production reconstruction`);

  const actualCoverage = objective.crop || {};
  const reportedCoverage = score.cropCoverage || {};
  for (const key of ['totalCropAreaRatio', 'largestCropAreaRatio', 'textOrTableCropAreaRatio', 'photorealCropAreaRatio', 'denseInfographicCropAreaRatio']) {
    if (!Number.isFinite(Number(reportedCoverage[key]))) errors.push(`slide ${slide}: cropCoverage.${key} must be numeric`);
    const reported = Number(reportedCoverage[key] || 0);
    const actual = Number(actualCoverage[key] || 0);
    if (Math.abs(reported - actual) > 0.02) errors.push(`slide ${slide}: reconstruction_score cropCoverage.${key}=${reported} disagrees with objective summary ${actual}`);
  }

  const imageLedException = findException(score, e => /image-led|image led|photoreal|continuous|3d/i.test(JSON.stringify(e)) && /reason/i.test(JSON.stringify(e)));
  if (Number(actualCoverage.largestCropAreaRatio || 0) > 0.35) errors.push(`slide ${slide}: objective largestCropAreaRatio ${actualCoverage.largestCropAreaRatio} exceeds 0.35`);
  if (Number(actualCoverage.totalCropAreaRatio || 0) > 0.45 && !imageLedException) errors.push(`slide ${slide}: objective totalCropAreaRatio ${actualCoverage.totalCropAreaRatio} exceeds 0.45 without image-led exception`);
  if (Number(actualCoverage.textOrTableCropAreaRatio || 0) > 0.10) errors.push(`slide ${slide}: objective textOrTableCropAreaRatio ${actualCoverage.textOrTableCropAreaRatio} exceeds 0.10`);
  if (Number(actualCoverage.denseInfographicCropAreaRatio || 0) > 0.25) errors.push(`slide ${slide}: objective denseInfographicCropAreaRatio ${actualCoverage.denseInfographicCropAreaRatio} exceeds 0.25`);

  for (const crop of (objective.crop && objective.crop.crops || cropEntries)) {
    const type = String(crop.content_type || crop.contentType || '').toLowerCase();
    if (!type || !CROP_TYPES.has(type)) errors.push(`slide ${slide}: crop ${crop.name || '(unnamed)'} has invalid or missing content_type`);
    if (!String(crop.reconstruction_reason || '').trim()) errors.push(`slide ${slide}: crop ${crop.name || '(unnamed)'} missing reconstruction_reason`);
    if (!String(crop.editable_replacement || '').trim()) errors.push(`slide ${slide}: crop ${crop.name || '(unnamed)'} missing editable_replacement`);
    if (hasIncompleteCropMetadata(crop)) errors.push(`slide ${slide}: crop ${crop.name || '(unnamed)'} has incomplete or legacy objective crop metadata`);
    if (TEXTUAL_TYPES.has(type) && !hasTextualCropException(score, crop)) errors.push(`slide ${slide}: crop ${crop.name || '(unnamed)'} content_type ${type} needs explicit exception in reconstruction_score.json`);
  }

  if (score.status === 'pass' && errors.some(e => e.startsWith(`slide ${slide}: objective`) || e.includes('native_object_manifest') || e.includes('actual native'))) {
    errors.push(`slide ${slide}: reconstruction_score says pass but objective evidence fails`);
  }
}

function validateSlide(projectRoot, slide, quality, evidence) {
  const id = String(slide).padStart(2, '0');
  const dir = slideDir(projectRoot, slide);
  const errors = [];
  const warnings = [];
  const required = ['measurements.json', 'profile_override.json', 'crop_plan.json', 'reconstruction_notes.md', 'editability_inventory.md', 'reconstruction_score.json', 'qa_report.md', 'worker_receipt.json'];
  const fragment = `s${slide}.fragment.js`;

  if (quality === 'canary') {
    if (!fs.existsSync(dir)) warnings.push(`slide ${slide}: no work/slide${id}/ artifacts; canary mode allows this but output is draft only`);
    return { slide, passed: true, errors, warnings, summary: null };
  }

  if (quality === 'preservation') {
    if (!fileExists(path.join(projectRoot, 'out', 'baked_crop_regions.json'))) errors.push(`slide ${slide}: preservation mode requires out/baked_crop_regions.json disclosure`);
    if (!fileExists(path.join(projectRoot, 'out', 'editability_inventory.md'))) errors.push(`slide ${slide}: preservation mode requires out/editability_inventory.md disclosure`);
    return { slide, passed: errors.length === 0, errors, warnings, summary: null };
  }

  const objective = objectiveSlide(evidence, slide);
  if (!objective.native) errors.push(`slide ${slide}: missing objective native object manifest entry`);
  if (!objective.crop) errors.push(`slide ${slide}: missing objective crop coverage summary entry`);
  if (!objective.qa) errors.push(`slide ${slide}: missing objective QA evidence summary entry`);
  if (objective.qa && objective.qa.status !== 'pass') errors.push(`slide ${slide}: objective QA evidence status is ${objective.qa.status}`);
  if (objective.qa && objective.qa.hashesValid !== true) errors.push(`slide ${slide}: objective QA evidence hashes are not valid`);

  if (!fs.existsSync(dir)) errors.push(`slide ${slide}: missing work/slide${id}/ directory`);
  for (const name of required) if (!fileExists(path.join(dir, name))) errors.push(`slide ${slide}: missing work/slide${id}/${name}`);
  if (!fileExists(path.join(dir, 'qa_result.json'))) errors.push(`slide ${slide}: missing work/slide${id}/qa_result.json`);
  if (!fileExists(path.join(dir, 'qa_evidence.json'))) errors.push(`slide ${slide}: missing work/slide${id}/qa_evidence.json`);

  const receiptPath = path.join(dir, 'worker_receipt.json');
  const receipt = fileExists(receiptPath) ? readJson(receiptPath, errors, `work/slide${id}/worker_receipt.json`) : null;
  validateReceipt(projectRoot, slide, receipt, errors);
  const receiptArtifacts = new Set(receipt && Array.isArray(receipt.artifacts) ? receipt.artifacts : []);
  if (!fileExists(path.join(dir, fragment)) && !receiptArtifacts.has(fragment)) errors.push(`slide ${slide}: missing work/slide${id}/${fragment} or merged-fragment receipt`);

  const scorePath = path.join(dir, 'reconstruction_score.json');
  const cropPath = path.join(dir, 'crop_plan.json');
  const score = fileExists(scorePath) ? readJson(scorePath, errors, `work/slide${id}/reconstruction_score.json`) : null;
  const cropPlan = fileExists(cropPath) ? readJson(cropPath, errors, `work/slide${id}/crop_plan.json`) : null;
  const crops = normalizeCropList(cropPlan).filter(c => Number(c.slide || slide) === slide);
  validateWorkerScore(slide, score, crops, objective, errors);

  const qaReport = safeRead(path.join(dir, 'qa_report.md'));
  if (/not\s+run|qa\s+pending|approximate|preservation\s+only|draft/i.test(qaReport)) errors.push(`slide ${slide}: qa_report.md contains draft/non-production wording`);
  const inventory = safeRead(path.join(dir, 'editability_inventory.md'));
  if (/mostly\s+baked|body\s+.*baked|tables?\s+.*baked|body\s+.*crop|preservation\s+only/i.test(inventory)) errors.push(`slide ${slide}: editability_inventory.md indicates body text/tables are mostly baked`);

  const summary = {
    nativeText: Number(objective.native && objective.native.counts && objective.native.counts.text || 0),
    editableObjectCount: Number(objective.native && objective.native.editableObjectCount || 0),
    editableTextLength: Number(objective.native && objective.native.editableTextLength || 0),
    totalCropAreaRatio: Number(objective.crop && objective.crop.totalCropAreaRatio || 0),
    largestCropAreaRatio: Number(objective.crop && objective.crop.largestCropAreaRatio || 0),
    denseInfographicCropAreaRatio: Number(objective.crop && objective.crop.denseInfographicCropAreaRatio || 0),
    qaStatus: objective.qa && objective.qa.status || 'missing',
  };
  return { slide, passed: errors.length === 0, errors, warnings, summary };
}

function runQaValidator(projectRoot, slides) {
  const script = path.join(__dirname, 'enforce_qa.js');
  const result = cp.spawnSync(process.execPath, [script, '--project', projectRoot, '--slides', slides.join(','), '--require-evidence'], { encoding: 'utf8' });
  return { status: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { usage(); return; }
    const projectRoot = resolvePath(process.cwd(), args.project);
    const trace = loadTrace(projectRoot, args.trace);
    const quality = inferQuality(args, trace);
    if (!['canary', 'preservation', 'reconstruction'].includes(quality)) throw new Error(`Invalid quality: ${quality}`);
    const slides = parseSlides(args.slides) || inferSlides(projectRoot, trace);
    if (!slides.length) throw new Error('No selected slides found. Pass --slides or provide trace/src/work slide metadata.');
    const globalErrors = [];
    const evidence = loadObjectiveEvidence(projectRoot, quality, globalErrors);
    const results = slides.map(slide => validateSlide(projectRoot, slide, quality, evidence));
    let qaFailure = null;
    if (quality === 'reconstruction') {
      const qa = runQaValidator(projectRoot, slides);
      if (qa.status !== 0) qaFailure = qa;
    }

    for (const r of results) {
      if (r.summary) console.log(`Objective evidence slide ${r.slide}: nativeText=${r.summary.nativeText}, editableObjects=${r.summary.editableObjectCount}, editableTextLength=${r.summary.editableTextLength}, totalCrop=${r.summary.totalCropAreaRatio}, largestCrop=${r.summary.largestCropAreaRatio}, denseCrop=${r.summary.denseInfographicCropAreaRatio}, qa=${r.summary.qaStatus}`);
      for (const w of r.warnings) console.warn(`Warning: ${w}`);
    }
    const failed = results.filter(r => !r.passed);
    if (globalErrors.length || failed.length || qaFailure) {
      console.error(`Reconstruction validation failed in ${quality} mode:`);
      for (const e of globalErrors) console.error(`- ${e}`);
      for (const r of failed) for (const e of r.errors) console.error(`- ${e}`);
      if (qaFailure) {
        if (qaFailure.stdout.trim()) console.error(qaFailure.stdout.trim());
        if (qaFailure.stderr.trim()) console.error(qaFailure.stderr.trim());
      }
      process.exit(1);
    }
    console.log(`Reconstruction validation passed in ${quality} mode for slides: ${slides.join(',')}`);
  } catch (err) {
    console.error(`Reconstruction validation error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseSlides, inferSlides, validateSlide, normalizeCropList };
