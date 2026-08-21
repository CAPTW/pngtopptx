#!/usr/bin/env node
'use strict';

// Render only the Tabler icons declared by the deck, with a hash-bound cache.
// Calling the script without --usage keeps the legacy all-icons behavior.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let React;
let ReactDOMServer;
let tb;
let sharp;

const USAGE_SCHEMA = 'slide-image-dual-render.icon-usage.v1';
const CACHE_SCHEMA = 'slide-image-dual-render.icon-cache.v1';
const DEFAULT_SIZE = 256;
// Bump only when SVG/PNG appearance changes. Non-visual script edits must not
// invalidate every cached icon.
const RENDERER_REVISION = 'tabler-react-icons-sharp-v1';

const MAP = {
  search:'TbSearch', zoom:'TbZoomScan', atom:'TbAtom2', bolt:'TbBolt',
  shield:'TbShield', shieldcheck:'TbShieldCheck', shieldhalf:'TbShieldHalf',
  clipboard:'TbClipboardCheck', clipboardlist:'TbClipboardList',
  target:'TbTargetArrow', droplet:'TbDroplet', flask:'TbFlask2',
  gear:'TbSettings', helmet:'TbHelmet', user:'TbUser', wrench:'TbTool',
  tools:'TbTools', coins:'TbCoins', money:'TbReportMoney',
  thermo:'TbTemperature', clock:'TbClock', cloud:'TbCloud', ship:'TbShip',
  helm:'TbSteeringWheel', anchor:'TbAnchor', file:'TbFileText', eye:'TbEye',
  ruler:'TbRuler2', octagon:'TbOctagon', stophand:'TbHandStop',
  warn:'TbAlertTriangle', warnfill:'TbAlertTriangleFilled', skull:'TbSkull',
  checkcircle:'TbCircleCheck', xcircle:'TbCircleX', spray:'TbSpray',
  layers:'TbStack2', gauge:'TbGauge', pin:'TbMapPin', brain:'TbBrain',
  recycle:'TbRecycle', refresh:'TbRefresh', alertcircle:'TbAlertCircle',
  sparkles:'TbSparkles', molecule:'TbHexagons', weight:'TbWeight',
  wind:'TbWind', snow:'TbSnowflake', droplets:'TbDroplets', wave:'TbWaveSine',
  ripple:'TbRipple', factory:'TbBuildingFactory2', box:'TbBox',
  layersx:'TbLayersIntersect', circledot:'TbCircleDot', flame:'TbFlame',
  hexagon:'TbHexagon', chartline:'TbChartLine', paint:'TbPaint',
  brush:'TbBrush', wall:'TbWall', adjust:'TbAdjustments',
};

const { loadProfile, paletteC } = require('./lib/profile');
const PROFILE = loadProfile();
const PALETTE = paletteC(PROFILE);
const COLORS = PROFILE ? {
  white:'#'+PALETTE.white, lblue:'#'+PALETTE.steel, cyan:'#'+PALETTE.cyan,
  red:'#'+PALETTE.red, green:'#'+PALETTE.green, gold:'#'+PALETTE.gold, blue:'#'+PALETTE.badge,
} : {
  white:'#E6EEF7', lblue:'#7FB6E6', cyan:'#3BC4ED',
  red:'#D8453B', green:'#3FB950', gold:'#E9B84A', blue:'#2E86D8',
};

function usage() {
  console.log(`make_icons.js - render palette icons with an integrity cache

Usage:
  node scripts/make_icons.js [--usage work/icon_usage.json] [--force]

Options:
  --usage <path>  JSON ${USAGE_SCHEMA} manifest. Omit to render all icons.
  --force         Regenerate requested icons even when the cache is valid.
  --size <px>     Output size. Default: ${DEFAULT_SIZE}.
  --workers <n>   Bounded parallel renders. Default: 16.
  --help          Show this help.

The output directory is DECK_ASSETS/icons or scripts/assets/icons.`);
}

