// build.js — render all slides to BOTH pptx and html from the same slide code.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const BUILD_STARTED_MS = Date.now();
const SCRIPT_ROOT = __dirname;
const SKILL_ROOT = path.basename(SCRIPT_ROOT).toLowerCase() === 'scripts' ? path.dirname(SCRIPT_ROOT) : SCRIPT_ROOT;
const PROJECT_ROOT = path.resolve(process.env.DECK_PROJECT_ROOT || process.cwd());
const PROJECT_LIB = path.join(PROJECT_ROOT, 'lib');
const SLIDES_PATH = path.resolve(process.env.SLIDES_JS || path.join(PROJECT_LIB, 'slides.js'));

function runPreflightIfEnabled() {
  if (process.env.SLIDE_PIPELINE_STRICT === '1' && !process.env.SLIDE_PIPELINE_RUN_ID) {
    console.error('Hard-Locked Workflow Mode: direct node build.js is blocked when SLIDE_PIPELINE_STRICT=1.');
    console.error('Use node scripts/slide_pipeline.js --target both ... so the validator, assets, build, and trace run together.');
    process.exit(2);
  }
  if (process.env.SLIDE_PIPELINE_ENFORCE === '0') return;
  const validator = path.join(SCRIPT_ROOT, 'enforce_contract.js');
  if (!fs.existsSync(validator)) {
    console.warn('slide-image-dual-render: enforce_contract.js not found; skipping preflight validator.');
    return;
  }
  const args = [validator, '--phase', 'preflight', '--target', process.env.TARGET || 'both', '--project', PROJECT_ROOT];
  if (process.env.SLIDES) args.push('--slides', process.env.SLIDES);
  const res = spawnSync(process.execPath, args, { cwd: PROJECT_ROOT, env: process.env, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('slide-image-dual-render: preflight contract validation failed.');
    process.exit(res.status || 1);
  }
}

runPreflightIfEnabled();

const pptxgen = require('pptxgenjs');
const { makePptxSurface } = require('./lib/atoms_pptx');
const { makeHtmlSurface } = require('./lib/atoms_html');
const { FONT, FONT_POLICY, PXW, PXH, persistFontResolutionManifest, FONT_MANIFEST_PATH } = require('./lib/kit');
const OM = require('./lib/object_manifest');
const { loadProfile, paletteC, isLightProfile } = require('./lib/profile');
const _P = loadProfile();
const PAGEBG = _P ? (isLightProfile(_P) ? 'EAEEF3' : paletteC(_P).bg) : '05080f';

const SW = 13.333, SH = 7.5;
const escAttr = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function loadSlides(slidesPath) {
  if (!fs.existsSync(slidesPath)) throw new Error(`missing deck-owned slides file: ${slidesPath}`);
  const code = fs.readFileSync(slidesPath, 'utf8');
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id === './kit' || id === 'kit') return require('./lib/kit');
    if (id === './profile' || id === 'profile') return require('./lib/profile');
    if (id.startsWith('./') || id.startsWith('../')) return require(path.resolve(path.dirname(slidesPath), id));
    return require(id);
  };
  const context = {
    require: localRequire,
    module: mod,
    exports: mod.exports,
    __dirname: path.dirname(slidesPath),
    __filename: slidesPath,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, context, { filename: slidesPath, displayErrors: true });
  return mod.exports;
}

const SL = loadSlides(SLIDES_PATH);
const ALL = Object.keys(SL).filter(k => /^s\d+$/.test(k)).sort((a,b)=>+a.slice(1)-+b.slice(1));
const which = process.env.SLIDES ? process.env.SLIDES.split(',').map(n=>n.trim()) : null;
const order = which ? ALL.filter(k => which.includes(k.slice(1))) : ALL;

async function buildPptx(outFile, opts = {}){
  const pptx = new pptxgen();
  pptx.defineLayout({ name:'W', width:SW, height:SH });
  pptx.layout = 'W';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  order.forEach(k=>{
    const slideNo = Number(k.slice(1));
    OM.setCurrentSlide(slideNo);
    OM.setEnabled(!!opts.record);
    const slide = pptx.addSlide();
    const surf = makePptxSurface(pptx, slide, {
      slideNo,
      textFit:opts.textFit,
      textFitSafetyFactor:opts.textFitSafetyFactor,
    });
    SL[k](surf);
    OM.setEnabled(false);
  });
  await pptx.writeFile({ fileName: outFile });
  console.log('wrote', outFile);
}

