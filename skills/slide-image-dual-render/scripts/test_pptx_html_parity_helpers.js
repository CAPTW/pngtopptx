#!/usr/bin/env node
"use strict";

process.env.DECK_PXW = process.env.DECK_PXW || "1672";
process.env.DECK_PXH = process.env.DECK_PXH || "941";

const assert = require("assert");
const { makeHtmlSurface, normalizeLineGeom, lineWidthPx, FONT_STACK } = require("./lib/atoms_html");
const { safeLineGeom, linePt } = require("./lib/atoms_pptx");

function approx(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

const h = normalizeLineGeom(700, 438, -400, 0);
assert.deepStrictEqual(h, { x: 300, y: 438, w: 400, h: 0, orientation: "horizontal" });

const v = normalizeLineGeom(230, 835, 0, -125);
assert.deepStrictEqual(v, { x: 230, y: 710, w: 0, h: 125, orientation: "vertical" });

const pptxNeg = safeLineGeom(700, 438, -400, 0);
assert.strictEqual(pptxNeg.x, 300);
assert.strictEqual(pptxNeg.w, 400);
assert.strictEqual(pptxNeg.h, 0.25);

approx(linePt(1), 0.574, 0.003, "1 source-px line should become PPTX points");
approx(linePt(2), 1.148, 0.003, "2 source-px line should become PPTX points");
assert.strictEqual(lineWidthPx(-2), 2);

const s = makeHtmlSurface();
s.rrect(10, 20, 300, 80, { fill: "112233", line: "445566", lineW: 1.25, radius: 8 });
s.ln(700, 438, -400, 0, { color: "33A9E0", width: 2, dash: "dash" });
s.ln(230, 835, 0, -125, { color: "33A9E0", width: 1 });
s.txt("Line A\nLine B", 40, 60, 220, 48, { sz: 12, lh: 1.15, color: "FFFFFF", valign: "middle" });
const html = s._html();

assert(html.includes("left:10px;top:20px;width:300px;height:80px"), "panel dimensions should remain source-pixel exact");
assert(html.includes("border:1.25px solid #445566"), "HTML panel border width should use source pixels");
assert(html.includes("left:300px;top:438px;width:400px;height:0;border-top:2px dashed #33A9E0"), "negative horizontal rule should normalize");
assert(html.includes("left:230px;top:710px;height:125px;width:0;border-left:1px solid #33A9E0"), "negative vertical rule should normalize");
assert(html.includes("height:48px"), "text helper should preserve explicit box height");
assert(html.includes("line-height:1.15"), "text helper should preserve line-height metadata");
assert(html.includes(`font-family:${FONT_STACK}`), "HTML text should use resolved shared font stack");

console.log(JSON.stringify({ status: "ok", tests: 13 }, null, 2));
