#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-font-provenance-'));
process.env.DECK_PROJECT_ROOT = tempRoot;
process.env.DECK_FONT = 'Arial';
process.env.DECK_FONT_FALLBACK = 'Arial';
process.env.DECK_FONT_INSTALL_DECISION = 'declined';
process.env.DECK_FONT_RESOLUTION_MANIFEST = path.join(tempRoot, 'out', 'font_resolution_manifest.json');

try {
  const missing = `Codex Missing Run Font ${Date.now()}`;
  const OM = require('./lib/object_manifest');
  const { makePptxSurface } = require('./lib/atoms_pptx');
  const { persistFontResolutionManifest } = require('./lib/kit');
  const calls = [];
  const fakePptx = { ShapeType:{ roundRect:'roundRect', ellipse:'ellipse', chevron:'chevron', line:'line' } };
  const fakeSlide = {
    addText(content, options){ calls.push({ content, options }); },
    addShape(){}, addImage(){},
  };
  OM.reset();
  OM.setCurrentSlide(1);
  OM.setEnabled(true);
  const surface = makePptxSurface(fakePptx, fakeSlide);
  surface.txt([{ text:'Original font', fontFace:missing }], 10, 10, 300, 50, { fontFace:missing, sz:20 });
  OM.setEnabled(false);
  assert.strictEqual(calls.length, 1);
  assert.notStrictEqual(calls[0].options.fontFace, missing, 'Missing original font must be replaced only after declined decision');
  assert.strictEqual(calls[0].content[0].options.fontFace, calls[0].options.fontFace, 'Run and text box must use the same resolved fallback');
  const native = OM.toJSON();
  const text = native.slides['1'].objects.find(obj => obj.type === 'text');
  assert.strictEqual(text.originalFont, missing);
  assert.strictEqual(text.resolvedFont, calls[0].options.fontFace);
  assert(text.fontMappings.some(mapping => mapping.original === missing && mapping.resolved === calls[0].options.fontFace));

  const manifest = persistFontResolutionManifest();
  const mapping = manifest.mappings.find(row => row.original === missing);
  assert(mapping && mapping.resolved === calls[0].options.fontFace);
  assert.strictEqual(mapping.automaticInstallationAttempted, false);
  console.log('font provenance rendering tests passed');
} finally {
  fs.rmSync(tempRoot, { recursive:true, force:true });
}
