'use strict';

const fs = require('fs');
const path = require('path');

const state = {
  enabled: false,
  currentSlide: null,
  slides: {},
};

// Receiver-local provenance. No mutable drawing scope or inherited tag state.
const taggedReferences = new WeakMap();
const supportedSurfaces = new WeakMap();
const slideBindings = new Map();
const slideGroups = new Map();
const observationOwners = new Map();
const SOURCE_REFS_SCHEMA = 'slide-image-dual-render.source-refs.v1';
const MAX_SOURCE_REFS_BYTES = 65536; // Per-record transport bound, not a visual policy.
const AUTHORITY_KEYS = ['semantic_truth', 'text_removal', 'native_admission', 'vector_eligibility', 'quality_accepted'];
const SOURCE_COLLECTIONS = ['text_blocks', 'suppressed_text', 'region_candidate_evidence.candidates'];
const PRIMITIVES = ['img', 'rrect', 'ell', 'chev', 'ln', 'txt'];

const COUNT_KEYS = ['text', 'panels', 'rules', 'icons', 'images', 'tables', 'charts', 'badges', 'callouts'];

function reset() {
  state.enabled = false;
  state.currentSlide = null;
  state.slides = {};
  slideBindings.clear();
  slideGroups.clear();
  observationOwners.clear();
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(key => !Object.prototype.hasOwnProperty.call(value, key) ||
        !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    throw new Error(`sourceRefs ${label} has missing or unsupported fields`);
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`sourceRefs ${label} must be a nonempty string`);
  return value;
}

function sourceReference(value) {
  exactObject(value, ['collection', 'observation_id'], 'source reference');
  if (!SOURCE_COLLECTIONS.includes(value.collection)) throw new Error('sourceRefs source collection is unsupported');
  return {collection:value.collection, observation_id:nonempty(value.observation_id, 'observation_id')};
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeSourceRefs(value, slide) {
  exactObject(value, ['schemaVersion', 'slide', 'bindings', 'claim', 'authority'], 'metadata');
  if (value.schemaVersion !== SOURCE_REFS_SCHEMA || !Number.isSafeInteger(value.slide) || value.slide < 1 || value.slide !== slide) {
    throw new Error('sourceRefs schema or slide does not match this surface');
  }
  const bindingKeys = ['jobContentHash', 'sourcePngSha256', 'measurementInventorySha256', 'reviewArtifactSha256'];
  exactObject(value.bindings, bindingKeys, 'bindings');
  const bindings = {};
  for (const key of bindingKeys) {
    if (typeof value.bindings[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value.bindings[key])) throw new Error(`sourceRefs bindings.${key} must be a SHA256`);
    bindings[key] = value.bindings[key];
  }
  exactObject(value.authority, AUTHORITY_KEYS, 'authority');
  if (AUTHORITY_KEYS.some(key => value.authority[key] !== false)) throw new Error('sourceRefs must grant no authority');
  const input = value.claim;
  if (!input || typeof input !== 'object') throw new Error('sourceRefs claim is required');
  const kindDescriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  if (!kindDescriptor || !Object.prototype.hasOwnProperty.call(kindDescriptor, 'value')) throw new Error('sourceRefs claim kind must be a data field');
  let claim;
  if (kindDescriptor.value === 'observation') {
    exactObject(input, ['kind', 'groupId', 'source', 'glyphMembers', 'disposition'], 'observation claim');
    const source = sourceReference(input.source);
    if (!['linked', 'unresolved', 'deferred'].includes(input.disposition)) throw new Error('sourceRefs disposition is unsupported');
    if (!Array.isArray(input.glyphMembers) || Reflect.ownKeys(input.glyphMembers).length !== input.glyphMembers.length + 1) {
      throw new Error('sourceRefs glyphMembers must be a dense plain array');
    }
    const members = [];
    const seen = new Set([JSON.stringify([source.collection, source.observation_id])]);
    for (let index = 0; index < input.glyphMembers.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input.glyphMembers, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('sourceRefs glyphMembers cannot contain accessors or holes');
      const member = sourceReference(descriptor.value);
      const identity = JSON.stringify([member.collection, member.observation_id]);
      if (member.collection !== SOURCE_COLLECTIONS[2] || seen.has(identity)) throw new Error('sourceRefs duplicate or invalid glyph member');
      seen.add(identity); members.push(member);
    }
    if (members.length && (source.collection === SOURCE_COLLECTIONS[2] || input.disposition !== 'linked')) {
      throw new Error('sourceRefs glyph members require a linked protected-text primary claim');
    }
    claim = {kind:'observation', groupId:nonempty(input.groupId, 'groupId'), source, glyphMembers:members, disposition:input.disposition};
  } else if (kindDescriptor.value === 'extra') {
    exactObject(input, ['kind', 'groupId', 'purpose'], 'extra claim');
    if (!['decorative', 'background', 'unresolved'].includes(input.purpose)) throw new Error('sourceRefs extra purpose is unsupported');
    claim = {kind:'extra', groupId:nonempty(input.groupId, 'groupId'), purpose:input.purpose};
  } else {
    throw new Error('sourceRefs claim kind is unsupported');
  }
  const normalized = {schemaVersion:SOURCE_REFS_SCHEMA, slide:value.slide, bindings, claim,
    authority:Object.fromEntries(AUTHORITY_KEYS.map(key => [key, false]))};
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_SOURCE_REFS_BYTES) throw new Error('sourceRefs exceeds the 64 KiB per-record transport bound');
  return freezeTree(normalized);
}

