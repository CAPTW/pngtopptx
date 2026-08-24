#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-font-usage-integration-'));
try {
  const work = path.join(root, 'work');
  const lib = path.join(root, 'lib');
  fs.mkdirSync(lib, { recursive:true });
  for (const slide of [1, 2]) {
    const dir = path.join(work, `slide${String(slide).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive:true });
    fs.writeFileSync(path.join(dir, `s${slide}.fragment.js`), `function s${slide}(s) { s.bgFill('000000'); }\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'crop_plan.json'), JSON.stringify({ crops:[] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'icon_usage.json'), JSON.stringify({ schemaVersion:'slide-image-dual-render.icon-usage.v1', icons:[] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'font_usage.json'), JSON.stringify({
      schemaVersion:'slide-image-dual-render.font-usage.v1',
      fonts:slide === 1
        ? [{ originalFont:'Pretendard', role:'title', source:'source-image' }]
        : [{ originalFont:'Pretendard', role:'body', source:'semantic-sidecar' }, { originalFont:'Aptos', role:'label', source:'source-image' }],
    }), 'utf8');
  }
  const env = Object.assign({}, process.env, {
    WORK_DIR:work,
    SLIDES_OUT:path.join(lib, 'slides.js'),
    CROP_PLAN_OUT:path.join(work, 'crop_plan.json'),
    DECK_ICON_USAGE:path.join(work, 'icon_usage.json'),
    DECK_FONT_USAGE:path.join(work, 'font_usage.json'),
    INTEGRATION_REPORT_OUT:path.join(work, 'integration_report.md'),
  });
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'integrate_subagent_work.js')], { env, encoding:'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'font_usage.json'), 'utf8'));
  assert.strictEqual(manifest.schemaVersion, 'slide-image-dual-render.font-usage.v1');
  assert.deepStrictEqual(manifest.fonts.map(row => row.originalFont), ['Aptos', 'Pretendard']);
  assert.deepStrictEqual(manifest.fonts.find(row => row.originalFont === 'Pretendard').slides, [1, 2]);
  console.log('PASS per-slide font usage integration');
} finally {
  fs.rmSync(root, { recursive:true, force:true });
}
