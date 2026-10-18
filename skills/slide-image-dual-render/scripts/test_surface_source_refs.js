#!/usr/bin/env node
'use strict';

// The existing test_text_fit_manifest.js seam: official surfaces, fake slide,
// and explicit unit-test fit inputs. No build, browser, PNG render or PPTX file.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { test } = require('node:test');
process.env.DECK_PXW = '720';
process.env.DECK_PXH = '405';
process.env.DECK_FONT = 'Arial';
process.env.DECK_FONT_FALLBACK = 'Arial';
process.env.DECK_FONT_INSTALL_DECISION = 'declined';
const LIB = process.env.SOURCE_REFS_TEST_LIB || path.join(__dirname, 'lib');
const OM = require(path.join(LIB, 'object_manifest'));
const { makePptxSurface } = require(path.join(LIB, 'atoms_pptx'));
const { makeHtmlSurface } = require(path.join(LIB, 'atoms_html'));
const K = require(path.join(LIB, 'kit'));
const AUTHORITY = Object.fromEntries(['semantic_truth', 'text_removal', 'native_admission', 'vector_eligibility', 'quality_accepted'].map(key => [key, false]));
const clone = value => JSON.parse(JSON.stringify(value));

function metadata(slide = 2, group = 'heading') {
  return {
    schemaVersion:'slide-image-dual-render.source-refs.v1', slide,
    bindings:{jobContentHash:'a'.repeat(64), sourcePngSha256:'b'.repeat(64), measurementInventorySha256:'c'.repeat(64), reviewArtifactSha256:'d'.repeat(64)},
    claim:{kind:'observation', groupId:group, source:{collection:'text_blocks', observation_id:group === 'heading' ? 'T1' : `T_${group}`},
      glyphMembers:group === 'heading' ? [{collection:'region_candidate_evidence.candidates', observation_id:'U01'}] : [], disposition:'linked'},
    authority:clone(AUTHORITY),
  };
}

function setup(kind = 'pptx', options = {}) {
  const slideNo = options.slideNo || 2;
  OM.reset(); OM.setCurrentSlide(slideNo); OM.setEnabled(true);
  const calls = [];
  const slide = {
    addShape(...args) { calls.push({method:'shape', args}); if (options.onShape) options.onShape(); },
    addText(...args) { calls.push({method:'text', args}); },
    addImage(...args) { calls.push({method:'image', args}); },
  };
  const pptx = {ShapeType:{roundRect:'roundRect', ellipse:'ellipse', chevron:'chevron', line:'line'}};
  if (Object.hasOwn(options, 'emitterVersion')) pptx.version = options.emitterVersion;
  const surface = kind === 'pptx' ? makePptxSurface(pptx, slide, {
    slideNo, textFit:{[`${slideNo}:1`]:{fontSizePt:9, shrinkApplied:true}}, textFitSafetyFactor:0.94,
  }) : makeHtmlSurface({slideNo, textOnly:true});
  return {surface, calls, objects:() => OM.toJSON().slides[String(slideNo)].objects};
}

function draw(surface) {
  surface.rrect(10, 20, 80, 30, {radius:6, fill:'112233'});
  surface.ell(120, 20, 30, 30);
  surface.chev(170, 20, 80, 30);
  surface.ln(20, 90, -10, 0);
  surface.txt('Invented heading', 10, 120, 160, 25, {sz:18, shrink:true});
  surface.img('not-read-in-text-only-unit-test.png', 260, 20, 50, 50);
}

// PR1 distinguishes authored surface input from version-qualified PPTX paragraph
// projection. Compare every shared field by name; assert all backend-specific
// fields separately. Unknown fields fail the exhaustive key check, never vanish.
const BASE_FIELDS = ['type', 'x', 'y', 'w', 'h', 'textLength', 'editable', 'source', 'sourceRefs'];
const TEXT_SHARED_FIELDS = [...BASE_FIELDS, 'identityStage', 'textInputSha256',
  'textInputIdentityError', 'textInputSerialization', 'originalFont', 'resolvedFont', 'fontMappings'];
const TEXT_BACKEND_FIELDS = ['textContentSha256', 'textContentEmitterVersion',
  'textContentIdentityError', 'textContentSerialization', 'representation', 'contentEditable'];
