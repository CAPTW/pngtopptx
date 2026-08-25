#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const profilePath = path.join(__dirname, 'lib', 'profile.js');
const preflightPath = path.join(__dirname, 'font_preflight.js');
const P = require(profilePath);

const previous = {
  DECK_FONT:process.env.DECK_FONT,
  DECK_FONT_FALLBACK:process.env.DECK_FONT_FALLBACK,
  DECK_FONT_INSTALL_DECISION:process.env.DECK_FONT_INSTALL_DECISION,
};

function restore(){
  for(const [key, value] of Object.entries(previous)){
    if(value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

try {
  const locations = P.fontSearchLocations();
  if(process.platform === 'win32'){
    assert(locations.some(item => item.scope === 'system' && /[\\/]Fonts$/i.test(item.path)), 'Windows system font directory must be scanned');
    assert(locations.some(item => item.scope === 'user' && /Microsoft[\\/]Windows[\\/]Fonts$/i.test(item.path)), 'Windows user font directory must be scanned');
    const pretendardFile = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts', 'Pretendard-Regular.ttf');
    if(fs.existsSync(pretendardFile)){
      const evidence = P.fontAvailabilityEvidence('Pretendard');
      assert.strictEqual(evidence.available, true, 'Installed per-user Pretendard must resolve exactly');
      assert(evidence.scopes.includes('user'), 'Pretendard evidence must record user scope');
    }
  }

  const missing = `Codex Missing Font ${Date.now()}`;
  process.env.DECK_FONT = missing;
  process.env.DECK_FONT_FALLBACK = 'Arial';
  process.env.DECK_FONT_INSTALL_DECISION = 'ask';
  const pending = P.resolveFontPolicy(null, { allowPending:true });
  assert.strictEqual(pending.status, 'USER_DECISION_REQUIRED');
  assert.strictEqual(pending.mappings[0].approvalRequired, true);
  assert.strictEqual(pending.mappings[0].resolved, null);
  assert.strictEqual(pending.automaticInstallationAttempted, false);
  assert.throws(() => P.resolveFontPolicy(null), err => err && err.code === 'FONT_INSTALL_APPROVAL_REQUIRED');

  process.env.DECK_FONT_INSTALL_DECISION = 'declined';
  const declined = P.resolveFontPolicy(null);
  assert.strictEqual(declined.status, 'PASS');
  assert.strictEqual(declined.mappings[0].original, missing);
  assert(declined.mappings[0].resolved, 'Declined install must resolve a fallback');
  assert.strictEqual(declined.mappings[0].fallbackApplied, true);
  assert.strictEqual(declined.automaticInstallationAttempted, false);

  process.env.DECK_FONT_INSTALL_DECISION = 'unavailable';
  const unavailable = P.resolveFontPolicy(null);
  assert.strictEqual(unavailable.status, 'PASS');
  assert.strictEqual(unavailable.mappings[0].fallbackApplied, true);
  assert.strictEqual(unavailable.mappings[0].automaticInstallationAttempted, false);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-font-policy-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'lib'), { recursive:true });
    fs.mkdirSync(path.join(tempRoot, 'work'), { recursive:true });
    const slideSource = `const {T}=require('./kit');\nfunction s1(s){T(s,'x',0,0,100,30,{fontFace:${JSON.stringify(missing)}});}\nmodule.exports={s1};\n`;
    fs.writeFileSync(path.join(tempRoot, 'lib', 'slides.js'), slideSource, 'utf8');
    const baseEnv = Object.assign({}, process.env, {
      DECK_PROJECT_ROOT:tempRoot,
      SLIDES_JS:path.join(tempRoot, 'lib', 'slides.js'),
      DECK_FONT:'Arial',
      DECK_FONT_FALLBACK:'Arial',
      DECK_FONT_INSTALL_DECISION:'ask',
    });
    let result = cp.spawnSync(process.execPath, [preflightPath, '--project', tempRoot], { env:baseEnv, encoding:'utf8' });
    assert.strictEqual(result.status, 3, `Missing font must pause for user decision: ${result.stderr}`);
    let manifest = JSON.parse(fs.readFileSync(path.join(tempRoot, 'out', 'font_resolution_manifest.json'), 'utf8'));
    assert.strictEqual(manifest.status, 'USER_DECISION_REQUIRED');
    assert.strictEqual(manifest.automaticInstallationAttempted, false);

    result = cp.spawnSync(process.execPath, [preflightPath, '--project', tempRoot], {
      env:Object.assign({}, baseEnv, { DECK_FONT_INSTALL_DECISION:'approved' }), encoding:'utf8',
    });
    assert.strictEqual(result.status, 3, `Preauthorized missing font must pause for trusted-source installation: ${result.stderr}`);
    manifest = JSON.parse(fs.readFileSync(path.join(tempRoot, 'out', 'font_resolution_manifest.json'), 'utf8'));
    assert.strictEqual(manifest.status, 'INSTALL_AUTHORIZED');
    const request = JSON.parse(fs.readFileSync(path.join(tempRoot, 'out', 'font_install_request.json'), 'utf8'));
    assert.strictEqual(request.status, 'INSTALL_AUTHORIZED');
    assert.strictEqual(request.userQuestion, null, 'Preauthorized installation must not ask the user again');

    result = cp.spawnSync(process.execPath, [preflightPath, '--project', tempRoot], {
      env:Object.assign({}, baseEnv, { DECK_FONT_INSTALL_DECISION:'declined' }), encoding:'utf8',
    });
    assert.strictEqual(result.status, 0, `Declined install must continue with fallback: ${result.stderr}`);
    manifest = JSON.parse(fs.readFileSync(path.join(tempRoot, 'out', 'font_resolution_manifest.json'), 'utf8'));
    assert.strictEqual(manifest.status, 'PASS');
    const mapped = manifest.mappings.find(row => row.original === missing);
    assert(mapped && mapped.resolved, 'Original -> Resolved mapping must be emitted');
    assert.strictEqual(mapped.fallbackApplied, true);
  } finally {
    fs.rmSync(tempRoot, { recursive:true, force:true });
  }

  console.log('font policy approval/fallback tests passed');
} finally {
  restore();
}