function buildHtml(outFile, opts = {}){
  const slidesHtml = order.map((k)=>{
    const slideNo = k.slice(1);
    OM.setCurrentSlide(Number(slideNo));
    OM.setEnabled(!!opts.record);
    const surf = makeHtmlSurface({ slideNo:Number(slideNo), textOnly:!!opts.textOnly });
    SL[k](surf);
    OM.setEnabled(false);
    return `<section class="slide" id="slide-${slideNo}" data-slide="${slideNo}" style="background:#${surf._bg()};">\n${surf._html()}\n</section>`;
  }).join('\n');

  const doc = `<!DOCTYPE html>
<html lang="${process.env.DECK_LANG || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${process.env.DECK_TITLE || 'Deck'}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{background:#${PAGEBG};font-family:${FONT_POLICY.htmlCssFamily};}
  .deck{display:flex;flex-direction:column;align-items:center;gap:28px;padding:28px 0 60px;}
  .slide{position:relative;width:${PXW}px;height:${PXH}px;overflow:hidden;border-radius:10px;
         box-shadow:0 18px 50px rgba(0,0,0,.55);flex:0 0 auto;}
  .stage{transform-origin:top center;}
  body[data-qa-static="1"]{width:${PXW}px;min-width:${PXW}px;height:${PXH}px;min-height:${PXH}px;overflow:auto;}
  body[data-qa-static="1"] .deck{display:block;width:${PXW}px;padding:0;gap:0;align-items:flex-start;}
  body[data-qa-static="1"] .slide{transform:none!important;transform-origin:top left!important;margin:0!important;border-radius:0!important;box-shadow:none!important;}
  @media (max-width:1740px){ .deck{padding-top:18px;} }
</style>
</head>
<body data-deck-pxw="${PXW}" data-deck-pxh="${PXH}" data-render-font="${escAttr(FONT_POLICY.resolved)}">
<div class="deck" id="deck">
${slidesHtml}
</div>
<script>
  window.__slideFontPolicy = ${JSON.stringify(FONT_POLICY)};
  function qaStaticEnabled(){
    try {
      var params = new URLSearchParams(window.location.search || '');
      if(params.has('qa') || params.has('qa-static')) return true;
    } catch(e) {}
    return /(^|[#&])qa($|[=&])|qa-static/.test(window.location.hash || '');
  }
  function setQaStaticMode(enabled){
    document.documentElement.dataset.qaStatic = enabled ? '1' : '0';
    document.body.dataset.qaStatic = enabled ? '1' : '0';
  }
  function recordRenderMeta(scale){
    var first = document.querySelector('.slide');
    var rect = first ? first.getBoundingClientRect() : null;
    window.__slideRenderMeta = {
      deckPxw:${PXW},
      deckPxh:${PXH},
      qaStaticMode: qaStaticEnabled(),
      appliedScale: scale,
      fontPolicy: window.__slideFontPolicy,
      firstSlideBoundingBox: rect ? { x:rect.x, y:rect.y, width:rect.width, height:rect.height } : null
    };
  }
  function shrinkFit(){
    document.querySelectorAll('[data-shrink]').forEach(function(el){
      var inner = el.firstElementChild;
      if(!inner) return;
      if(el.dataset.basefs){ el.style.fontSize = el.dataset.basefs + 'px'; }
      else { el.dataset.basefs = parseFloat(getComputedStyle(el).fontSize); }
      var fs = parseFloat(getComputedStyle(el).fontSize);
      var guard = 0;
      while(guard++ < 140 && inner.scrollWidth > el.clientWidth + 0.5 && fs > 6){ fs -= 0.5; el.style.fontSize = fs + 'px'; }
    });
    document.querySelectorAll('[data-text-fit-id]').forEach(function(el){
      var px = parseFloat(getComputedStyle(el).fontSize);
      if(Number.isFinite(px)) el.dataset.effectiveFontSizePt = (px / ${PXW / SW / 72}).toFixed(4);
    });
  }
  function fit(){
    var qa = qaStaticEnabled();
    setQaStaticMode(qa);
    if(qa){
      document.querySelectorAll('.slide').forEach(function(sl){
        sl.style.transform = 'none';
        sl.style.transformOrigin = 'top left';
        sl.style.marginBottom = '0px';
        sl.dataset.appliedScale = '1';
      });
      recordRenderMeta(1);
      return;
    }
    var maxW = Math.min(Math.max(window.innerWidth - 32, 1), ${PXW});
    var scale = maxW / ${PXW};
    document.querySelectorAll('.slide').forEach(function(sl){
      sl.style.transform = 'scale('+scale+')';
      sl.style.transformOrigin = 'top center';
      sl.style.marginBottom = (-${PXH}*(1-scale) + 28) + 'px';
      sl.dataset.appliedScale = String(scale);
    });
    recordRenderMeta(scale);
  }
  function runAll(){ shrinkFit(); fit(); }
  runAll();
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(runAll); }
  window.addEventListener('load', runAll);
  window.addEventListener('resize', fit);
  requestAnimationFrame(function(){ requestAnimationFrame(runAll); });
  setTimeout(runAll, 400); setTimeout(runAll, 1200);
</script>
</body>
</html>`;
  fs.writeFileSync(outFile, doc);
  if(!opts.quiet) console.log('wrote', outFile, `(${(doc.length/1024/1024).toFixed(1)} MB)`);
}