const select = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
function assertGeometryContract(row, kind, emitterVersion) {
  if(kind === 'html') {assert(!Object.hasOwn(row,'emitterGeometry'));return;}
  const e=row.emitterGeometry;
  assert.deepEqual(Object.keys(e).sort(),['schemaVersion','emitterVersion','units','status','reason','sourceNormalization','transform'].sort());
  assert.equal(e.schemaVersion,'slide-image-dual-render.emitter-geometry.v1');
  assert.equal(e.emitterVersion,emitterVersion || null);assert.equal(e.units,'EMU');
  assert.equal(e.sourceNormalization,row.source === 'surface.ln' ? 'safe-line-geom-v1' : 'none');
  if(emitterVersion !== '4.0.1') {
    assert.equal(e.status,'UNSUPPORTED');assert.equal(e.reason,'UNVERIFIED_PPTXGENJS_VERSION');assert.equal(e.transform,null);
  } else {
    // This existing known-version control is a finite positive text box.
    assert.equal(row.source,'surface.txt');assert.equal(e.status,'PROJECTED');assert.equal(e.reason,null);
    const emu=(value,extent,pixels)=>Math.round(+(value*extent/pixels).toFixed(3)*914400);
    assert.deepEqual(e.transform,{x:emu(row.x,13.333,720),y:emu(row.y,7.5,405),cx:emu(row.w,13.333,720),cy:emu(row.h,7.5,405),flipH:false,flipV:false,rotation:0});
  }
}
function assertTextContract(row, kind, input, projected, emitterVersion) {
  assert.deepEqual(Object.keys(row).sort(), [...TEXT_SHARED_FIELDS, ...TEXT_BACKEND_FIELDS,...(kind === 'pptx' ? ['emitterGeometry'] : [])].sort());
  assertGeometryContract(row,kind,emitterVersion);
  assert.equal(row.identityStage, 'surface-call');
  assert.equal(row.textInputSha256, hash(input));
  assert.equal(row.textInputIdentityError, null);
  assert.equal(row.textInputSerialization, 'surface-input-text-v1');
  const qualified = emitterVersion === '4.0.1';
  assert.deepEqual(select(row, TEXT_BACKEND_FIELDS), kind === 'pptx' ? {
    textContentSha256:qualified ? hash(projected) : null,
    textContentEmitterVersion:emitterVersion || null,
    textContentIdentityError:qualified ? null : 'UNVERIFIED_PPTXGENJS_VERSION',
    textContentSerialization:'pptxgenjs-paragraph-text-v1', representation:'native-text', contentEditable:true,
  } : {
    textContentSha256:hash(input), textContentEmitterVersion:null, textContentIdentityError:null,
    textContentSerialization:'surface-input-text-v1', representation:'surface-text', contentEditable:false,
  });
}

test('all six official primitives retain explicit metadata and exhaustive backend contracts', () => {
  let expected, expectedSummary;
  for (const kind of ['pptx', 'html']) {
    const run = setup(kind); const tag = metadata();
    draw(run.surface.withSourceRefs(tag));
    const objects = run.objects();
    assert.equal(objects.length, 6);
    assert.deepEqual(objects.map(obj => obj.sourceRefs), Array(6).fill(tag));
    for (const [index, row] of objects.entries()) {
      if (row.type === 'text') {
        assertTextContract(row, kind, 'Invented heading', 'Invented heading', undefined);
        if (expected) assert.deepEqual(select(row, TEXT_SHARED_FIELDS), select(expected[index], TEXT_SHARED_FIELDS));
      } else if (expected) {
        // Only the named, separately checked PPTX projection is backend-local.
        // Every original shared field remains exhaustively compared.
        assertGeometryContract(row,kind,undefined);
        assertGeometryContract(expected[index],'pptx',undefined);
        const {emitterGeometry,...shared}=expected[index];
        assert.deepEqual(row, shared);
      }
    }
    const {objects:unused, ...summary} = OM.toJSON().slides['2'];
    if (expectedSummary) assert.deepEqual(summary, expectedSummary);
    expected = objects; expectedSummary = summary;
    if (kind === 'pptx') {
      assert.equal(run.calls.length, 6);
      assert(!JSON.stringify(run.calls).includes('sourceRefs'));
      assert(!JSON.stringify(run.calls).includes('jobContentHash'));
      assert.equal(run.calls.find(call => call.method === 'text').args[1].fontSize, 8.46);
    }
  }
});

test('known emitter projection and HTML input identities differ without losing shared provenance', () => {
  const cases = [
    {content:'a\r\nb', input:'a\r\nb', projected:'a\n\nb'},
    {content:[{text:'a', breakLine:true}], input:'a\n', projected:'a'},
  ];
  for (const row of cases) {
    let expected;
    for (const kind of ['pptx', 'html']) {
      const run = setup(kind, {emitterVersion:'4.0.1'});
      run.surface.withSourceRefs(metadata()).txt(row.content, 1, 2, 30, 10);
      const actual = run.objects()[0];
      assertTextContract(actual, kind, row.input, row.projected, '4.0.1');
      if (expected) {
        assert.deepEqual(select(actual, TEXT_SHARED_FIELDS), select(expected, TEXT_SHARED_FIELDS));
        assert.notEqual(actual.textContentSha256, expected.textContentSha256);
      }
      expected = actual;
    }
  }
});

