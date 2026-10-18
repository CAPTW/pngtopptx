'use strict';
// Optional, exact CJS compatibility profile; never a generic PptxGenJS 4.0.1 attestation.
// Fixed request: analysis/pptxgenjs_dependency.json, exactly {schemaVersion, profile}.
// No request -> original resolver and original build/trace/manifest/cache behavior.
// No module path, environment override, network install or global resolver mutation.
// vm.compileFunction is a CJS loading mechanism here, NOT a security sandbox.
// This identity describes the selected CJS bytes, not transitive dependencies,
// browser execution, semantic truth or visual quality. Filesystem checks do not
// provide isolation from an adversary able to mutate directory entries concurrently.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const {createRequire} = require('module');

const PROFILE = 'pptxgenjs-4.0.1-paragraph-properties-v1';
const REQUEST_SCHEMA = 'slide-image-dual-render.pptxgenjs-dependency-request.v1';
const BASE_SHA = '873d182a8e2e1c0b5e522ef146117936b96b9b2024667bd4c1de59e2b031d27a';
const PATCH_SHA = 'c45a7dd7cb18ef27ba931ccbfd1f877511b93fae81adc22ecea0100245bb8e92';
const RESULT_SHA = '9982d975f1e313be401af8472420e5d5af59f9d9b6707952bf9b879c2b3560e2';
const LICENSE_SHA = '7a2bfe96150786ed1908b8e63f98ebab88875c1e79e28faff6649e0f11f77e52';
const REQUEST_REL = 'analysis/pptxgenjs_dependency.json';
const MAX_CJS_BYTES = 1024 * 1024;
const selections = new WeakMap();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(message) { throw new Error(`PptxGenJS dependency profile: ${message}`); }
function statMaybe(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function contained(root, file) {
  const rel = path.relative(root, file);
  if (rel === '..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel)) fail('path escapes project/root');
}
function directories(root, directory, create=false) {
  root = path.resolve(root); directory = path.resolve(directory); contained(root, directory);
  // Include ancestors of root: a symlinked project/cache root is not an opt-in target.
  const components = directory.slice(path.parse(directory).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (const component of components) {
    current = path.join(current, component);
    let s = statMaybe(current);
    if (!s && create && (current === root || current.startsWith(root+path.sep))) {
      try { fs.mkdirSync(current); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      s = fs.lstatSync(current);
    }
    if (!s || s.isSymbolicLink() || !s.isDirectory()) fail(`directory must exist without symlinks: ${current}`);
  }
}
function readRegular(file, maximum, root) {
  if (root) directories(root, path.dirname(file));
  const observed = fs.lstatSync(file);
  if (observed.isSymbolicLink() || !observed.isFile()) fail(`regular non-symlink file required: ${file}`);
  if (observed.size > maximum) fail(`file exceeds byte limit: ${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size > maximum || opened.dev !== observed.dev || opened.ino !== observed.ino) fail(`file changed before read: ${file}`);
    const result = Buffer.alloc(opened.size + 1);
    let used = 0, n;
    while (used < result.length && (n = fs.readSync(fd, result, used, result.length-used, null))) used += n;
    if (used !== opened.size) fail(`file size changed during read: ${file}`);
    return result.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
function checkHash(bytes, expected, label) {
  if (sha256(bytes) !== expected) fail(`${label} sha256 identity mismatch`);
  return bytes;
}
function readRequest(projectRoot) {
  const root = path.resolve(projectRoot), file = path.join(root, REQUEST_REL);
  if (!statMaybe(file)) return null;
  const bytes = readRegular(file, 4096, root);
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch (_) { fail('request must be valid JSON'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== 'profile,schemaVersion' ||
      value.schemaVersion !== REQUEST_SCHEMA || value.profile !== PROFILE) fail('request has unsupported fields/schema/profile');
  return {root, file, sha256:sha256(bytes)};
}
function dependencyProfileRequested(projectRoot) { return readRequest(projectRoot) !== null; }

// This is deliberately not a general patch executor. The patch itself is fixed
// by SHA, both hunks must match at their exact lines, and final bytes are pinned.
function applyReviewedPatch(base, patch) {
  const source = base.toString('utf8').split('\n'), lines = patch.toString('utf8').split('\n');
  if (lines.shift() !== '--- a/dist/pptxgen.cjs.js' || lines.shift() !== '+++ b/dist/pptxgen.cjs.js') fail('patch headers differ');
  let position = 0, count = 0; const output=[];
  while (lines.length && lines[0]) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines.shift());
    if (!header) fail('unsupported patch hunk');
    const oldStart=Number(header[1])-1, oldCount=Number(header[2]), newStart=Number(header[3])-1, newCount=Number(header[4]);
    if (oldStart < position) fail('overlapping patch hunks');
    output.push(...source.slice(position,oldStart)); position=oldStart;
    if (output.length !== newStart) fail('patch new offset mismatch');
    let removed=0, added=0;
    while (lines.length && !lines[0].startsWith('@@ ') && lines[0] !== '') {
      const line=lines.shift(), kind=line[0], text=line.slice(1);
      if (kind===' ' || kind==='-') { if (source[position++] !== text) fail('patch context mismatch'); removed++; }
      if (kind===' ' || kind==='+') { output.push(text); added++; }
      if (![' ','-','+'].includes(kind)) fail('unsupported patch line');
    }
    if (removed!==oldCount || added!==newCount) fail('patch hunk length mismatch');
    count++;
  }
  if (count!==2 || lines.some(line=>line!=='')) fail('unexpected patch payload');
  output.push(...source.slice(position));
  return checkHash(Buffer.from(output.join('\n'),'utf8'),RESULT_SHA,'derived CJS');
}
function inspectInputs(projectRoot) {
  const request = readRequest(projectRoot); if (!request) return null;
  // Ordinary resolution only; no API accepts an arbitrary module location.
  const originalEntryPath = require.resolve('pptxgenjs');
  const original = checkHash(readRegular(originalEntryPath,MAX_CJS_BYTES),BASE_SHA,'installed original CJS');
  const patchPath=path.join(__dirname,'patches/pptxgenjs-4.0.1-paragraph-properties.patch');
  const licensePath=path.join(__dirname,'patches/PptxGenJS-LICENSE');
  const patch=checkHash(readRegular(patchPath,16384,__dirname),PATCH_SHA,'reviewed patch');
  const license=checkHash(readRegular(licensePath,16384,__dirname),LICENSE_SHA,'MIT license');
  const derived=applyReviewedPatch(original,patch);
  const cacheRoot=path.join(request.root,'.cache/pptxgenjs',RESULT_SHA);
  const descriptor={
    schemaVersion:'slide-image-dual-render.pptxgenjs-dependency.v1',profile:PROFILE,
    qualification:'exact-cjs-bytes-only',projectRoot:request.root,
    requestPath:request.file,requestSha256:request.sha256,
    loaderPath:__filename,loaderSha256:sha256(readRegular(__filename,65536,__dirname)),
    originalEntryPath,originalEntrySha256:BASE_SHA,patchPath,patchSha256:PATCH_SHA,
    licensePath,licenseSha256:LICENSE_SHA,cacheEntryPath:path.join(cacheRoot,'pptxgen.cjs.js'),
    cacheLicensePath:path.join(cacheRoot,'LICENSE'),resultSha256:RESULT_SHA,
    dependencyResolution:'createRequire(originalEntryPath)',
    transitiveDependenciesAttested:false,securitySandbox:false,semanticAuthority:false,visualAuthority:false,
  };
  return {descriptor,derived,license,cacheRoot};
}
function ensureCacheFile(root, file, bytes, expected) {
  directories(root,path.dirname(file),true);
  if (statMaybe(file)) return checkHash(readRegular(file,MAX_CJS_BYTES,root),expected,'existing cache');
  const staging=path.join(path.dirname(file),'.staging-'+crypto.randomBytes(16).toString('hex'));
  const fd=fs.openSync(staging,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  const owner=fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);
    directories(root,path.dirname(file));
    try { fs.linkSync(staging,file); } catch(e) { if(e.code!=='EEXIST') throw e; }
    // Never overwrite/unlink a published entry, including a racing writer's file.
    return checkHash(readRegular(file,MAX_CJS_BYTES,root),expected,'published cache');
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    const current=statMaybe(staging);
    if(current && current.dev===owner.dev && current.ino===owner.ino && current.isFile()) fs.unlinkSync(staging);
  }
}
function inspectPptxgenjsDependency(projectRoot) {
  const input=inspectInputs(projectRoot);if(!input)return null;
  checkHash(readRegular(input.descriptor.cacheEntryPath,MAX_CJS_BYTES,input.descriptor.projectRoot),RESULT_SHA,'cached CJS');
  checkHash(readRegular(input.descriptor.cacheLicensePath,16384,input.descriptor.projectRoot),LICENSE_SHA,'cached MIT license');
  return Object.freeze(input.descriptor);
}
function verifyPptxgenjsDependencyReceipts(projectRoot, buildTracePath, nativeManifestPath) {
  const expected=inspectPptxgenjsDependency(projectRoot);
  if(!expected)fail('request disappeared during pipeline');
  for(const [label,file] of [['build trace',buildTracePath],['native manifest',nativeManifestPath]]) {
    let receipt;
    try { receipt=JSON.parse(readRegular(file,16*1024*1024,path.resolve(projectRoot)).toString('utf8')); }
    catch(error) { fail(`${label} cannot be read as a bounded regular JSON receipt: ${error.message}`); }
    if(!receipt || JSON.stringify(receipt.pptxgenjsDependency)!==JSON.stringify(expected)) {
      fail(`descriptor missing or mismatched in ${label}`);
    }
  }
  return expected;
}

// The pinned CJS has exactly these three audited literal built-in imports.
// This is an exact-source contract, not a general JS parser or per-import
// callback enforcement. Built-ins have no package-relative resolution drift.
// Custom vm callbacks require an experimental Node flag; the standard loader
// constant handles normal default/named built-in exports without new flags.
function builtinImportOptions(bytes) {
  const source=bytes.toString('utf8');
  const sites=source.match(/\bimport\s*\(/g) || [];
  const imports=[...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m=>m[2]);
  if(sites.length!==3 || JSON.stringify(imports)!==JSON.stringify(['node:fs','node:https','node:fs'])) {
    fail('verified CJS dynamic import sites differ from the audited built-in-only contract');
  }
  const loader=vm.constants && vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
  if(typeof loader!=='symbol')fail('Node standard dynamic-import loader is unavailable');
  return {importModuleDynamically:loader};
}

function loadPptxgenjsDependency(projectRoot) {
  const input=inspectInputs(projectRoot); if(!input) return null;
  const d=input.descriptor;
  // Exact result hash was checked by inspectInputs before this source contract.
  const importOptions=builtinImportOptions(input.derived);
  // Verify existing members before publishing a missing member.
  for(const [file,expected] of [[d.cacheEntryPath,RESULT_SHA],[d.cacheLicensePath,LICENSE_SHA]]) {
    if(statMaybe(file))checkHash(readRegular(file,MAX_CJS_BYTES,d.projectRoot),expected,'existing cache');
  }
  const bytes=ensureCacheFile(d.projectRoot,d.cacheEntryPath,input.derived,RESULT_SHA);
  ensureCacheFile(d.projectRoot,d.cacheLicensePath,input.license,LICENSE_SHA);
  // Compile this exact already-read/hashed buffer, never a later pathname read.
  checkHash(bytes,RESULT_SHA,'execution buffer');
  const mod={exports:{}};
  const run=vm.compileFunction(bytes.toString('utf8'),['exports','require','module','__filename','__dirname'],{filename:d.cacheEntryPath,...importOptions});
  run.call(mod.exports,mod.exports,createRequire(d.originalEntryPath),mod,d.cacheEntryPath,path.dirname(d.cacheEntryPath));
  if(typeof mod.exports!=='function')fail('selected CJS did not export a constructor');
  const selection=Object.freeze({PptxGenJS:mod.exports,descriptor:Object.freeze(d)});
  selections.set(selection,d); return selection;
}
function dependencyDescriptor(selection) {
  if(selection==null)return null;
  if(!selections.has(selection))fail('a verified selection is required; metadata alone cannot select code');
  return selections.get(selection);
}
module.exports={loadPptxgenjsDependency,inspectPptxgenjsDependency,dependencyProfileRequested,dependencyDescriptor,verifyPptxgenjsDependencyReceipts};