function parseArgs(argv) {
  const args = {
    usage: process.env.DECK_ICON_USAGE || '',
    force: false,
    size: DEFAULT_SIZE,
    workers: Number(process.env.DECK_ICON_WORKERS || 16),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++i];
    };
    if (arg === '--usage') args.usage = next();
    else if (arg === '--force') args.force = true;
    else if (arg === '--size') args.size = Number(next());
    else if (arg === '--workers') args.workers = Number(next());
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Number.isInteger(args.size) || args.size < 16 || args.size > 2048) {
    throw new Error(`--size must be an integer from 16 to 2048; got ${args.size}`);
  }
  if (!Number.isInteger(args.workers) || args.workers < 1 || args.workers > 16) {
    throw new Error(`--workers must be an integer from 1 to 16; got ${args.workers}`);
  }
  return args;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function pairKey(pair) {
  return `${pair.concept}:${pair.color}`;
}

function validatePair(pair, label) {
  if (!pair || typeof pair !== 'object' || Array.isArray(pair)) throw new Error(`${label} must be an object`);
  const concept = String(pair.concept || '').trim();
  const color = String(pair.color || '').trim();
  if (!Object.prototype.hasOwnProperty.call(MAP, concept)) throw new Error(`${label} has unknown concept ${JSON.stringify(concept)}`);
  if (!Object.prototype.hasOwnProperty.call(COLORS, color)) throw new Error(`${label} has unknown color ${JSON.stringify(color)}`);
  return { concept, color };
}

function loadRenderer() {
  if (React) return;
  React = require('react');
  ReactDOMServer = require('react-dom/server');
  tb = require('react-icons/tb');
  sharp = require('sharp');
}

function requestedPairs(usagePath) {
  if (!usagePath) {
    return Object.keys(MAP).flatMap(concept => Object.keys(COLORS).map(color => ({ concept, color })));
  }
  const resolved = path.resolve(usagePath);
  let payload;
  try { payload = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
  catch (err) { throw new Error(`cannot read icon usage manifest ${resolved}: ${err.message}`); }
  if (!payload || payload.schemaVersion !== USAGE_SCHEMA || !Array.isArray(payload.icons)) {
    throw new Error(`icon usage manifest must use schemaVersion ${USAGE_SCHEMA} and an icons array: ${resolved}`);
  }
  const unique = new Map();
  payload.icons.forEach((row, index) => {
    const pair = validatePair(row, `icons[${index}]`);
    unique.set(pairKey(pair), pair);
  });
  return [...unique.values()].sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
}

function outputRoot() {
  const assets = process.env.DECK_ASSETS;
  return assets ? path.join(path.resolve(assets), 'icons') : path.join(__dirname, 'assets', 'icons');
}

function packageVersion(name) {
  const roots = [
    path.join(process.cwd(), 'node_modules'),
    ...String(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
  ];
  for (const root of roots) {
    const candidate = path.join(path.resolve(root), name, 'package.json');
    try { return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || 'unknown'; }
    catch (_) {}
  }
  try {
    const candidate = require.resolve(`${name}/package.json`, { paths: [process.cwd(), __dirname] });
    return JSON.parse(fs.readFileSync(candidate, 'utf8')).version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function rendererFingerprint(size) {
  const packageVersions = Object.fromEntries(
    ['react', 'react-dom', 'react-icons', 'sharp'].map(name => [name, packageVersion(name)])
  );
  return sha256Buffer(stableJson({
    rendererRevision: RENDERER_REVISION, map: MAP, colors: COLORS, packageVersions, size, strokeWidth: 2,
  }));
}

function readCache(file, fingerprint) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (payload.schemaVersion === CACHE_SCHEMA && payload.rendererFingerprint === fingerprint && payload.entries && typeof payload.entries === 'object') return payload;
  } catch (_) {}
  return { schemaVersion: CACHE_SCHEMA, rendererFingerprint: fingerprint, entries: {} };
}

function cacheHit(cache, out, pair) {
  const name = `${pair.concept}_${pair.color}.png`;
  const row = cache.entries[name];
  const file = path.join(out, name);
  return !!row && fs.existsSync(file) && row.sha256 === sha256File(file);
}

async function render(out, pair, size) {
  loadRenderer();
  const Component = tb[MAP[pair.concept]];
  if (!Component) throw new Error(`react-icons component is unavailable: ${MAP[pair.concept]}`);
  let svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Component, { size, color: COLORS[pair.color], strokeWidth: 2 })
  );
  svg = svg.replace(/currentColor/g, COLORS[pair.color]);
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const file = path.join(out, `${pair.concept}_${pair.color}.png`);
  await sharp(Buffer.from(svg)).resize(size, size, { fit:'contain', background:{ r:0, g:0, b:0,alpha:0 } }).png().toFile(file);
  return file;
}

