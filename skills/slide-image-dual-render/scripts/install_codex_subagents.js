#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENT_FILES = [
  'slide-profile-mapper.toml',
  'slide-reconstruct-worker.toml',
  'slide-render-integrator.toml',
  'slide-qa-gate.toml',
];

function usage() {
  console.log(`Install slide-image-dual-render Codex custom agents.

Usage:
  node scripts/install_codex_subagents.js [options]

Options:
  --project <path>  Install to <path>/.codex/agents/
  --global          Install to the user Codex agent directory
  --dry-run         Print planned copies without writing
  --force           Overwrite existing agent files
  --help            Show this help

Recommended .codex/config.toml snippet:

[agents]
max_threads = 4
max_depth = 1
`);
}

function parseArgs(argv) {
  const opts = { project: process.cwd(), global: false, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--global') opts.global = true;
    else if (arg === '--project') {
      if (!argv[i + 1]) throw new Error('--project requires a path');
      opts.project = argv[++i];
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function userCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function sourceDir() {
  const candidates = [
    path.join(process.cwd(), 'assets', 'codex-agents'),
    path.join(__dirname, '..', 'assets', 'codex-agents'),
    path.join(__dirname, 'assets', 'codex-agents'),
  ];
  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) {
    throw new Error(`cannot find assets/codex-agents; checked:\n${candidates.join('\n')}`);
  }
  return found;
}

function targetDir(opts) {
  if (opts.global) return path.join(userCodexHome(), 'agents');
  return path.join(path.resolve(opts.project), '.codex', 'agents');
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

  const srcDir = sourceDir();
  const dstDir = targetDir(opts);
  console.log(`source: ${srcDir}`);
  console.log(`target: ${dstDir}`);

  if (!opts.dryRun) fs.mkdirSync(dstDir, { recursive: true });

  for (const file of AGENT_FILES) {
    const src = path.join(srcDir, file);
    const dst = path.join(dstDir, file);
    if (!fs.existsSync(src)) throw new Error(`missing template: ${src}`);
    if (fs.existsSync(dst) && !opts.force) {
      console.warn(`skip existing ${dst} (use --force to overwrite)`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`would copy ${src} -> ${dst}`);
    } else {
      fs.copyFileSync(src, dst);
      console.log(`copied ${dst}`);
    }
  }

  console.log(`
Recommended .codex/config.toml snippet:

[agents]
max_threads = 4
max_depth = 1

This installer does not modify .codex/config.toml automatically.
`);
}

try {
  main();
} catch (err) {
  console.error(`install_codex_subagents: ${err.message}`);
  process.exit(1);
}
