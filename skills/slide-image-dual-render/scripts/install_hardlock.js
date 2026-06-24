#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`Usage: node scripts/install_hardlock.js [options]

Options:
  --project <path>  target project directory (default: .)
  --dry-run         print actions without writing
  --force           overwrite existing non-AGENTS files
  --help            show this help
`);
}

function parseArgs(argv) {
  const opts = { project: '.', dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return opts;
}

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function sourceRoot() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'codex-hardlock'),
    path.join(__dirname, 'assets', 'codex-hardlock'),
    path.join(process.cwd(), 'assets', 'codex-hardlock'),
  ];
  for (const c of candidates) if (exists(path.join(c, 'AGENTS.md'))) return c;
  throw new Error('could not locate assets/codex-hardlock templates');
}

function copyOne(src, dst, opts, notes) {
  if (exists(dst) && !opts.force) {
    notes.push(`skip existing ${dst}`);
    return;
  }
  notes.push(`${opts.dryRun ? 'would copy' : 'copy'} ${src} -> ${dst}`);
  if (opts.dryRun) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); usage(); process.exit(2); }
  if (opts.help) { usage(); return; }
  const project = path.resolve(opts.project);
  const srcRoot = sourceRoot();
  const notes = [];

  const agentsDst = path.join(project, 'AGENTS.md');
  const agentsAlt = path.join(project, 'AGENTS.slide-image-dual-render.md');
  if (exists(agentsDst) && !opts.force) {
    copyOne(path.join(srcRoot, 'AGENTS.md'), agentsAlt, opts, notes);
    notes.push('AGENTS.md already exists; merge AGENTS.slide-image-dual-render.md into AGENTS.md manually.');
  } else {
    copyOne(path.join(srcRoot, 'AGENTS.md'), agentsDst, opts, notes);
  }

  const mappings = [
    ['config.toml.example', path.join(project, '.codex', 'config.toml.example')],
    [path.join('hooks', 'slide_pre_tool_use_policy.py'), path.join(project, '.codex', 'hooks', 'slide_pre_tool_use_policy.py')],
    [path.join('hooks', 'slide_post_tool_use_review.py'), path.join(project, '.codex', 'hooks', 'slide_post_tool_use_review.py')],
    [path.join('rules', 'slide.rules'), path.join(project, '.codex', 'rules', 'slide.rules')],
  ];
  for (const [srcRel, dst] of mappings) copyOne(path.join(srcRoot, srcRel), dst, opts, notes);

  notes.forEach(n => console.log(n));
  console.log('\nNext steps:');
  console.log('1. review .codex/config.toml.example');
  console.log('2. merge the relevant sections into .codex/config.toml');
  console.log('3. restart Codex');
  console.log('4. set strict mode before production conversion, e.g. PowerShell: $env:SLIDE_PIPELINE_STRICT="1"');
  console.log('5. run the pipeline:');
  console.log(`   Skill-installed layout: node "${path.join(__dirname, 'slide_pipeline.js')}" --target both`);
  console.log('   Deck-local copied layout: node scripts/slide_pipeline.js --target both');
}

if (require.main === module) main();