async function renderPairs(out, pairs, size, workers) {
  if (!pairs.length) return [];
  const files = new Array(pairs.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= pairs.length) return;
      files[index] = await render(out, pairs[index], size);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(workers, pairs.length) }, () => worker())
  );
  return files;
}

function writeJsonAtomic(file, payload) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temp, file);
}

async function main(argv = process.argv.slice(2)) {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  const args = parseArgs(argv);
  if (args.help) { usage(); return { rendered: 0, cached: 0, requested: 0 }; }
  const out = outputRoot();
  fs.mkdirSync(out, { recursive: true });
  const pairs = requestedPairs(args.usage);
  const requestedAt = elapsedMs();
  const fingerprint = rendererFingerprint(args.size);
  const fingerprintedAt = elapsedMs();
  const manifestPath = path.join(out, 'manifest.json');
  const cache = readCache(manifestPath, fingerprint);
  const cacheReadAt = elapsedMs();
  let cached = 0;
  const missing = [];
  for (const pair of pairs) {
    if (!args.force && cacheHit(cache, out, pair)) { cached += 1; continue; }
    missing.push(pair);
  }
  const renderedFiles = await renderPairs(out, missing, args.size, args.workers);
  for (let index = 0; index < missing.length; index += 1) {
    const pair = missing[index];
    const file = renderedFiles[index];
    cache.entries[path.basename(file)] = {
      concept: pair.concept,
      color: pair.color,
      sha256: sha256File(file),
    };
  }
  const rendered = missing.length;
  const iconsReadyAt = elapsedMs();
  cache.schemaVersion = CACHE_SCHEMA;
  cache.rendererFingerprint = fingerprint;
  cache.rendererRevision = RENDERER_REVISION;
  cache.size = args.size;
  cache.palette = COLORS;
  cache.lastRequest = pairs;
  cache.lastUsagePath = args.usage ? path.resolve(args.usage) : null;
  cache.requestHash = sha256Buffer(stableJson(pairs));
  writeJsonAtomic(manifestPath, cache);
  const result = {
    requested: pairs.length,
    rendered,
    cached,
    workers: args.workers,
    out,
    manifest: manifestPath,
    timingsMs: {
      request: Number(requestedAt.toFixed(3)),
      fingerprint: Number((fingerprintedAt - requestedAt).toFixed(3)),
      cacheRead: Number((cacheReadAt - fingerprintedAt).toFixed(3)),
      iconCheckOrRender: Number((iconsReadyAt - cacheReadAt).toFixed(3)),
      manifestWrite: Number((elapsedMs() - iconsReadyAt).toFixed(3)),
      total: Number(elapsedMs().toFixed(3)),
    },
  };
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  main().catch(err => { console.error(`make_icons: ${err.message}`); process.exit(1); });
}

module.exports = {
  CACHE_SCHEMA, COLORS, MAP, RENDERER_REVISION, USAGE_SCHEMA,
  main, parseArgs, requestedPairs, rendererFingerprint, renderPairs,
};
