// build.js — render all slides to BOTH pptx and html from the same slide code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

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
const { FONT, FONT_POLICY, PXW, PXH } = require('./lib/kit');
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
    const surf = makePptxSurface(pptx, slide);
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
    const surf = makeHtmlSurface();
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
  console.log('wrote', outFile, `(${(doc.length/1024/1024).toFixed(1)} MB)`);
}

function writeBuildTrace(target, pptxOut, htmlOut) {
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
  if(target==='pptx' || target==='both') await buildPptx(pptxOut, { record: true });
  if(target==='html' || target==='both') buildHtml(htmlOut, { record: target === 'html' });
  const nativeManifestPath = path.join(PROJECT_ROOT, 'out', 'native_object_manifest.json');
  OM.writeNativeManifest(nativeManifestPath);
  console.log('wrote', nativeManifestPath);
  writeBuildTrace(target, pptxOut, htmlOut);
})();

