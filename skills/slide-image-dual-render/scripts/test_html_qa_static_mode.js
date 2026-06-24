#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT_DIR = __dirname;
const BUILD_JS = path.join(SCRIPT_DIR, "build.js");
const WIDTH = 1672;
const HEIGHT = 941;

function findNodePath() {
  const candidates = [
    process.env.NODE_PATH,
    path.join(process.cwd(), "node_modules"),
    path.join("C:\\Users\\USER\\Downloads", "node_modules"),
    path.join(SCRIPT_DIR, "..", "node_modules"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "pptxgenjs"))) return candidate;
  }
  return null;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "slide-html-qa-static-"));
try {
  fs.mkdirSync(path.join(temp, "lib"), { recursive: true });
  fs.mkdirSync(path.join(temp, "assets"), { recursive: true });
  fs.mkdirSync(path.join(temp, "out"), { recursive: true });
  fs.writeFileSync(
    path.join(temp, "lib", "slides.js"),
    `const K = require('./kit');
function s1(s){
  s.bgFill(K.C.bg);
  K.T(s, 'QA Static Mode', 40, 50, 420, 64, { sz: 24, b: true, shrink: true });
  s.ln(700, 438, -400, 0, { color: K.C.cyan, width: 2, dash: 'dash' });
}
module.exports = { s1 };
`,
    "utf8",
  );

  const nodePath = findNodePath();
  assert(nodePath, "pptxgenjs dependency was not found for the HTML build smoke test");
  const env = {
    ...process.env,
    NODE_PATH: nodePath,
    SLIDE_PIPELINE_ENFORCE: "0",
    TARGET: "html",
    SLIDES: "1",
    DECK_PROJECT_ROOT: temp,
    DECK_ASSETS: path.join(temp, "assets"),
    DECK_PXW: String(WIDTH),
    DECK_PXH: String(HEIGHT),
    DECK_FONT_FALLBACK: "Arial",
    HTML_OUT: path.join(temp, "out", "deck.html"),
  };
  const result = spawnSync(process.execPath, [BUILD_JS], { cwd: temp, env, encoding: "utf8" });
  assert.strictEqual(result.status, 0, `build.js failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);

  const html = fs.readFileSync(path.join(temp, "out", "deck.html"), "utf8");
  assert(html.includes(`width:${WIDTH}px;height:${HEIGHT}px`), "slide CSS should use exact source-pixel dimensions");
  assert(html.includes('data-deck-pxw="1672" data-deck-pxh="941"'), "HTML body should record deck coordinate space");
  assert(html.includes("window.__slideFontPolicy"), "HTML should expose resolved font policy metadata");
  assert(!html.includes("cdn.jsdelivr.net/gh/orioncactus/pretendard"), "HTML must not import Pretendard CDN for parity QA");
  assert(html.includes("function qaStaticEnabled()"), "HTML should include QA/static mode detection");
  assert(html.includes("params.has('qa') || params.has('qa-static')"), "QA/static mode should be enabled by query params");
  assert(html.includes("body[data-qa-static=\"1\"] .slide{transform:none!important"), "QA/static CSS should suppress slide transforms");
  assert(html.includes("sl.style.transform = 'none';"), "QA/static JS should suppress slide transforms");
  assert(html.includes("sl.dataset.appliedScale = '1';"), "QA/static JS should record scale 1");
  assert(html.includes("left:300px;top:438px;width:400px;height:0;border-top:2px dashed"), "HTML output should normalize negative rule geometry");

  console.log(JSON.stringify({ status: "ok", html: path.join(temp, "out", "deck.html"), nodePath }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