function findChromeLike(){
  const candidates = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function parseTextFitDom(dom){
  const entries = {};
  const tags = String(dom||'').match(/<div\b[^>]*data-text-fit-id="[^"]+"[^>]*>/gi) || [];
  for(const tag of tags){
    const id = /data-text-fit-id="([^"]+)"/i.exec(tag);
    const requested = /data-requested-font-size-pt="([^"]+)"/i.exec(tag);
    const effective = /data-effective-font-size-pt="([^"]+)"/i.exec(tag);
    if(!id || !effective) continue;
    const requestedFontSizePt = Number(requested ? requested[1] : NaN);
    const fontSizePt = Number(effective[1]);
    if(!Number.isFinite(fontSizePt) || fontSizePt <= 0) continue;
    const shrinkThreshold = Number.isFinite(requestedFontSizePt)
      ? Math.max(0.05, requestedFontSizePt * 0.005)
      : 0.05;
    entries[id[1]] = {
      requestedFontSizePt:Number.isFinite(requestedFontSizePt) ? requestedFontSizePt : null,
      fontSizePt,
      shrinkApplied:Number.isFinite(requestedFontSizePt) ? fontSizePt < requestedFontSizePt - shrinkThreshold : false,
    };
  }
  return entries;
}

function hashFileIfPresent(file){
  try { return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : ''; }
  catch (_) { return ''; }
}

function stableFontResolutionFingerprint(file){
  try {
    if(!file || !fs.existsSync(file)) return '';
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mappings = Array.isArray(data.mappings) ? data.mappings.map(row => ({
      original:String(row.original||''),
      resolved:String(row.resolved||''),
      exact:row.exact !== false,
      fallbackApplied:!!row.fallbackApplied,
    })).sort((a,b) => a.original.localeCompare(b.original) || a.resolved.localeCompare(b.resolved)) : [];
    return crypto.createHash('sha256').update(JSON.stringify(mappings)).digest('hex');
  } catch (_) { return ''; }
}

