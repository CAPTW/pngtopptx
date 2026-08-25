#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.DECK_PXW = '1672';
process.env.DECK_PXH = '941';
process.env.DECK_FONT = 'Arial';
process.env.DECK_FONT_FALLBACK = 'Arial';
process.env.DECK_FONT_INSTALL_DECISION = 'declined';

const { makeHtmlSurface } = require('./lib/atoms_html');
const { makePptxSurface } = require('./lib/atoms_pptx');

const html = makeHtmlSurface({ slideNo:3, textOnly:true });
html.img('this-file-must-not-be-read.png', 0, 0, 20, 20);
html.rrect(0, 0, 20, 20, { fill:'000000' });
html.txt('Measured', 10, 10, 120, 30, { sz:20, shrink:true });
const htmlText = html._html();
assert(htmlText.includes('data-text-fit-id="3:1"'));
assert(htmlText.includes('data-requested-font-size-pt="20"'));
assert(!htmlText.includes('<img'), 'Text-only fit probe must not embed image assets');

const calls = [];
const fakePptx = { ShapeType:{} };
const fakeSlide = {
  addText(content, options){ calls.push({ content, options }); },
  addShape(){}, addImage(){},
};
const surface = makePptxSurface(fakePptx, fakeSlide, {
  slideNo:3,
  textFit:{
    '3:1':{ requestedFontSizePt:20, fontSizePt:8.5, shrinkApplied:true },
    '3:2':{ requestedFontSizePt:20, fontSizePt:7, shrinkApplied:true },
  },
  textFitSafetyFactor:0.94,
});
surface.txt([{ text:'Measured' }], 10, 10, 120, 30, { sz:20, shrink:true });
surface.txt([{ text:'Do not shrink' }], 10, 50, 120, 30, { sz:20, shrink:false });

assert.strictEqual(calls[0].options.fontSize, 7.99, 'PPTX text box must apply the measured fit size and cross-renderer safety factor');
assert.strictEqual(calls[0].content[0].options.fontSize, 7.99, 'PPTX rich-text run must apply the measured fit size and cross-renderer safety factor');
assert.strictEqual(calls[1].options.fontSize, 20, 'Non-shrink text must ignore fit manifest reductions');
assert.strictEqual(calls[1].content[0].options.fontSize, 20, 'Non-shrink rich-text run must preserve requested size');

console.log('PASS deterministic text-fit manifest bridge');
