#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

function hasPackage(nodeModules, name){
  return fs.existsSync(path.join(nodeModules, name, 'package.json'));
}

function sha256(file){
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function dependencyRoot(){
  const candidates = String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).concat([
    path.join(__dirname, '..', 'node_modules'),
    path.resolve(__dirname, '..', '..', '..', 'node_modules'),
  ]);
  return candidates.find(candidate => hasPackage(candidate, 'pptxgenjs')) || null;
}

const nodeModules = dependencyRoot();
if(!nodeModules){
  console.log('SKIP font pipeline integration test: deck renderer dependencies not found');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-font-pipeline-'));
const pipeline = path.join(__dirname, 'slide_pipeline.js');
const finalGate = path.join(__dirname, 'final_gate.js');
try {
  fs.mkdirSync(path.join(root, 'src'), { recursive:true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive:true });
  fs.writeFileSync(path.join(root, 'src', 'slide1.png'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'lib', 'slides.js'), [
    "const K = require('./kit');",
    "function s1(s){",
    "  s.bgFill('06101F');",
    "  s.txt([{text:'Pretendard exact',fontFace:'Pretendard'}], 80, 100, 1000, 120, {fontFace:'Pretendard',sz:32,color:'FFFFFF'});",
    "}",
    "module.exports={s1};",
    "",
  ].join('\n'), 'utf8');

  const env = Object.assign({}, process.env, {
    NODE_PATH:nodeModules,
    DECK_FONT:'Pretendard',
    DECK_FONT_INSTALL_DECISION:'ask',
  });
  const args = [
    pipeline, '--project', root, '--slides', '1', '--quality', 'canary',
    '--target', 'both', '--skip-assets', '--skip-crops', '--node-path', nodeModules,
  ];
  let result = cp.spawnSync(process.execPath, args, { env, encoding:'utf8' });
  assert.strictEqual(result.status, 0, `Pipeline failed:\n${result.stdout}\n${result.stderr}`);
  result = cp.spawnSync(process.execPath, [
    finalGate, '--project', root, '--slides', '1', '--quality', 'canary', '--target', 'both',
    '--pptx', path.join(root, 'out', 'deck.pptx'), '--html', path.join(root, 'out', 'deck.html'),
  ], { env, encoding:'utf8' });
  assert.strictEqual(result.status, 0, `Final gate failed:\n${result.stdout}\n${result.stderr}`);

  const pptxFile = path.join(root, 'out', 'deck.pptx');
  const htmlFile = path.join(root, 'out', 'deck.html');
  const beforeQaOnly = { pptx:sha256(pptxFile), html:sha256(htmlFile) };
  const deliberatelyOld = new Date(Date.now() - 60000);
  fs.utimesSync(pptxFile, deliberatelyOld, deliberatelyOld);
  fs.utimesSync(htmlFile, deliberatelyOld, deliberatelyOld);
  result = cp.spawnSync(process.execPath, args.concat(['--qa-only']), { env, encoding:'utf8' });
  assert.strictEqual(result.status, 0, `QA-only pipeline must validate existing outputs without rebuilding them:\n${result.stdout}\n${result.stderr}`);
  assert.deepStrictEqual({ pptx:sha256(pptxFile), html:sha256(htmlFile) }, beforeQaOnly, 'QA-only pipeline changed a rendered output');
  const qaOnlyTrace = JSON.parse(fs.readFileSync(path.join(root, 'out', 'render_trace.json'), 'utf8'));
  assert.strictEqual(qaOnlyTrace.qaOnly, true, 'QA-only trace must record qaOnly=true');
  result = cp.spawnSync(process.execPath, [
    finalGate, '--project', root, '--slides', '1', '--quality', 'canary', '--target', 'both',
    '--pptx', pptxFile, '--html', htmlFile,
  ], { env, encoding:'utf8' });
  assert.strictEqual(result.status, 0, `Final gate must accept a validated QA-only trace for unchanged existing outputs:\n${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'out', 'font_resolution_manifest.json'), 'utf8'));
  const pretendard = manifest.mappings.find(mapping => mapping.original === 'Pretendard');
  assert(pretendard, 'Pretendard mapping missing');
  assert.strictEqual(pretendard.resolved, 'Pretendard');
  assert.strictEqual(pretendard.exact, true);
  assert.strictEqual(manifest.automaticInstallationAttempted, false);

  const native = JSON.parse(fs.readFileSync(path.join(root, 'out', 'native_object_manifest.json'), 'utf8'));
  const text = native.slides['1'].objects.find(obj => obj.type === 'text');
  assert(text, 'Native editable text provenance missing');
  assert.strictEqual(text.originalFont, 'Pretendard');
  assert.strictEqual(text.resolvedFont, 'Pretendard');

  const pendingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-font-pipeline-pending-'));
  try {
    fs.mkdirSync(path.join(pendingRoot, 'src'), { recursive:true });
    fs.mkdirSync(path.join(pendingRoot, 'lib'), { recursive:true });
    fs.writeFileSync(path.join(pendingRoot, 'src', 'slide1.png'), '', 'utf8');
    const missing = `Codex Missing Pipeline Font ${Date.now()}`;
    fs.writeFileSync(path.join(pendingRoot, 'lib', 'slides.js'), [
      "const K = require('./kit');",
      `function s1(s){s.bgFill('06101F');s.txt('x',0,0,100,30,{fontFace:${JSON.stringify(missing)}});}`,
      "module.exports={s1};",
      "",
    ].join('\n'), 'utf8');
    const pending = cp.spawnSync(process.execPath, [
      pipeline, '--project', pendingRoot, '--slides', '1', '--quality', 'canary',
      '--target', 'both', '--skip-assets', '--skip-crops', '--node-path', nodeModules,
    ], { env, encoding:'utf8' });
    assert.strictEqual(pending.status, 3, `Pipeline must surface the user-decision state with exit code 3:\n${pending.stdout}\n${pending.stderr}`);
    const request = JSON.parse(fs.readFileSync(path.join(pendingRoot, 'out', 'font_install_request.json'), 'utf8'));
    assert.strictEqual(request.status, 'USER_DECISION_REQUIRED');
    assert.strictEqual(request.automaticInstallationAttempted, false);

    const declined = cp.spawnSync(process.execPath, [
      pipeline, '--project', pendingRoot, '--slides', '1', '--quality', 'canary',
      '--target', 'both', '--skip-assets', '--skip-crops', '--node-path', nodeModules,
      '--font-install-decision', 'declined',
    ], { env:Object.assign({}, env, { DECK_FONT_INSTALL_DECISION:'declined' }), encoding:'utf8' });
    assert.strictEqual(declined.status, 0, `Pipeline must continue after user declines installation:\n${declined.stdout}\n${declined.stderr}`);
    const fallbackManifest = JSON.parse(fs.readFileSync(path.join(pendingRoot, 'out', 'font_resolution_manifest.json'), 'utf8'));
    const fallback = fallbackManifest.mappings.find(mapping => mapping.original === missing);
    assert.strictEqual(fallbackManifest.status, 'PASS');
    assert(fallback && fallback.resolved && fallback.fallbackApplied, 'Declined decision must produce Original -> Resolved fallback mapping');
  } finally {
    fs.rmSync(pendingRoot, { recursive:true, force:true });
  }

  console.log(JSON.stringify({ status:'ok', exactMapping:'Pretendard -> Pretendard', missingFontDecision:'exit 3 before render', declinedDecision:'fallback and conversion passed', qaOnly:'validated without rebuilding', finalGate:'passed' }, null, 2));
} finally {
  fs.rmSync(root, { recursive:true, force:true });
}
