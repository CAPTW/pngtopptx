#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEXTUAL = new Set(['text', 'table', 'chart', 'label', 'bullet', 'mixed_text_visual']);
const DENSE = new Set(['dense_infographic', 'unspecified']);
const PHOTO = new Set(['photoreal', '3d', 'continuous_tone']);
const LEGACY_METADATA_RE = /legacy crop metadata not supplied/i;

function usage() {
  console.log(`Usage: node scripts/generate_evidence.js [options]

Options:
  --project <path>     Deck project root. Defaults to current working directory.
  --slides <list>      Comma-separated slide numbers.
  --pxw <number>       Source width. Defaults to DECK_PXW or 1672.
  --pxh <number>       Source height. Defaults to DECK_PXH or 941.
  --quality <mode>     canary | preservation | reconstruction.
  --help               Show this help.

Writes:
  out/crop_coverage_summary.json
  out/qa_evidence_summary.json`);
}

function parseArgs(argv) {
  const args = { project: process.cwd(), slides: null, pxw: process.env.DECK_PXW || 1672, pxh: process.env.DECK_PXH || 941, quality: 'reconstruction' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--slides') args.slides = argv[++i];
    else if (a === '--pxw') args.pxw = argv[++i];
    else if (a === '--pxh') args.pxh = argv[++i];
    else if (a === '--quality') args.quality = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function resolveProject(root, p) { return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p); }
function fileExists(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function parseSlides(value) {
  if (!value) return null;
  const slides = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (!slides.length) throw new Error(`Invalid --slides value: ${value}`);
  return [...new Set(slides)].sort((a, b) => a - b);
}

function inferSlides(projectRoot) {
  const out = new Set();
  const src = path.join(projectRoot, 'src');
  if (fs.existsSync(src)) for (const name of fs.readdirSync(src)) { const m = /^slide(\d+)\./i.exec(name); if (m) out.add(Number(m[1])); }
  const work = path.join(projectRoot, 'work');
  if (fs.existsSync(work)) for (const name of fs.readdirSync(work)) { const m = /^slide(\d+)$/i.exec(name); if (m) out.add(Number(m[1])); }
  return [...out].sort((a, b) => a - b);
}

function normalizeCrops(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.crops)) return data.crops;
  if (Array.isArray(data.assets)) return data.assets;
  if (data.slides && typeof data.slides === 'object') {
    return Object.entries(data.slides).flatMap(([slide, crops]) => Array.isArray(crops) ? crops.map(c => ({ slide: Number(slide), ...c })) : []);
  }
  if (typeof data === 'object') return Object.entries(data).filter(([, v]) => v && typeof v === 'object').map(([name, v]) => ({ name, ...v }));
  return [];
}

function loadCropEntries(projectRoot) {
  const manifestPath = path.join(projectRoot, 'assets', 'manifest.json');
  const cropPlanPath = path.join(projectRoot, 'work', 'crop_plan.json');
  let entries = [];
  const sources = [];
  if (fileExists(cropPlanPath)) { entries = entries.concat(normalizeCrops(readJson(cropPlanPath))); sources.push(cropPlanPath); }
  if (fileExists(manifestPath)) {
    const manifest = normalizeCrops(readJson(manifestPath));
    const byName = new Map(entries.map(c => [String(c.name || ''), c]));
    for (const crop of manifest) byName.set(String(crop.name || ''), Object.assign({}, byName.get(String(crop.name || '')) || {}, crop));
    entries = [...byName.values()];
    sources.push(manifestPath);
  }
  return { entries, sources, manifestPath, cropPlanPath };
}

function areaRatio(crop, pxw, pxh) {
  const w = Number(crop.w || crop.width || 0);
  const h = Number(crop.h || crop.height || 0);
  return w > 0 && h > 0 && pxw > 0 && pxh > 0 ? (w * h) / (pxw * pxh) : 0;
}

function isLegacyMetadata(crop) {
  return crop.metadataComplete === false ||
    crop.metadata_complete === false ||
    crop.metadataSource === 'legacy_default' ||
    crop.metadata_source === 'legacy_default' ||
    LEGACY_METADATA_RE.test(String(crop.reconstruction_reason || crop.reconstructionReason || ''));
}

function metadataComplete(crop, type) {
  return !!(type &&
    (crop.reconstruction_reason || crop.reconstructionReason) &&
    (crop.editable_replacement || crop.editableReplacement) &&
    !isLegacyMetadata(crop));
}