function addSourceReferenceSupport(surface, slide) {
  supportedSurfaces.set(surface, {base:surface, slide});
  Object.defineProperty(surface, 'withSourceRefs', {value:function withSourceRefs(metadata) {
    const support = supportedSurfaces.get(this);
    if (!support) throw new Error('withSourceRefs requires its official surface receiver');
    const references = normalizeSourceRefs(metadata, support.slide);
    const tagged = Object.create(this);
    supportedSurfaces.set(tagged, support);
    taggedReferences.set(tagged, references);
    for (const name of PRIMITIVES) {
      const original = support.base[name];
      tagged[name] = function (...args) {
        // Ordinary explicit call/apply receivers retain their meaning. Extracted
        // tagged methods retain the tagged origin instead of silently losing it.
        return original.apply(this === undefined ? tagged : this, args);
      };
    }
    return tagged;
  }});
  return surface;
}

function sourceRefsFor(receiver, slide) {
  const references = taggedReferences.get(receiver);
  if (references && references.slide !== slide) throw new Error('sourceRefs receiver belongs to a different slide');
  return references;
}

function validateRecordedReferences(references) {
  const slide = state.currentSlide;
  if (String(references.slide) !== slide) throw new Error('sourceRefs slide differs from the recorded slide');
  const binding = JSON.stringify(references.bindings);
  if (slideBindings.has(slide) && slideBindings.get(slide) !== binding) throw new Error('sourceRefs bindings conflict within this slide');
  const groupKey = JSON.stringify([slide, references.claim.groupId]);
  const claim = JSON.stringify(references.claim);
  if (slideGroups.has(groupKey) && slideGroups.get(groupKey) !== claim) throw new Error('sourceRefs group claims conflict within this slide');
  const observations = references.claim.kind === 'observation' ? [references.claim.source, ...references.claim.glyphMembers] : [];
  const identities = observations.map(ref => JSON.stringify([slide, ref.collection, ref.observation_id]));
  for (const identity of identities) {
    if (observationOwners.has(identity) && observationOwners.get(identity) !== groupKey) throw new Error('sourceRefs observation is assigned to duplicate groups');
  }
  slideBindings.set(slide, binding); slideGroups.set(groupKey, claim);
  for (const identity of identities) observationOwners.set(identity, groupKey);
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
  if (Object.prototype.hasOwnProperty.call(out, 'sourceRefs')) out.sourceRefs = normalizeSourceRefs(out.sourceRefs, out.sourceRefs && out.sourceRefs.slide);
  return out;
}

function record(obj, sourceRefs) {
  if (!state.enabled || !state.currentSlide) return;
  const normalized = normalizeObject(sourceRefs === undefined ? obj : Object.assign({}, obj, {sourceRefs}));
  if (normalized.sourceRefs) validateRecordedReferences(normalized.sourceRefs);
  const slide = ensureSlide(state.currentSlide);
  slide.objects.push(normalized);
}

function recordText(content, x, y, w, h, source, fontMeta, sourceRefs) {
  const meta = fontMeta || {};
  const fontMappings = Array.isArray(meta.fontMappings)
    ? meta.fontMappings
      .filter(mapping => mapping && mapping.original && mapping.resolved)
      .map(mapping => ({ original:mapping.original, resolved:mapping.resolved, exact:mapping.exact !== false, fallbackApplied:!!mapping.fallbackApplied }))
    : [];
  record({
    type: 'text', x, y, w, h,
    textLength: textLength(content), editable: true, source: source || 'surface.txt',
    originalFont:meta.originalFont || null,
    resolvedFont:meta.resolvedFont || null,
    fontMappings,
  }, sourceRefs);
}

function recordImage(file, x, y, w, h, sourceRefs) {
  const meta = classifyImage(file);
  record({ type: meta.type, x, y, w, h, textLength: 0, editable: meta.editable, source: meta.source }, sourceRefs);
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
  addSourceReferenceSupport,
  sourceRefsFor,
  reset,
  setEnabled,
  setCurrentSlide,
  record,
  recordText,
  recordImage,
  writeNativeManifest,
  toJSON,
};
