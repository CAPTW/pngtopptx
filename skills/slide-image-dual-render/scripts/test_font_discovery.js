#!/usr/bin/env node
'use strict';

// Filename-discovery contracts only. These fixtures contain no real font binaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const profilePath = process.env.FONT_DISCOVERY_TEST_PROFILE || path.join(__dirname, 'lib', 'profile.js');
const profileSource = fs.readFileSync(profilePath, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(t){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-discovery-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const mkdir = relative => {
    const dir = path.join(root, relative);
    fs.mkdirSync(dir, { recursive:true });
    return dir;
  };
  const file = relative => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.writeFileSync(target, 'synthetic filename fixture, not a font');
    return target;
  };
  const load = (roots, overrides={}) => {
    const reads = [];
    const safeFs = {};
    for(const method of ['readdirSync', 'realpathSync', 'lstatSync']){
      safeFs[method] = (target, ...args) => {
        const relative = path.relative(root, path.resolve(target));
        if(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)){
          // Do not scan host system/user roots in a synthetic unit test.
          throw Object.assign(new Error('Synthetic root is absent'), { code:'ENOENT' });
        }
        if(method === 'readdirSync') reads.push(path.resolve(target));
        return overrides[method] ? overrides[method](target, ...args) : fs[method](target, ...args);
      };
    }
    const module = { exports:{} };
    vm.runInNewContext(profileSource, {
      module, exports:module.exports,
      process:{ platform:process.platform, env:{ DECK_FONT_DIRS:roots.join(path.delimiter) } },
      require(name){
        if(name === 'fs') return safeFs;
        if(name === 'path') return path;
        if(name === 'os') return { homedir:() => path.join(root, 'synthetic-home') };
        if(name === 'child_process') return { execFileSync(){ throw new Error('No host registry access'); } };
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename:profilePath });
    return { P:module.exports, reads };
  };
  return { root, mkdir, file, load };
}

test('discovers supported font filenames at multiple depths with existing metadata', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  const expected = [
    f.file('fonts/FixtureTop.ttf'), f.file('fonts/truetype/family/FixtureNested.TTF'),
    f.file('fonts/opentype/FixtureOpen.otf'), f.file('fonts/collections/FixtureCollection.ttc'),
    f.file('fonts/web/FixtureWeb.woff'), f.file('fonts/web/FixtureWeb2.WOFF2'),
    f.file('fonts/directory.ttf/FixtureDeep.ttf'),
  ];
  f.file('fonts/truetype/FixtureNotFont.txt');
  const { P } = f.load([root]);
  const evidence = plain(P.fontAvailabilityEvidence('Fixture'));
  assert.equal(evidence.fontFilesScanned, expected.length);
  assert.deepEqual(evidence.matches.map(row => row.path).sort(), expected.sort());
  assert(evidence.matches.every(row => row.scope === 'explicit' && row.source === 'DECK_FONT_DIRS'));
  assert.equal(evidence.searchedLocations.find(row => row.path === root).fileCount, expected.length);
});

test('keeps all existing root-level entries ahead of new descendants in original root order', t => {
  const f = fixture(t);
  const first = f.mkdir('first');
  const second = f.mkdir('second');
  const top1 = f.file('first/OrderZ.ttf');
  const top2 = f.file('second/OrderA.ttf');
  const nested1 = f.file('first/00-nested/OrderB.ttf');
  const nested2 = f.file('second/nested/OrderC.ttf');
  const { P } = f.load([first, second]);
  assert.deepEqual(plain(P.fontAvailabilityEvidence('Order')).matches.map(row => row.path), [top1, top2, nested1, nested2]);
});

test('ordinary top-level ordering and exclusion of symlink font entries match legacy behavior', t => {
  const f = fixture(t);
  const first = f.mkdir('first');
  const second = f.mkdir('second');
  const top1 = f.file('first/LegacyZ.ttf');
  const top2 = f.file('second/LegacyA.ttf');
  try { fs.symlinkSync(top1, path.join(first, 'LegacyAlias.ttf'), 'file'); }
  catch(error){
    if(error.code === 'EPERM' || error.code === 'ENOTSUP') return t.skip('Symlink creation is unavailable');
    throw error;
  }
  const { P } = f.load([first, second]);
  const evidence = plain(P.fontAvailabilityEvidence('Legacy'));
  assert.deepEqual(evidence.matches.map(row => row.path), [top1, top2]);
  assert.equal(evidence.fontFilesScanned, 2);
  assert.deepEqual(evidence.searchedLocations.filter(row => row.scope === 'explicit').map(row => row.fileCount), [1, 1]);
});

