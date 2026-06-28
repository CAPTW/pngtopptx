#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`Validate slide-image-dual-render parallel worker work directories.

Usage:
  node scripts/validate_parallel_work.js [options]

Options:
  --work <path>      Work directory containing slideXX folders (default: work)
  --slides 1,2,3     Validate only selected slide numbers
  --help             Show this help
`);
}

function parseArgs(argv) {
  const opts = { work: 'work', slides: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--work') {
      if (!argv[i + 1]) throw new Error('--work requires a path');
      opts.work = argv[++i];
    } else if (arg === '--slides') {
      if (!argv[i + 1]) throw new Error('--slides requires a comma-separated list');
      opts.slides = new Set(argv[++i].split(',').map((s) => Number(s.trim())).filter(Boolean));
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function readJson(file, issues) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    issues.push(`${file}: invalid JSON (${err.message})`);
    return null;
  }
}

function hasNumber(obj, key) {
  return obj && Number.isFinite(Number(obj[key]));
}

function cropEntries(data) {
  if (!data) return [];
  const raw = Array.isArray(data) ? data
    : Array.isArray(data.crops) ? data.crops
    : data.crops && typeof data.crops === 'object' ? Object.entries(data.crops).map(([name, value]) => ({ name, ...value }))
    : typeof data === 'object' ? Object.entries(data).map(([name, value]) => ({ name, ...value }))
    : [];
  return raw;
}

function validateFragment(file, n, issues) {
  if (!fs.existsSync(file)) {
    issues.push(`${file}: missing`);
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  const matches = [...src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*s\s*\)/g)].map((m) => m[1]);
  if (matches.length !== 1 || matches[0] !== `s${n}`) {
    issues.push(`${file}: expected exactly one function s${n}(s), found ${matches.join(', ') || 'none'}`);
  }
}

function slideDirs(workDir, selected) {
  if (!fs.existsSync(workDir)) return [];
  return fs.readdirSync(workDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^slide\d+$/i.test(entry.name))
    .map((entry) => ({ n: Number(entry.name.match(/\d+/)[0]), dir: path.join(workDir, entry.name) }))
    .filter((entry) => !selected || selected.has(entry.n))
    .sort((a, b) => a.n - b.n);
}

function validateSlide(entry) {
  const { n, dir } = entry;
  const issues = [];
  const required = [
    'measurements.json',
    'profile_override.json',
    'crop_plan.json',
    `s${n}.fragment.js`,
    'editability_inventory.md',
  ];
  for (const name of required) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) issues.push(`${file}: missing`);
  }

  const measurementsFile = path.join(dir, 'measurements.json');
  const profileFile = path.join(dir, 'profile_override.json');
  const cropFile = path.join(dir, 'crop_plan.json');
  const fragmentFile = path.join(dir, `s${n}.fragment.js`);

  const measurements = fs.existsSync(measurementsFile) ? readJson(measurementsFile, issues) : null;
  const canvas = measurements && (measurements.canvas || measurements);
  if (measurements && (!hasNumber(canvas, 'width') || !hasNumber(canvas, 'height'))) {
    issues.push(`${measurementsFile}: canvas width/height required`);
  }

  const profile = fs.existsSync(profileFile) ? readJson(profileFile, issues) : null;
  if (profile && !(profile.profileId || profile.profile || profile.id)) {
    issues.push(`${profileFile}: profileId required`);
  }
  if (profile && !profile.confidence) {
    issues.push(`${profileFile}: confidence required`);
  }

  const cropPlan = fs.existsSync(cropFile) ? readJson(cropFile, issues) : null;
  cropEntries(cropPlan).forEach((crop, idx) => {
    const label = crop.name || `crop[${idx}]`;
    if (!crop.name) issues.push(`${cropFile}: ${label} missing name`);
    for (const key of ['x', 'y', 'w', 'h']) {
      if (!hasNumber(crop, key)) issues.push(`${cropFile}: ${label} missing numeric ${key}`);
    }
  });

  validateFragment(fragmentFile, n, issues);
  return issues;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(1);
  }
  if (opts.help) {
    usage();
    return;
  }

  const workDir = path.resolve(opts.work);
  const dirs = slideDirs(workDir, opts.slides);
  if (!fs.existsSync(workDir)) {
    console.error(`FAIL ${workDir}: missing work directory`);
    process.exit(1);
  }
  if (dirs.length === 0) {
    console.error(`FAIL ${workDir}: no selected slideXX directories`);
    process.exit(1);
  }

  let failures = 0;
  for (const entry of dirs) {
    const issues = validateSlide(entry);
    if (issues.length) {
      failures++;
      console.log(`FAIL slide${String(entry.n).padStart(2, '0')}`);
      issues.forEach((issue) => console.log(`  - ${issue}`));
    } else {
      console.log(`PASS slide${String(entry.n).padStart(2, '0')}`);
    }
  }
  console.log(`${dirs.length - failures}/${dirs.length} slide workdirs passed`);
  if (failures) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`validate_parallel_work: ${err.message}`);
  process.exit(1);
}