function makeCropSummary(projectRoot, slides, pxw, pxh) {
  const loaded = loadCropEntries(projectRoot);
  const summary = { generatedAt: new Date().toISOString(), source: 'work/crop_plan.json + assets/manifest.json', pxw, pxh, sources: loaded.sources, slides: {} };
  for (const slide of slides) {
    const crops = loaded.entries.filter(c => Number(c.slide) === Number(slide));
    let total = 0, largest = 0, textOrTable = 0, dense = 0, photo = 0;
    const outCrops = crops.map(c => {
      const type = String(c.content_type || c.contentType || '').toLowerCase();
      const ratio = areaRatio(c, pxw, pxh);
      total += ratio;
      largest = Math.max(largest, ratio);
      if (TEXTUAL.has(type)) textOrTable += ratio;
      if (DENSE.has(type)) dense += ratio;
      if (PHOTO.has(type)) photo += ratio;
      return {
        name: c.name || '',
        content_type: type || '',
        areaRatio: Number(ratio.toFixed(6)),
        editable_replacement: c.editable_replacement || c.editableReplacement || '',
        allow_large_crop: c.allow_large_crop === true,
        reason: c.reason || '',
        reconstruction_reason: c.reconstruction_reason || c.reconstructionReason || '',
        metadataComplete: metadataComplete(c, type),
        metadataSource: c.metadataSource || c.metadata_source || '',
        missingMetadata: c.missingMetadata || c.missing_metadata || [],
      };
    });
    summary.slides[String(slide)] = {
      totalCropAreaRatio: Number(total.toFixed(6)),
      largestCropAreaRatio: Number(largest.toFixed(6)),
      textOrTableCropAreaRatio: Number(textOrTable.toFixed(6)),
      denseInfographicCropAreaRatio: Number(dense.toFixed(6)),
      photorealCropAreaRatio: Number(photo.toFixed(6)),
      crops: outCrops,
    };
  }
  return summary;
}

function normalizeEvidencePath(projectRoot, p) {
  if (!p) return '';
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(projectRoot, p);
}

function makeQaEvidenceSummary(projectRoot, slides) {
  const summary = { generatedAt: new Date().toISOString(), source: 'work/slideXX/qa_evidence.json', slides: {} };
  for (const slide of slides) {
    const id = String(slide).padStart(2, '0');
    const evidencePath = path.join(projectRoot, 'work', `slide${id}`, 'qa_evidence.json');
    const record = { evidencePath, exists: fileExists(evidencePath), status: 'missing', hashesValid: false, checkedBy: '', checkedAt: '', visualComparison: null, missingFiles: [] };
    if (record.exists) {
      try {
        const ev = readJson(evidencePath);
        record.status = ev.visualComparison && ev.visualComparison.status || 'missing';
        record.checkedBy = ev.checkedBy || '';
        record.checkedAt = ev.checkedAt || '';
        record.visualComparison = ev.visualComparison || null;
        let hashesChecked = 0;
        let hashesOk = 0;
        for (const [pathKey, hashKey] of [['sourceImage', 'sourceHash'], ['pptxRaster', 'pptxRasterHash'], ['htmlScreenshot', 'htmlScreenshotHash']]) {
          const file = normalizeEvidencePath(projectRoot, ev[pathKey]);
          if (file && ev[hashKey]) {
            hashesChecked += 1;
            if (!fileExists(file)) record.missingFiles.push(file);
            else if (sha256(file) === ev[hashKey]) hashesOk += 1;
          }
        }
        record.hashesValid = hashesChecked > 0 && hashesChecked === hashesOk && record.missingFiles.length === 0;
      } catch (err) {
        record.status = 'invalid';
        record.error = err.message;
      }
    }
    summary.slides[String(slide)] = record;
  }
  return summary;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  const projectRoot = resolveProject(process.cwd(), args.project);
  const outDir = path.join(projectRoot, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const slides = parseSlides(args.slides) || inferSlides(projectRoot);
  if (!slides.length) throw new Error('No slides found. Pass --slides or provide src/slideN.png/work/slideXX.');
  const pxw = Number(args.pxw || 1672);
  const pxh = Number(args.pxh || 941);
  const cropSummary = makeCropSummary(projectRoot, slides, pxw, pxh);
  const qaSummary = makeQaEvidenceSummary(projectRoot, slides);
  fs.writeFileSync(path.join(outDir, 'crop_coverage_summary.json'), JSON.stringify(cropSummary, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'qa_evidence_summary.json'), JSON.stringify(qaSummary, null, 2), 'utf8');
  console.log(`wrote ${path.join(outDir, 'crop_coverage_summary.json')}`);
  console.log(`wrote ${path.join(outDir, 'qa_evidence_summary.json')}`);
}

try { main(); }
catch (err) { console.error(`[generate-evidence] ERROR: ${err.message}`); process.exit(1); }
