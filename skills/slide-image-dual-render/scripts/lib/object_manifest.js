'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const state = {
  enabled: false,
  currentSlide: null,
  slides: {},
};

const COUNT_KEYS = ['text', 'panels', 'rules', 'icons', 'images', 'tables', 'charts', 'badges', 'callouts'];

function reset() {
  state.enabled = false;
  state.currentSlide = null;
  state.slides = {};
}

function setEnabled(value) {
  state.enabled = !!value;
}

function setCurrentSlide(slide) {
  const n = Number(slide);
  state.currentSlide = Number.isInteger(n) && n > 0 ? String(n) : String(slide || 'unknown');
  ensureSlide(state.currentSlide);
}

function ensureSlide(slide) {
  const key = String(slide);
  if (!state.slides[key]) state.slides[key] = { objects: [] };
  return state.slides[key];
}

function textLength(content) {
  if (Array.isArray(content)) return content.map(r => String(r && r.text != null ? r.text : '')).join('').length;
  return String(content == null ? '' : content).length;
}

function normalizeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function classifyImage(file) {
  const s = String(file || '').replace(/\\/g, '/').toLowerCase();
  if (s.includes('/icons/')) return { type: 'icon', editable: true, source: 'surface.img:icon' };
  return { type: 'image', editable: false, source: 'surface.img' };
}

function normalizeObject(obj) {
  const out = Object.assign({}, obj);
  out.type = out.type || 'shape';
  out.x = normalizeNum(out.x);
  out.y = normalizeNum(out.y);
  out.w = normalizeNum(out.w);
  out.h = normalizeNum(out.h);
  out.textLength = Math.max(0, Number(out.textLength || 0));
  out.editable = out.editable !== false;
  out.source = out.source || 'surface';
  return out;
}

function record(obj) {
  if (!state.enabled || !state.currentSlide) return;
  const slide = ensureSlide(state.currentSlide);
  slide.objects.push(normalizeObject(obj));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Input identity only. A backend can supply its exact logical-text serialization
// through fontMeta; this default does not claim that native PPTX text was emitted.
function surfaceText(content) {
  if (Array.isArray(content)) return content.map(run =>
    String(run && run.text != null ? run.text : '') + (run && run.breakLine ? '\n' : '')
  ).join('');
  return String(content);
}

function recordText(content, x, y, w, h, source, fontMeta) {
  if (!state.enabled || !state.currentSlide) return;
  const meta = fontMeta || {};
  const inputText = surfaceText(content);
  // UTF-8 cannot preserve an unpaired UTF-16 surrogate. Never silently hash its
  // replacement character as though it were the author's exact input.
  const textInputIdentityError = /[\uD800-\uDFFF]/u.test(inputText) ? 'UNSUPPORTED_UNICODE_TEXT' : null;
  const fontMappings = Array.isArray(meta.fontMappings)
    ? meta.fontMappings
      .filter(mapping => mapping && mapping.original && mapping.resolved)
      .map(mapping => ({ original:mapping.original, resolved:mapping.resolved, exact:mapping.exact !== false, fallbackApplied:!!mapping.fallbackApplied }))
    : [];
  record({
    type: 'text', x, y, w, h,
    textLength: textLength(content), editable: true, source: source || 'surface.txt',
    identityStage:'surface-call',
    textInputSha256:textInputIdentityError ? null : sha256(inputText),
    textInputIdentityError,
    textInputSerialization:'surface-input-text-v1',
    textContentSha256:(meta.textContentIdentityError || textInputIdentityError) ? null : sha256(meta.textContent != null ? meta.textContent : inputText),
    textContentEmitterVersion:meta.textContentEmitterVersion || null,
    textContentIdentityError:meta.textContentIdentityError || textInputIdentityError,
    textContentSerialization:meta.textContentSerialization || 'surface-input-text-v1',
    representation:meta.representation || 'surface-text',
    contentEditable:meta.representation === 'native-text',
    originalFont:meta.originalFont || null,
    resolvedFont:meta.resolvedFont || null,
    fontMappings,
  });
}

function recordImage(file, x, y, w, h) {
  if (!state.enabled || !state.currentSlide) return;
  const meta = classifyImage(file);
  // PptxGenJS may read this path later, during write. This digest is the observed
  // input at the surface call, never proof of package contents. Do not cache by
  // pathname: two calls may observe different bytes at the same filename.
  let imageFileSha256 = null;
  let imageIdentityError = null;
  try { imageFileSha256 = sha256(fs.readFileSync(file)); }
  catch (err) { imageIdentityError = err.code || 'IMAGE_READ_FAILED'; }
  record({
    type: meta.type, x, y, w, h, textLength: 0, editable: meta.editable, source: meta.source,
    identityStage:'surface-call', imageSourcePath:String(file), imageFileSha256,
    imageIdentityError,
    representation:/\.(?:png|jpe?g|gif|bmp|webp)$/i.test(String(file)) ? 'raster-image' : 'image-asset',
    // Preserve legacy category/count semantics, but never assert that image
    // pixels (including raster icons) are editable native drawing content.
    contentEditable:false,
  });
}

function countsFor(objects) {
  const counts = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  let editableTextLength = 0;
  let editableObjectCount = 0;
  for (const obj of objects) {
    if (obj.type === 'text') counts.text += 1;
    else if (obj.type === 'panel') counts.panels += 1;
    else if (obj.type === 'rule' || obj.type === 'line') counts.rules += 1;
    else if (obj.type === 'icon') counts.icons += 1;
    else if (obj.type === 'image') counts.images += 1;
    else if (obj.type === 'table') counts.tables += 1;
    else if (obj.type === 'chart') counts.charts += 1;
    else if (obj.type === 'badge') counts.badges += 1;
    else if (obj.type === 'callout') counts.callouts += 1;
    if (obj.editable) editableObjectCount += 1;
    if (obj.type === 'text' && obj.editable) editableTextLength += Number(obj.textLength || 0);
  }
  return { counts, editableTextLength, editableObjectCount };
}

function toJSON() {
  const slides = {};
  for (const [slide, value] of Object.entries(state.slides).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const objects = value.objects.map(normalizeObject);
    const summary = countsFor(objects);
    slides[slide] = {
      objects,
      counts: summary.counts,
      editableTextLength: summary.editableTextLength,
      editableObjectCount: summary.editableObjectCount,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    source: 'actual-render-surface-calls',
    slides,
  };
}

function writeNativeManifest(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = toJSON();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = {
  reset,
  setEnabled,
  setCurrentSlide,
  record,
  recordText,
  recordImage,
  writeNativeManifest,
  toJSON,
};
