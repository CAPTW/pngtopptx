#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function usage() {
  console.log(`Usage: node scripts/enforce_qa.js [options]

Options:
  --project <path>        Deck project root. Defaults to current working directory.
  --slides <list>         Comma-separated slide numbers, for example 1,2,3.
  --require-evidence      Require work/slideXX/qa_evidence.json and verify hashes/visual comparison.
  --help                  Show this help.

Requires each selected slide to provide:
  work/slideXX/qa_report.md
  work/slideXX/qa_result.json

In reconstruction mode, callers must pass --require-evidence. qa_result.json must reference qa_evidence.json.`);
}

function parseArgs(argv) {
  const args = { project: process.cwd(), slides: null, requireEvidence: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--slides') args.slides = argv[++i];
    else if (a === '--require-evidence') args.requireEvidence = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function abs(root, p) { return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p); }
function fileExists(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function parseSlides(value) {
  if (!value) return null;
  const slides = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (!slides.length) throw new Error(`Invalid --slides value: ${value}`);
  return [...new Set(slides)].sort((a, b) => a - b);
}

function inferSlides(projectRoot) {
  const src = path.join(projectRoot, 'src');
  const work = path.join(projectRoot, 'work');
  const out = new Set();
  if (fs.existsSync(src)) for (const name of fs.readdirSync(src)) { const m = /^slide(\d+)\.(png|jpe?g|webp)$/i.exec(name); if (m) out.add(Number(m[1])); }
  if (fs.existsSync(work)) for (const name of fs.readdirSync(work)) { const m = /^slide(\d+)$/i.exec(name); if (m) out.add(Number(m[1])); }
  return [...out].sort((a, b) => a - b);
}

function readJson(file, errors) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { errors.push(`Invalid JSON ${file}: ${err.message}`); return null; }
}

function evidenceReference(result) {
  return result.qaEvidence || result.qaEvidencePath || result.evidence || result.evidencePath || '';
}

function normalizeEvidencePath(projectRoot, value, dir) {
  if (!value) return '';
  if (path.isAbsolute(value)) return path.resolve(value);
  const fromProject = path.resolve(projectRoot, value);
  if (fileExists(fromProject)) return fromProject;
  return path.resolve(dir, value);
}

function validateEvidence(projectRoot, slide, dir, result, errors) {
  const expected = path.join(dir, 'qa_evidence.json');
  const ref = evidenceReference(result);
  if (!ref) errors.push(`slide ${slide}: qa_result.json must reference qa_evidence.json`);
  else if (path.resolve(normalizeEvidencePath(projectRoot, ref, dir)).toLowerCase() !== path.resolve(expected).toLowerCase()) {
    errors.push(`slide ${slide}: qa_result evidence reference must point to work/slide${String(slide).padStart(2, '0')}/qa_evidence.json`);
  }
  if (!fileExists(expected)) { errors.push(`slide ${slide}: missing work/slide${String(slide).padStart(2, '0')}/qa_evidence.json`); return; }
  const ev = readJson(expected, errors);
  if (!ev) return;
  if (ev.slide !== slide) errors.push(`slide ${slide}: qa_evidence.slide is ${ev.slide}`);
  if (!ev.sourceImage) errors.push(`slide ${slide}: qa_evidence.sourceImage is required`);
  if (!ev.sourceHash) errors.push(`slide ${slide}: qa_evidence.sourceHash is required`);
  if (!ev.checkedAt) errors.push(`slide ${slide}: qa_evidence.checkedAt is required`);
  if (!ev.checkedBy) errors.push(`slide ${slide}: qa_evidence.checkedBy is required`);
  const vc = ev.visualComparison || {};
  if (vc.status !== 'pass') errors.push(`slide ${slide}: qa_evidence.visualComparison.status is ${JSON.stringify(vc.status)}, expected pass`);
  if (!vc.method) errors.push(`slide ${slide}: qa_evidence.visualComparison.method is required`);

  const source = normalizeEvidencePath(projectRoot, ev.sourceImage, dir);
  if (!fileExists(source)) errors.push(`slide ${slide}: qa_evidence sourceImage missing: ${source}`);
  else if (ev.sourceHash && sha256(source) !== ev.sourceHash) errors.push(`slide ${slide}: qa_evidence sourceHash mismatch`);

  const raster = normalizeEvidencePath(projectRoot, ev.pptxRaster, dir);
  const html = normalizeEvidencePath(projectRoot, ev.htmlScreenshot, dir);
  const hasRaster = raster && fileExists(raster);
  const hasHtml = html && fileExists(html);
  if (hasRaster && ev.pptxRasterHash && sha256(raster) !== ev.pptxRasterHash) errors.push(`slide ${slide}: qa_evidence pptxRasterHash mismatch`);
  if (hasHtml && ev.htmlScreenshotHash && sha256(html) !== ev.htmlScreenshotHash) errors.push(`slide ${slide}: qa_evidence htmlScreenshotHash mismatch`);
  if (!hasRaster && ev.pptxRaster) errors.push(`slide ${slide}: qa_evidence pptxRaster missing: ${raster}`);
  if (!hasHtml && ev.htmlScreenshot) errors.push(`slide ${slide}: qa_evidence htmlScreenshot missing: ${html}`);
  if (!hasRaster && !hasHtml) {
    if (String(vc.method).toLowerCase() !== 'manual' || !String(vc.notes || '').trim()) {
      errors.push(`slide ${slide}: QA pass without raster/screenshot requires manual method with explicit evidence notes`);
    }
  }
}

function validateSlide(projectRoot, slide, requireEvidence) {
  const id = String(slide).padStart(2, '0');
  const dir = path.join(projectRoot, 'work', `slide${id}`);
  const errors = [];
  const warnings = [];
  const report = path.join(dir, 'qa_report.md');
  const resultFile = path.join(dir, 'qa_result.json');

  if (!fs.existsSync(dir)) errors.push(`slide ${slide}: missing work/slide${id}/ directory`);
  if (!fileExists(report)) errors.push(`slide ${slide}: missing work/slide${id}/qa_report.md`);
  if (!fileExists(resultFile)) errors.push(`slide ${slide}: missing work/slide${id}/qa_result.json`);
  if (!fileExists(resultFile)) return { slide, passed: false, errors, warnings };

  const result = readJson(resultFile, errors);
  if (!result) return { slide, passed: false, errors, warnings };

  if (result.slide !== slide) errors.push(`slide ${slide}: qa_result.json slide field is ${result.slide}`);
  for (const key of ['status', 'visualFidelity', 'nativeEditability', 'cropPolicy']) if (result[key] !== 'pass') errors.push(`slide ${slide}: qa_result.${key} is ${JSON.stringify(result[key])}, expected "pass"`);
  for (const key of ['blockingIssues', 'noticeableIssues', 'minorIssues']) if (!Array.isArray(result[key])) errors.push(`slide ${slide}: qa_result.${key} must be an array`);
  if (Array.isArray(result.blockingIssues) && result.blockingIssues.length) errors.push(`slide ${slide}: blockingIssues is not empty`);

  const reportText = fileExists(report) ? fs.readFileSync(report, 'utf8') : '';
  if (/not\s+run|qa\s+pending|preservation\s+only|approximate|draft/i.test(reportText)) errors.push(`slide ${slide}: qa_report.md contains non-production QA wording`);
  if (requireEvidence) validateEvidence(projectRoot, slide, dir, result, errors);

  return { slide, passed: errors.length === 0, errors, warnings };
}

function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { usage(); return; }
    const projectRoot = abs(process.cwd(), args.project);
    const slides = parseSlides(args.slides) || inferSlides(projectRoot);
    if (!slides.length) throw new Error('No selected slides found. Pass --slides or provide src/slideN.png/work/slideXX directories.');
    const results = slides.map(slide => validateSlide(projectRoot, slide, args.requireEvidence));
    const failed = results.filter(r => !r.passed);
    if (failed.length) {
      console.error('QA validation failed:');
      for (const r of failed) for (const e of r.errors) console.error(`- ${e}`);
      process.exit(1);
    }
    console.log(`QA validation passed for slides: ${slides.join(',')}`);
  } catch (err) {
    console.error(`QA validation error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseSlides, inferSlides, validateSlide };
