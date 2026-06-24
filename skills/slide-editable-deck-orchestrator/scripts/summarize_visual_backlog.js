#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`Usage: node summarize_visual_backlog.js [options]

Summarize pass / needs_polish / fail and blocking backlog from a visual QA summary.

Options:
  --summary <path>   visual_qa_summary JSON (default: out/visual_qa_summary.json)
  --out <path>       Optional JSON output path
  --help             Show this help
`);
}

function parseArgs(argv) {
  const opts = { summary: 'out/visual_qa_summary.json', out: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function classifySlides(summary) {
  const pass = [];
  const needsPolish = [];
  const fail = [];
  const blocking = [];
  for (const slide of summary.slides || []) {
    const id = Number(slide.slide);
    if (slide.status === 'pass') pass.push(id);
    else if (slide.status === 'needs_polish') needsPolish.push(id);
    else fail.push(id);
    if (slide.status === 'fail' || slide.severity === 'blocking' || (slide.issueCounts && slide.issueCounts.blocking > 0)) {
      blocking.push(id);
    }
  }
  return { pass, needsPolish, fail, blocking };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    return;
  }
  const summaryPath = path.resolve(opts.summary);
  const summary = readJson(summaryPath);
  const status = classifySlides(summary);
  const report = {
    schemaVersion: '0.1.0',
    source: summaryPath,
    counts: summary.counts || {
      pass: status.pass.length,
      needs_polish: status.needsPolish.length,
      fail: status.fail.length,
    },
    blockingSlides: status.blocking,
    passSlides: status.pass,
    needsPolishSlides: status.needsPolish,
    failSlides: status.fail,
    issueSeverityCounts: summary.issueSeverityCounts || {},
    commonIssueTypes: summary.commonIssueTypes || {},
    commonFixStrategies: summary.commonFixStrategies || {},
    cropRecommendations: summary.cropRecommendations || 0,
    recommendedNextRepairWaves: summary.recommendedNextRepairWaves || [],
  };
  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (err) {
  console.error(`[summarize_visual_backlog] ${err.message}`);
  process.exit(1);
}
