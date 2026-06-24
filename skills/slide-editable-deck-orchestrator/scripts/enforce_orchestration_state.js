#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const QUALITY_LEVELS = new Set(['canary', 'blocking-zero', 'polish', 'strict']);

function usage() {
  console.log(`Usage: node enforce_orchestration_state.js [options]

Validate orchestration state and optional visual QA summary.

Options:
  --state <path>           State file (default: work/orchestration_state.json)
  --summary <path>         Optional visual QA summary to enforce
  --quality-level <level>  Override state quality level
  --quality <level>        Backward-compatible alias for --quality-level
  --require-artifacts      Require listed final artifacts to exist
  --help                   Show this help
`);
}

function parseArgs(argv) {
  const opts = { state: 'work/orchestration_state.json', summary: '', qualityLevel: '', requireArtifacts: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--state') opts.state = argv[++i];
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--quality-level' || a === '--quality') opts.qualityLevel = argv[++i];
    else if (a === '--require-artifacts') opts.requireArtifacts = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function statusFromSummary(summary) {
  const pass = [];
  const needs_polish = [];
  const fail = [];
  const blocking = [];
  for (const slide of summary.slides || []) {
    const id = Number(slide.slide);
    if (slide.status === 'pass') pass.push(id);
    else if (slide.status === 'needs_polish') needs_polish.push(id);
    else fail.push(id);
    if (slide.status === 'fail' || slide.severity === 'blocking' || (slide.issueCounts && slide.issueCounts.blocking > 0)) {
      blocking.push(id);
    }
  }
  return { pass, needs_polish, fail, blocking };
}

function validateState(state) {
  const errors = [];
  if (state.schemaVersion !== '0.1.0') errors.push(`unsupported schemaVersion: ${state.schemaVersion}`);
  if (!state.projectRoot || typeof state.projectRoot !== 'string') errors.push('projectRoot is required');
  if (!QUALITY_LEVELS.has(state.qualityLevel)) errors.push(`unsupported qualityLevel: ${state.qualityLevel}`);
  if (!Array.isArray(state.slides) || !state.slides.every((n) => Number.isInteger(n) && n > 0)) errors.push('slides must be positive integers');
  for (const key of ['pass', 'needs_polish', 'fail']) {
    if (!state.currentStatus || !Array.isArray(state.currentStatus[key])) errors.push(`currentStatus.${key} must be an array`);
  }
  if (!state.artifacts || typeof state.artifacts !== 'object') errors.push('artifacts is required');
  return errors;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    return;
  }
  const statePath = path.resolve(opts.state);
  const state = readJson(statePath);
  const errors = validateState(state);
  const qualityLevel = opts.qualityLevel || state.qualityLevel;
  if (!QUALITY_LEVELS.has(qualityLevel)) errors.push(`unsupported quality level override: ${qualityLevel}`);

  let summaryStatus = null;
  if (opts.summary) {
    summaryStatus = statusFromSummary(readJson(path.resolve(opts.summary)));
    if (qualityLevel !== 'canary' && summaryStatus.blocking.length) {
      errors.push(`blocking slides remain: ${summaryStatus.blocking.join(',')}`);
    }
    if (qualityLevel === 'strict' && summaryStatus.needs_polish.length) {
      errors.push(`strict mode requires no needs_polish slides: ${summaryStatus.needs_polish.join(',')}`);
    }
  } else if (qualityLevel !== 'canary' && state.currentStatus.fail.length) {
    errors.push(`state has fail slides: ${state.currentStatus.fail.join(',')}`);
  }

  if (opts.requireArtifacts) {
    const projectRoot = path.resolve(state.projectRoot);
    const artifactKeys = ['pptx', 'html', 'visualQaSummary', 'renderTrace'];
    for (const key of artifactKeys) {
      const value = state.artifacts && state.artifacts[key];
      if (!value) {
        errors.push(`artifacts.${key} is missing`);
      } else if (!fs.existsSync(path.resolve(projectRoot, value))) {
        errors.push(`artifact does not exist: ${value}`);
      }
    }
  }

  const report = {
    status: errors.length ? 'fail' : 'ok',
    state: statePath,
    qualityLevel,
    errors,
    currentStatus: summaryStatus || state.currentStatus,
    needsPolishBacklog: summaryStatus ? summaryStatus.needs_polish : state.currentStatus.needs_polish,
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`[enforce_orchestration_state] ${err.message}`);
  process.exit(1);
}
