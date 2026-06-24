#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const QUALITY_LEVELS = new Set(['canary', 'blocking-zero', 'polish', 'strict']);

function usage() {
  console.log(`Usage: node plan_deck_workflow.js [options]

Create work/orchestration_state.json for an editable deck workflow.

Options:
  --project <path>           Deck project root (default: .)
  --slides <list>            Source slide ids, e.g. 1,2,3 (default: discover src/slideN.png)
  --quality-level <level>    canary|blocking-zero|polish|strict (default: blocking-zero)
  --quality <level>          Backward-compatible alias for --quality-level
  --text-layer <mode>        auto|always|never (default: auto)
  --max-iterations <number>  Iteration limit recorded in state (default by quality)
  --out <path>               State output path (default: work/orchestration_state.json)
  --help                     Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    project: '.',
    slides: '',
    qualityLevel: 'blocking-zero',
    textLayer: 'auto',
    maxIterations: '',
    out: 'work/orchestration_state.json',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--project') {
      opts.project = argv[++i];
    } else if (a === '--slides') {
      opts.slides = argv[++i];
    } else if (a === '--quality-level' || a === '--quality') {
      opts.qualityLevel = argv[++i];
    } else if (a === '--text-layer') {
      opts.textLayer = argv[++i];
    } else if (a === '--max-iterations') {
      opts.maxIterations = argv[++i];
    } else if (a === '--out') {
      opts.out = argv[++i];
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return opts;
}

function parseSlideList(value) {
  if (!value) return [];
  return value.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

function discoverSlides(projectRoot) {
  const src = path.join(projectRoot, 'src');
  if (!fs.existsSync(src)) {
    throw new Error(`Cannot discover slides: missing ${src}`);
  }
  return fs.readdirSync(src)
    .map((name) => {
      const m = /^slide(\d+)\.(png|jpg|jpeg)$/i.exec(name);
      return m ? Number(m[1]) : null;
    })
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

function defaultMaxIterations(level) {
  if (level === 'canary') return 1;
  if (level === 'blocking-zero') return 6;
  if (level === 'polish') return 10;
  return 20;
}

function chunk(slides, size) {
  const out = [];
  for (let i = 0; i < slides.length; i += size) out.push(slides.slice(i, i + size));
  return out;
}

function detectExistingTextLayer(projectRoot, slides) {
  return slides.filter((s) => {
    const id = String(s).padStart(2, '0');
    return fs.existsSync(path.join(projectRoot, 'work', `slide${id}`, 'text_regions.json'));
  });
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    usage();
    return;
  }
  if (!QUALITY_LEVELS.has(opts.qualityLevel)) {
    throw new Error(`Unsupported quality level: ${opts.qualityLevel}`);
  }
  if (!['auto', 'always', 'never'].includes(opts.textLayer)) {
    throw new Error(`Unsupported text-layer mode: ${opts.textLayer}`);
  }
  const projectRoot = path.resolve(opts.project);
  const slides = parseSlideList(opts.slides);
  const selectedSlides = slides.length ? slides : discoverSlides(projectRoot);
  if (!selectedSlides.length) throw new Error('No source slides found.');

  const maxIterations = opts.maxIterations
    ? Number(opts.maxIterations)
    : defaultMaxIterations(opts.qualityLevel);
  if (!Number.isInteger(maxIterations) || maxIterations < 0) {
    throw new Error('--max-iterations must be a non-negative integer');
  }

  const existingTextLayerSlides = detectExistingTextLayer(projectRoot, selectedSlides);
  const textLayerUseful = opts.textLayer === 'always'
    ? selectedSlides
    : opts.textLayer === 'never'
      ? []
      : existingTextLayerSlides;

  const state = {
    schemaVersion: '0.1.0',
    projectRoot,
    qualityLevel: opts.qualityLevel,
    slides: selectedSlides,
    waves: chunk(selectedSlides, 5).map((waveSlides, idx) => ({
      id: `initial-wave-${idx + 1}`,
      type: 'initial-reconstruction',
      slides: waveSlides,
      status: 'planned',
    })),
    iterations: [],
    currentStatus: {
      pass: [],
      needs_polish: [],
      fail: [],
    },
    artifacts: {
      pptx: 'out/deck-final-editable.pptx',
      html: 'out/deck-final-editable.html',
      visualQaSummary: 'out/visual_qa_summary_final.json',
      renderTrace: 'out/render_trace.json',
    },
    limits: {
      maxIterations,
      maxWaveSize: 5,
    },
    textLayerPreprocessing: {
      mode: opts.textLayer,
      usefulSlides: textLayerUseful,
      existingArtifacts: existingTextLayerSlides,
      rule: 'Run slide-text-layer-inpaint only when text separation, pseudo text handling, inpainting, or residual checks add value.',
    },
    createdAt: new Date().toISOString(),
  };

  const outPath = path.resolve(projectRoot, opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'ok', state: outPath, slides: selectedSlides, qualityLevel: opts.qualityLevel }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(`[plan_deck_workflow] ${err.message}`);
  process.exit(1);
}
