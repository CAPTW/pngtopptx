'use strict';

const fs = require('fs');
const path = require('path');

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

function recordText(content, x, y, w, h, source) {
  record({ type: 'text', x, y, w, h, textLength: textLength(content), editable: true, source: source || 'surface.txt' });
}

function recordImage(file, x, y, w, h) {
  const meta = classifyImage(file);
  record({ type: meta.type, x, y, w, h, textLength: 0, editable: meta.editable, source: meta.source });
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
