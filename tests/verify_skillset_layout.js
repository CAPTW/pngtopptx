#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skills = [
  'slide-text-layer-inpaint',
  'slide-image-dual-render',
  'slide-visual-polish-qa',
  'slide-editable-deck-orchestrator',
];
const requiredTop = [
  'README.md',
  'INSTALL.md',
  'VERIFY.md',
  'DEPENDENCIES.md',
  'CHANGELOG.md',
  'VERSION',
  'MANIFEST.json',
  'install.ps1',
  'verify_install.ps1',
  'package_skillset.ps1',
  'uninstall.ps1',
];
const excludedDirNames = new Set(['node_modules', '.git', '__pycache__', 'out', 'work', 'src']);
const excludedExt = new Set(['.pyc', '.ttf', '.otf', '.woff', '.woff2', '.eot']);
const errors = [];

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/');
}

function requirePath(p) {
  if (!fs.existsSync(p)) errors.push(`missing: ${rel(p)}`);
}

for (const item of requiredTop) requirePath(path.join(root, item));
for (const skill of skills) {
  const skillRoot = path.join(root, 'skills', skill);
  requirePath(skillRoot);
  requirePath(path.join(skillRoot, 'SKILL.md'));
}

requirePath(path.join(root, 'examples', 'prompt-blocking-zero.txt'));
requirePath(path.join(root, 'examples', 'prompt-canary.txt'));
requirePath(path.join(root, 'examples', 'prompt-visual-qa-only.txt'));
requirePath(path.join(root, 'examples', 'prompt-orchestrator-smoke-test.txt'));
requirePath(path.join(root, 'tests', 'smoke-test-manifest.json'));

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirNames.has(entry.name)) {
        errors.push(`excluded directory present: ${rel(full)}`);
        continue;
      }
      walk(full);
    } else {
      if (excludedExt.has(path.extname(entry.name).toLowerCase())) {
        errors.push(`excluded file present: ${rel(full)}`);
      }
    }
  }
}

walk(path.join(root, 'skills'));

if (fs.existsSync(path.join(root, 'MANIFEST.json'))) {
  const manifestText = fs.readFileSync(path.join(root, 'MANIFEST.json'), 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(manifestText);
  if (manifest.name !== 'pngtopptx-toolkit') errors.push('manifest name mismatch');
  if (!Array.isArray(manifest.modules) || manifest.modules.length !== 4) errors.push('manifest modules must list 4 modules');
  if (!Array.isArray(manifest.fileChecksums) || manifest.fileChecksums.length < 1) errors.push('manifest missing fileChecksums');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({ status: 'ok', packageRoot: root, skills }, null, 2));