test('official kit helper forwards the tagged receiver and keeps separate rows', () => {
  const run = setup(); const tag = metadata();
  K.badge(run.surface.withSourceRefs(tag), 'A', 10, 20, 30);
  assert.deepEqual(run.objects().map(obj => obj.type), ['shape', 'text']);
  assert.deepEqual(run.objects().map(obj => obj.sourceRefs), [tag, tag]);
  assert.equal(OM.toJSON().slides['2'].editableObjectCount, 2);
  // A mixed helper group is propagation only, not role-compatible accounting.
});

test('retained tagged receivers never annotate untagged calls', () => {
  const run = setup(); const tagged = run.surface.withSourceRefs(metadata());
  tagged.txt('First', 0, 0, 20, 10);
  run.surface.txt('Untagged', 0, 20, 20, 10);
  tagged.txt('Last', 0, 40, 20, 10);
  assert.deepEqual(run.objects().map(obj => !!obj.sourceRefs), [true, false, true]);
});

test('nested tagged and untagged calls retain their own receiver provenance', () => {
  let surface, nested, active = false;
  const run = setup('pptx', {onShape() {
    if (!active) {
      active = true;
      nested.ell(0, 0, 5, 5);
      surface.ln(0, 0, 5, 0);
      active = false;
    }
  }});
  surface = run.surface;
  nested = surface.withSourceRefs(metadata(2, 'nested'));
  surface.withSourceRefs(metadata()).rrect(0, 0, 5, 5);
  assert.deepEqual(run.objects().map(obj => obj.sourceRefs?.claim.groupId), ['heading', 'nested', undefined]);
});

test('draw errors cannot leak tags into later or untagged calls', () => {
  let fail = true;
  const run = setup('pptx', {onShape() { if (fail) throw new Error('invented draw failure'); }});
  const tagged = run.surface.withSourceRefs(metadata());
  assert.throws(() => tagged.rrect(0, 0, 5, 5), /invented draw failure/);
  fail = false;
  run.surface.rrect(0, 0, 5, 5);
  tagged.rrect(0, 0, 5, 5);
  assert.deepEqual(run.objects().map(obj => !!obj.sourceRefs), [true, false, true]);
  // The official recorder runs before addShape. That existing limit is retained.
});

test('extracted ordinary methods keep behavior and extracted tagged methods keep provenance', () => {
  const run = setup(); const baseText = run.surface.txt;
  baseText('Ordinary extracted', 1, 2, 30, 10);
  const tagged = run.surface.withSourceRefs(metadata()); const taggedText = tagged.txt;
  taggedText('Tagged extracted', 1, 2, 30, 10);
  taggedText.call(run.surface, 'Explicit base receiver', 1, 2, 30, 10);
  const other = run.surface.withSourceRefs(metadata(2, 'other'));
  taggedText.apply(other, ['Explicit other receiver', 1, 2, 30, 10]);
  assert.deepEqual(run.objects().map(obj => obj.sourceRefs?.claim.groupId), [undefined, 'heading', undefined, 'other']);
  assert.equal(run.calls.length, 4);
});

test('normalization deep-copies and freezes references before any drawing', () => {
  const run = setup(); const tag = metadata(); const expected = clone(tag);
  const tagged = run.surface.withSourceRefs(tag);
  tag.bindings.jobContentHash = 'e'.repeat(64);
  tag.claim.source.observation_id = 'Changed'; tag.claim.glyphMembers.length = 0;
  tagged.txt('Stable', 0, 0, 20, 10);
  const first = run.objects()[0].sourceRefs;
  assert.deepEqual(first, expected);
  assert(Object.isFrozen(first)); assert(Object.isFrozen(first.claim));
  assert(Object.isFrozen(first.claim.glyphMembers)); assert(Object.isFrozen(first.claim.glyphMembers[0]));
  assert.throws(() => { first.claim.source.observation_id = 'Changed'; }, TypeError);
  tagged.txt('Stable again', 0, 20, 20, 10);
  assert.deepEqual(run.objects()[1].sourceRefs, expected);
});

test('wrong surface/recording slide and inconsistent slide bindings fail closed', () => {
  const run = setup();
  assert.throws(() => run.surface.withSourceRefs(metadata(3)), /slide/);
  const tagged = run.surface.withSourceRefs(metadata()); tagged.txt('First', 0, 0, 20, 10);
  const changed = metadata(2, 'second'); changed.bindings.reviewArtifactSha256 = 'e'.repeat(64);
  assert.throws(() => run.surface.withSourceRefs(changed).txt('Mismatch', 0, 0, 20, 10), /bindings/);
  assert.equal(run.objects().length, 1);
  OM.setCurrentSlide(3);
  assert.throws(() => tagged.txt('Wrong recorded slide', 0, 0, 20, 10), /slide/);
  assert.equal(OM.toJSON().slides['3'].objects.length, 0);
});

