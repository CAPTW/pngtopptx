#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

function installRendererStubs() {
  const originalLoad = Module._load;
  const component = () => null;
  Module._load = function load(request, parent, isMain) {
    if (request === 'react') return { createElement: () => ({}) };
    if (request === 'react-dom/server') {
      return { renderToStaticMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>' };
    }
    if (request === 'react-icons/tb') return new Proxy({}, { get: () => component });
    if (request === 'sharp') {
      return () => ({
        resize() { return this; },
        png() { return this; },
        async toFile(file) { fs.writeFileSync(file, Buffer.from('unit-test-icon')); },
      });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return () => { Module._load = originalLoad; };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pngtopptx-icons-'));
  const assets = path.join(root, 'assets');
  const usage = path.join(root, 'icon_usage.json');
  fs.writeFileSync(usage, JSON.stringify({
    schemaVersion: 'slide-image-dual-render.icon-usage.v1',
    icons: [
      { concept: 'box', color: 'cyan' },
      { concept: 'gear', color: 'red' },
      { concept: 'box', color: 'cyan' },
    ],
  }));
  process.env.DECK_ASSETS = assets;
  const restoreRenderer = installRendererStubs();
  try {
    const icons = require('./make_icons');
    const first = await icons.main(['--usage', usage]);
    assert.deepStrictEqual({ requested: first.requested, rendered: first.rendered, cached: first.cached }, { requested: 2, rendered: 2, cached: 0 });
    const second = await icons.main(['--usage', usage]);
    assert.deepStrictEqual({ requested: second.requested, rendered: second.rendered, cached: second.cached }, { requested: 2, rendered: 0, cached: 2 });
    assert(fs.existsSync(path.join(assets, 'icons', 'box_cyan.png')));
    assert(fs.existsSync(path.join(assets, 'icons', 'gear_red.png')));
    assert.strictEqual(fs.readdirSync(path.join(assets, 'icons')).filter(name => name.endsWith('.png')).length, 2);
    fs.writeFileSync(usage, JSON.stringify({ schemaVersion: 'slide-image-dual-render.icon-usage.v1', icons: [{ concept: 'not-real', color: 'cyan' }] }));
    assert.throws(() => icons.requestedPairs(usage), /unknown concept/);
  } finally {
    restoreRenderer();
  }
  console.log('PASS on-demand icon manifest/cache unit test');
}

main().catch(err => { console.error(err); process.exit(1); });
