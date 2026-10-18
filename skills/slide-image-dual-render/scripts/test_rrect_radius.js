#!/usr/bin/env node
'use strict';

// Pure surface/OOXML checks: no browser, rasterizer, font binary, or slide build.
process.env.DECK_PXW = '640';
process.env.DECK_PXH = '360';
process.env.DECK_FONT = 'sans-serif';
process.env.DECK_PROFILE = '';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const { makePptxSurface, ix, iy, linePt } = require('./lib/atoms_pptx');
const { makeHtmlSurface } = require('./lib/atoms_html');
const OM = require('./lib/object_manifest');

const pptx = new PptxGenJS();
const box = [7, 11, 137, 53];
const style = { fill:'123456', fillTrans:35, line:'654321', lineW:0, shadow:true };
const radiusInches = value => +(value * 13.333 / 640).toFixed(3);

function capture(options) {
  const calls = [];
  const slide = { addShape(type, opts) { calls.push({ type, options:opts }); } };
  makePptxSurface(pptx, slide).rrect(...box, options);
  assert.equal(calls.length, 1);
  return calls[0];
}

function html(options) {
  const surface = makeHtmlSurface();
  surface.rrect(...box, options);
  return surface._html();
}

async function serializedGeometry(options) {
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  makePptxSurface(deck, deck.addSlide()).rrect(...box, options);
  const buffer = await deck.write({ outputType:'nodebuffer' });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  const match = /<a:prstGeom prst="([^"]+)">([\s\S]*?)<\/a:prstGeom>/.exec(xml);
  assert.ok(match, 'actual PptxGenJS output must contain preset geometry');
  return { type:match[1], adjustments:match[2] };
}

test('explicit numeric zero uses square PPTX geometry matching the HTML surface', () => {
  assert.match(html({ ...style, radius:0 }), /border-radius:0px;/);
  const call = capture({ ...style, radius:0 });
  assert.equal(call.type, pptx.ShapeType.rect);
  assert.equal(call.options.rectRadius, 0);
});

test('negative numeric zero also uses square PPTX geometry', () => {
  assert.equal(capture({ radius:-0 }).type, pptx.ShapeType.rect);
});

test('positive radii keep roundRect and the existing source-pixel conversion', () => {
  // A small positive radius that rounds to zero must not acquire new semantics.
  for (const radius of [12, 9, 0.00001]) {
    const call = capture({ ...style, radius });
    assert.equal(call.type, pptx.ShapeType.roundRect);
    assert.equal(call.options.rectRadius, radiusInches(radius));
    assert.ok(html({ ...style, radius }).includes(`border-radius:${radius}px;`));
  }
});

test('omitted, undefined, and null radii retain the nine-pixel rounded default', () => {
  for (const options of [undefined, {}, { radius:undefined }, { radius:null }]) {
    const call = capture(options);
    assert.equal(call.type, pptx.ShapeType.roundRect);
    assert.equal(call.options.rectRadius, radiusInches(9));
    assert.match(html(options), /border-radius:9px;/);
  }
});

test('the zero-radius change preserves geometry, styling, and editable panel records', () => {
  OM.reset();
  OM.setEnabled(true);
  OM.setCurrentSlide(1);
  try {
    const zero = capture({ ...style, radius:0 });
    const positive = capture({ ...style, radius:12 });
    assert.deepEqual(zero.options, { ...positive.options, rectRadius:0 });
    assert.deepEqual(zero.options, {
      x:ix(box[0]), y:iy(box[1]), w:ix(box[2]), h:iy(box[3]),
      fill:{ color:'123456', transparency:35 },
      line:{ color:'654321', width:linePt(0) },
      rectRadius:0,
      shadow:{ type:'outer', color:'000000', blur:6, offset:2, angle:90, opacity:0.45 },
    });
    const recorded = OM.toJSON().slides['1'];
    assert.deepEqual(recorded.objects[0], recorded.objects[1]);
    assert.equal(recorded.objects[0].source, 'surface.rrect');
    assert.equal(recorded.objects[0].type, 'panel');
    assert.equal(recorded.objects[0].editable, true);
    assert.equal(recorded.counts.panels, 2);
  } finally {
    OM.reset();
  }
});

test('actual PptxGenJS serialization emits rect for explicit zero', async () => {
  const geometry = await serializedGeometry({ ...style, radius:0 });
  assert.equal(geometry.type, 'rect');
  assert.doesNotMatch(geometry.adjustments, /<a:gd /);
});

test('actual PptxGenJS serialization retains positive rounded adjustments', async () => {
  const geometry = await serializedGeometry({ ...style, radius:12 });
  assert.equal(geometry.type, 'roundRect');
  assert.match(geometry.adjustments, /<a:gd name="adj" fmla="val [1-9][0-9]*"\s*\/>/);
});

test('actual PptxGenJS serialization retains the omitted-radius rounded default', async () => {
  const geometry = await serializedGeometry(style);
  assert.equal(geometry.type, 'roundRect');
  assert.match(geometry.adjustments, /<a:gd name="adj" fmla="val [1-9][0-9]*"\s*\/>/);
});