function textFitFingerprint(){
  const profilePath = process.env.DECK_PROFILE ? path.resolve(process.env.DECK_PROFILE) : '';
  const fontManifestPath = process.env.DECK_FONT_RESOLUTION_MANIFEST ? path.resolve(process.env.DECK_FONT_RESOLUTION_MANIFEST) : '';
  const fontUsagePath = process.env.DECK_FONT_USAGE ? path.resolve(process.env.DECK_FONT_USAGE) : '';
  const payload = {
    contract:'slide-image-dual-render.text-fit.v1',
    slidesJs:hashFileIfPresent(SLIDES_PATH),
    atomsHtml:hashFileIfPresent(path.join(SCRIPT_ROOT, 'lib', 'atoms_html.js')),
    selectedSlides:order,
    sourcePixelCanvas:{ width:PXW, height:PXH },
    profile:hashFileIfPresent(profilePath),
    fontResolution:stableFontResolutionFingerprint(fontManifestPath),
    fontUsage:hashFileIfPresent(fontUsagePath),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildTextFitManifest(){
  const started = Date.now();
  const manifestPath = path.join(PROJECT_ROOT, 'out', 'text_fit_manifest.json');
  const configuredSafety = Number(process.env.DECK_PPTX_TEXT_FIT_SAFETY || 0.98);
  const pptxSafetyFactor = Number.isFinite(configuredSafety)
    ? Math.min(Math.max(configuredSafety, 0.8), 1)
    : 0.98;
  const sourceFingerprint = textFitFingerprint();
  try {
    const cached = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if(cached && cached.status === 'ok' && cached.sourceFingerprint === sourceFingerprint && cached.entries && Object.keys(cached.entries).length){
      const manifest = Object.assign({}, cached, {
        cacheHit:true,
        elapsedMs:Date.now()-started,
        cacheLookupElapsedMs:Date.now()-started,
        pptxSafetyFactor,
      });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log('reused', manifestPath, `(${manifest.textCount} text boxes; fingerprint cache hit)`);
      return { manifestPath, manifest };
    }
  } catch (_) {}
  const chrome = findChromeLike();
  if(!chrome) throw new Error('Deterministic PPTX shrink-to-fit requires local Chrome or Edge, but neither executable was found.');
  const safeRunId = String(process.env.SLIDE_PIPELINE_RUN_ID || process.pid).replace(/[^a-zA-Z0-9_-]/g, '_');
  const probePath = path.join(PROJECT_ROOT, 'out', `.text-fit-probe-${safeRunId}.html`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-text-fit-'));
  try {
    buildHtml(probePath, { record:false, textOnly:true, quiet:true });
    const baseArgs = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      '--disable-background-networking', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDir}`, `--window-size=${PXW},${PXH}`, '--virtual-time-budget=1800',
      '--dump-dom', `${pathToFileURL(probePath).href}?qa=1`,
    ];
    let result = spawnSync(chrome, baseArgs, { encoding:'utf8', windowsHide:true, maxBuffer:64*1024*1024, timeout:30000 });
    if(result.status !== 0){
      const fallbackArgs = baseArgs.slice();
      fallbackArgs[0] = '--headless';
      result = spawnSync(chrome, fallbackArgs, { encoding:'utf8', windowsHide:true, maxBuffer:64*1024*1024, timeout:30000 });
    }
    if(result.error || result.status !== 0){
      const detail = result.error ? result.error.message : String(result.stderr||result.stdout||'').trim();
      throw new Error(`Text-fit browser measurement failed: ${detail || `exit ${result.status}`}`);
    }
    const entries = parseTextFitDom(result.stdout);
    if(!Object.keys(entries).length) throw new Error('Text-fit browser measurement produced no resolved text entries.');
    const measurementElapsedMs = Date.now()-started;
    const manifest = {
      schemaVersion:'slide-image-dual-render.text-fit.v1',
      generatedAt:new Date().toISOString(),
      status:'ok',
      method:'chrome-dom-font-measurement',
      browser:chrome,
      sourceFingerprint,
      cacheHit:false,
      sourcePixelCanvas:{ width:PXW, height:PXH },
      slideNumbers:order.map(k => Number(k.slice(1))),
      textCount:Object.keys(entries).length,
      shrinkCount:Object.values(entries).filter(entry => entry.shrinkApplied).length,
      pptxSafetyFactor,
      elapsedMs:measurementElapsedMs,
      measurementElapsedMs,
      cacheLookupElapsedMs:0,
      entries,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log('wrote', manifestPath, `(${manifest.textCount} text boxes; ${manifest.shrinkCount} pre-shrunk)`);
    return { manifestPath, manifest };
  } finally {
    try { if(fs.existsSync(probePath)) fs.unlinkSync(probePath); } catch (_) {}
    try { fs.rmSync(profileDir, { recursive:true, force:true }); } catch (_) {}
  }
}

function writeBuildTrace(target, pptxOut, htmlOut, textFitEvidence) {
  const outputs = {};
  if (target === 'pptx' || target === 'both') outputs.pptx = path.resolve(pptxOut);
  if (target === 'html' || target === 'both') outputs.html = path.resolve(htmlOut);
  const firstOut = outputs.pptx || outputs.html;
  const traceDir = firstOut ? path.dirname(firstOut) : path.join(PROJECT_ROOT, 'out');
  fs.mkdirSync(traceDir, { recursive: true });
  const buildTrace = {
    nativeObjectManifest: path.join(traceDir, 'native_object_manifest.json'),
    timestamp: new Date().toISOString(),
    startedAtMs: BUILD_STARTED_MS,
    finishedAtMs: Date.now(),
    runId: process.env.SLIDE_PIPELINE_RUN_ID || null,
    invokedBySlidePipeline: !!process.env.SLIDE_PIPELINE_RUN_ID,
    invokedByPipeline: !!process.env.SLIDE_PIPELINE_RUN_ID,
    enforcementDisabled: process.env.SLIDE_PIPELINE_ENFORCE === '0',
    strictMode: process.env.SLIDE_PIPELINE_STRICT === '1',
    target,
    slides: process.env.SLIDES || null,
    outputs,
    fontPolicy: FONT_POLICY,
    htmlQaStaticMode: {
      enabledBy: ['?qa=1', '?qa-static=1', '#qa', '#qa-static'],
      expectedSlideSize: { width: PXW, height: PXH },
      transformScaleInQaMode: 1,
      webFontImportsEnabled: FONT_POLICY.webFontImportsEnabled,
    },
    textFit: textFitEvidence ? {
      manifestPath:textFitEvidence.manifestPath,
      status:textFitEvidence.manifest.status,
      method:textFitEvidence.manifest.method,
      textCount:textFitEvidence.manifest.textCount,
      shrinkCount:textFitEvidence.manifest.shrinkCount,
      pptxSafetyFactor:textFitEvidence.manifest.pptxSafetyFactor,
      elapsedMs:textFitEvidence.manifest.elapsedMs,
      cacheHit:!!textFitEvidence.manifest.cacheHit,
    } : null,
    projectRoot: PROJECT_ROOT,
    skillRoot: SKILL_ROOT,
    buildJs: path.resolve(__filename),
    slidesJs: SLIDES_PATH,
  };
  fs.writeFileSync(path.join(traceDir, 'build_trace.json'), JSON.stringify(buildTrace, null, 2), 'utf8');
  const renderTrace = path.join(traceDir, 'render_trace.json');
  if (fs.existsSync(renderTrace)) {
    try {
      const data = JSON.parse(fs.readFileSync(renderTrace, 'utf8'));
      data.build = buildTrace;
      fs.writeFileSync(renderTrace, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn('slide-image-dual-render: could not update render_trace.json build section:', err.message);
    }
  }
}

(async ()=>{
  const target = process.env.TARGET || 'both';
  if(!['pptx','html','both'].includes(target)){
    console.error(`invalid TARGET: ${target}; expected pptx, html, or both`);
    process.exit(2);
  }
  const pptxOut = process.env.PPTX_OUT || path.join(PROJECT_ROOT,'out','deck.pptx');
  const htmlOut = process.env.HTML_OUT || path.join(PROJECT_ROOT,'out','deck.html');
  OM.reset();
  const textFitEvidence = (target==='pptx' || target==='both') ? buildTextFitManifest() : null;
  if(target==='pptx' || target==='both') await buildPptx(pptxOut, {
    record:true,
    textFit:textFitEvidence.manifest.entries,
    textFitSafetyFactor:textFitEvidence.manifest.pptxSafetyFactor,
  });
  if(target==='html' || target==='both') buildHtml(htmlOut, { record: target === 'html' });
  const nativeManifestPath = path.join(PROJECT_ROOT, 'out', 'native_object_manifest.json');
  OM.writeNativeManifest(nativeManifestPath);
  console.log('wrote', nativeManifestPath);
  persistFontResolutionManifest(FONT_MANIFEST_PATH);
  console.log('wrote', FONT_MANIFEST_PATH);
  writeBuildTrace(target, pptxOut, htmlOut, textFitEvidence);
})();
