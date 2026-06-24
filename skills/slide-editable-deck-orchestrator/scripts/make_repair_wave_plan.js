#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const STRATEGIES = {
  missing_detail_density: 'add native line/node/icon/rule density first; consider small non-text detail crops only if needed',
  technical_diagram_under_detailed: 'add native line/node/connector density; allow metadata-rich non-text technical crops; never text/table/label crops',
  schematic_density_low: 'trace native route/connectors and valve/node approximations; small non-text technical crops only',
  board_texture_missing: 'keep board text/table native; use small decorative board-material crops; no whole-board crop',
  checklist_table_fidelity_low: 'source-guided native grid/table tracing with row/column/rule reconstruction; prefer crop coverage 0',
  edge_density_low: 'improve rule density, panel/card boundaries, line thickness, connector density',
  pptx_html_edge_mismatch: 'check helper parity and deck-level geometry; do not loosen thresholds',
  pptx_html_mismatch: 'check helper parity, coordinates, font/line-height behavior, and capture mode',
  palette_drift: 'adjust profile/local colors and panel fills; use non-text texture crops only where appropriate',
};

const ISSUE_PRIORITY = [
  'checklist_table_fidelity_low',
  'technical_diagram_under_detailed',
  'schematic_density_low',
  'missing_detail_density',
  'board_texture_missing',
  'edge_density_low',
  'palette_drift',
  'pptx_html_edge_mismatch',
  'pptx_html_mismatch',
];

function usage() {
  console.log(`Usage: node make_repair_wave_plan.js [options]

Create repair waves from visual QA failures/backlog.

Options:
  --summary <path>          visual_qa_summary JSON (default: out/visual_qa_summary.json)
  --quality-level <level>   blocking-zero|polish|strict|canary (default: blocking-zero)
  --quality <level>         Backward-compatible alias for --quality-level
  --max-wave-size <number>  Max slides per wave (default: 5)
  --out <path>              Wave plan output (default: work/repair_wave_plan.json)
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    summary: 'out/visual_qa_summary.json',
    qualityLevel: 'blocking-zero',
    maxWaveSize: 5,
    out: 'work/repair_wave_plan.json',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--quality-level' || a === '--quality') opts.qualityLevel = argv[++i];
    else if (a === '--max-wave-size') opts.maxWaveSize = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadIssueTypes(slide) {
  const file = slide.fixesPath;
  if (!file || !fs.existsSync(file)) return [];
  try {
    const fixes = readJson(file);
    return [...new Set((fixes.issues || []).map((i) => i.type).filter(Boolean))];
  } catch {
    return [];
  }
}

function shouldPlanSlide(slide, qualityLevel) {
  const blocking = slide.status === 'fail' || slide.severity === 'blocking' || (slide.issueCounts && slide.issueCounts.blocking > 0);
  if (qualityLevel === 'canary') return false;
  if (qualityLevel === 'strict') return slide.status !== 'pass';
  if (qualityLevel === 'polish') return blocking || slide.status === 'needs_polish';
  return blocking;
}

function scoreSlide(slide, issueTypes) {
  let score = 0;
  if (slide.status === 'fail') score += 1000;
  if (slide.severity === 'blocking') score += 500;
  score += ((slide.issueCounts && slide.issueCounts.blocking) || 0) * 100;
  score += (slide.issueCount || 0) * 10;
  for (const type of issueTypes) {
    const p = ISSUE_PRIORITY.indexOf(type);
    if (p >= 0) score += (ISSUE_PRIORITY.length - p);
  }
  return score;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    return;
  }
  if (!Number.isInteger(opts.maxWaveSize) || opts.maxWaveSize < 1) {
    throw new Error('--max-wave-size must be a positive integer');
  }
  const summaryPath = path.resolve(opts.summary);
  const summary = readJson(summaryPath);
  const candidates = (summary.slides || [])
    .filter((slide) => shouldPlanSlide(slide, opts.qualityLevel))
    .map((slide) => {
      const issueTypes = loadIssueTypes(slide);
      return {
        slide: Number(slide.slide),
        status: slide.status,
        severity: slide.severity,
        issueCount: slide.issueCount || 0,
        issueTypes,
        strategies: issueTypes.map((type) => ({ type, strategy: STRATEGIES[type] || 'review visual_polish_fixes.json and repair natively first' })),
        score: scoreSlide(slide, issueTypes),
      };
    })
    .sort((a, b) => b.score - a.score || a.slide - b.slide);

  const waves = chunk(candidates, opts.maxWaveSize).map((items, idx) => ({
    id: `repair-wave-${idx + 1}`,
    slides: items.map((i) => i.slide),
    sourceSlideArg: items.map((i) => i.slide).join(','),
    status: 'planned',
    primaryIssueTypes: [...new Set(items.flatMap((i) => i.issueTypes))],
    strategies: [...new Map(items.flatMap((i) => i.strategies).map((s) => [s.type, s])).values()],
    slideDetails: items,
  }));

  const plan = {
    schemaVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    qualityLevel: opts.qualityLevel,
    sourceSummary: summaryPath,
    maxWaveSize: opts.maxWaveSize,
    blockingSlides: (summary.slides || [])
      .filter((s) => s.status === 'fail' || s.severity === 'blocking' || (s.issueCounts && s.issueCounts.blocking > 0))
      .map((s) => Number(s.slide)),
    waves,
  };

  const outPath = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', out: outPath, waveCount: waves.length, slides: candidates.map((c) => c.slide) }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(`[make_repair_wave_plan] ${err.message}`);
  process.exit(1);
}