test('top-level symlink font files remain excluded and directory links cannot escape or cycle', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  const outside = f.mkdir('fonts-sibling');
  const original = f.file('fonts/LinkOrdinary.ttf');
  const nested = f.file('fonts/nested/LinkNested.ttf');
  f.file('fonts-sibling/LinkEscaped.ttf');
  try {
    fs.symlinkSync(original, path.join(root, 'LinkAlias.ttf'), 'file');
    fs.symlinkSync(root, path.join(root, 'nested', 'cycle'), 'junction');
    fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  } catch(error){
    if(error.code === 'EPERM' || error.code === 'ENOTSUP') return t.skip('Symlink creation is unavailable');
    throw error;
  }
  const { P, reads } = f.load([root]);
  const evidence = plain(P.fontAvailabilityEvidence('Link'));
  assert.deepEqual(evidence.matches.map(row => row.path), [original, nested]);
  assert(!reads.includes(outside));
  assert(!reads.some(dir => /(?:cycle|escape)$/.test(dir)));
});

test('explicit symlink roots retain their configured path and scope', t => {
  const f = fixture(t);
  const target = f.mkdir('target');
  const alias = path.join(f.root, 'configured-alias');
  f.file('target/AliasTop.ttf');
  f.file('target/nested/AliasNested.ttf');
  try { fs.symlinkSync(target, alias, 'junction'); }
  catch(error){
    if(error.code === 'EPERM' || error.code === 'ENOTSUP') return t.skip('Symlink creation is unavailable');
    throw error;
  }
  const { P } = f.load([alias]);
  assert.deepEqual(plain(P.fontAvailabilityEvidence('Alias')).matches.map(row => row.path), [
    path.join(alias, 'AliasTop.ttf'), path.join(alias, 'nested', 'AliasNested.ttf'),
  ]);
});

test('resolved descendant paths cannot cross the root boundary even with a shared prefix', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  const escaped = f.mkdir('fonts-sibling');
  const changed = f.mkdir('fonts/changed');
  f.file('fonts-sibling/Escape.ttf');
  const safe = f.file('fonts/safe/EscapeSafe.ttf');
  const { P, reads } = f.load([root], {
    realpathSync(target){ return target === changed ? escaped : fs.realpathSync(target); },
  });
  assert.deepEqual(plain(P.fontAvailabilityEvidence('Escape')).matches.map(row => row.path), [safe]);
  assert(!reads.includes(escaped));
});

test('unreadable nested directories do not suppress accessible siblings or top-level fonts', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  const blocked = f.mkdir('fonts/blocked');
  const top = f.file('fonts/AccessTop.ttf');
  const nested = f.file('fonts/safe/AccessNested.ttf');
  const { P } = f.load([root, path.join(f.root, 'absent')], {
    readdirSync(target, options){
      if(target === blocked) throw Object.assign(new Error('synthetic permission failure'), { code:'EACCES' });
      return fs.readdirSync(target, options);
    },
  });
  const evidence = plain(P.fontAvailabilityEvidence('Access'));
  assert.deepEqual(evidence.matches.map(row => row.path), [top, nested]);
  assert.equal(evidence.searchedLocations.find(row => row.path.endsWith('absent')).error, 'ENOENT');
});

test('index remains cached until the existing explicit reset', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  const { P, reads } = f.load([root]);
  assert.equal(P.fontAvailable('Cached'), false);
  const readCount = reads.length;
  f.file('fonts/nested/Cached.ttf');
  assert.equal(P.fontAvailable('Cached'), false);
  assert.equal(reads.length, readCount);
  P.resetFontIndexCache();
  assert.equal(P.fontAvailable('Cached'), true);
});

test('existing exact matching, approval, fallback order and unavailable acceptance are unchanged', t => {
  const f = fixture(t);
  const root = f.mkdir('fonts');
  f.file('fonts/family/NestedOriginal-Regular.ttf');
  f.file('fonts/fallback/NestedFallback.ttf');
  f.file('fonts/arial.ttf');
  const { P } = f.load([root]);
  assert.equal(P.fontAvailabilityEvidence('Arial').matches[0].match, 'known-file-hint');
  assert.equal(P.fontAvailable('NestedOriginal'), true);
  assert.equal(P.fontAvailabilityEvidence('NestedOriginal').matches[0].match, 'filename-family-prefix');
  assert.equal(P.resolveFontMapping('NestedOriginal', { installDecision:'ask' }).exact, true);
  assert.equal(P.resolveFontMapping('Missing', { installDecision:'ask', allowPending:true }).approvalRequired, true);
  const fallback = P.resolveFontMapping('Missing', {
    installDecision:'unavailable', fallbackCandidates:['NestedFallback', 'Arial'],
  });
  assert.equal(fallback.resolved, 'NestedFallback');
  assert.equal(fallback.resolvedEvidence.available, true);
  assert.equal(fallback.automaticInstallationAttempted, false);
  const empty = f.load([f.mkdir('empty')]).P.resolveFontMapping('Missing', {
    installDecision:'unavailable', fallbackCandidates:['StillMissing'],
  });
  assert.equal(empty.resolved, 'StillMissing');
  assert.equal(empty.resolvedEvidence.available, false);
  assert.equal(empty.status, 'fallback');
});