test('consistent groups repeat across rows but conflicting same-group claims reject', () => {
  const run = setup(); const tagged = run.surface.withSourceRefs(metadata());
  tagged.txt('First', 0, 0, 20, 10); tagged.txt('Second', 0, 20, 20, 10);
  const changed = metadata(); changed.claim.source.observation_id = 'T2';
  assert.throws(() => run.surface.withSourceRefs(changed).txt('Conflict', 0, 0, 20, 10), /group/);
  assert.equal(run.objects().length, 2);
  const duplicate = metadata(); duplicate.claim.groupId = 'another-owner';
  assert.throws(() => run.surface.withSourceRefs(duplicate).txt('Duplicate identity', 0, 0, 20, 10), /duplicate groups/);
  assert.equal(run.objects().length, 2);
  OM.reset(); OM.setCurrentSlide(2); OM.setEnabled(true);
  run.surface.withSourceRefs(changed).txt('Fresh recording', 0, 0, 20, 10);
  assert.equal(run.objects().length, 1);
});

test('malformed, oversized, duplicate, authority-bearing and unknown fields reject', () => {
  const run = setup();
  assert.equal(typeof run.surface.withSourceRefs, 'function');
  const mutations = [
    x => { x.slide = true; }, x => { x.bindings.sourcePngSha256 = 'stale'; },
    x => { x.claim.glyphMembers.push(clone(x.claim.glyphMembers[0])); },
    x => { x.claim.source = 'T1'; }, x => { x.claim.source.collection = 'invented'; },
    x => { x.claim.groupId = 'x'.repeat(65537); }, x => { x.authority.native_admission = true; },
    x => { x.authority.semantic_truth = 0; }, x => { x.claim.disposition = 'accepted'; },
    x => { x.drawingOptions = {fill:'FFFFFF'}; }, x => { x.claim.glyphMembers = [null]; },
    x => { x.claim.source.observation_id = ''; }, x => { x.claim.source.extra = false; },
  ];
  for (const mutation of mutations) { const tag = metadata(); mutation(tag); assert.throws(() => run.surface.withSourceRefs(tag)); }
  for (const tag of [null, [], 'claim']) assert.throws(() => run.surface.withSourceRefs(tag));
  let accessorRead = false; const accessor = metadata();
  Object.defineProperty(accessor.claim, 'kind', {get() { accessorRead = true; return 'observation'; }});
  assert.throws(() => run.surface.withSourceRefs(accessor));
  assert.equal(accessorRead, false);
  assert.equal(run.objects().length, 0);
});

test('unresolved/deferred and explicit extra-purpose claims stay non-authoritative', () => {
  const run = setup();
  for (const disposition of ['unresolved', 'deferred']) {
    const tag = metadata(2, disposition); tag.claim.disposition = disposition; tag.claim.glyphMembers = [];
    run.surface.withSourceRefs(tag).rrect(0, 0, 20, 10);
  }
  for (const purpose of ['decorative', 'background', 'unresolved']) {
    const tag = metadata(2, `extra-${purpose}`); tag.claim = {kind:'extra', groupId:`extra-${purpose}`, purpose};
    run.surface.withSourceRefs(tag).rrect(0, 0, 20, 10);
  }
  assert.equal(run.objects().length, 5);
  assert(run.objects().every(obj => Object.values(obj.sourceRefs.authority).every(value => value === false)));
});

test('same ID in distinct namespaces is preserved; glyph membership never collapses rows', () => {
  const run = setup(); const tag = metadata();
  tag.claim.source.observation_id = 'U01';
  const tagged = run.surface.withSourceRefs(tag);
  tagged.txt('A', 0, 0, 20, 10); tagged.txt('B', 0, 20, 20, 10);
  assert.equal(run.objects().length, 2);
  assert.deepEqual(run.objects()[0].sourceRefs.claim, tag.claim);
});

test('absent tags preserve original surface keys and emitted options/manifest shape', () => {
  const run = setup();
  assert.deepEqual(Object.keys(run.surface), ['_pptx', 'bgFill', 'img', 'rrect', 'ell', 'chev', 'ln', 'txt']);
  draw(run.surface);
  assert(run.objects().every(obj => !Object.hasOwn(obj, 'sourceRefs')));
  assert.deepEqual(run.objects().map(obj => obj.type), ['panel', 'shape', 'shape', 'rule', 'text', 'image']);
  assert.equal(run.calls[4].args[1].fontSize, 8.46);
  assert.equal(OM.toJSON().slides['2'].editableObjectCount, 5);
});
