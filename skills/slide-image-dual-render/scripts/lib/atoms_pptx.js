// atoms_pptx.js — pptxgenjs surface implementing unified atoms (PX coords).
const { PXW, PXH, FONT, resolveRenderFont, fontMappingFor } = require('./kit');
const OM = require('./object_manifest');

const SW = 13.333, SH = 7.5;
const ix = px => +(px * SW / PXW).toFixed(3);
const iy = px => +(px * SH / PXH).toFixed(3);
const rad = px => +(px * SW / PXW).toFixed(3); // radius in inches ~ px width scale
const PT_PER_SOURCE_PX = 72 * SW / PXW;
const linePt = px => {
  const n = Number(px == null ? 1 : px);
  if(!Number.isFinite(n)) return +PT_PER_SOURCE_PX.toFixed(3);
  return +Math.max(Math.abs(n) * PT_PER_SOURCE_PX, 0.1).toFixed(3);
};

function shadow(){ return { type:'outer', color:'000000', blur:6, offset:2, angle:90, opacity:0.45 }; }

function safeLineGeom(x,y,w,h){
  let nx=Number(x)||0, ny=Number(y)||0, nw=Number(w)||0, nh=Number(h)||0;
  if(nw < 0){ nx += nw; nw = -nw; }
  if(nh < 0){ ny += nh; nh = -nh; }
  if(nw === 0) nw = 0.25;
  if(nh === 0) nh = 0.25;
  return { x:nx, y:ny, w:nw, h:nh };
}

// Qualified expected xfrm, not proof of emitted OOXML or source fidelity. Use
// the very same numeric inch arguments passed to PptxGenJS, never the rounded
// diagnostic source bbox. PptxGenJS 4.0.1 treats values >=100 as EMU rather than
// inches; degenerate/defaulted geometry is outside this bounded projection.
// Only explicitly tagged calls receive evidence, preserving untagged records.
function emitterGeometry(pptx, geometry, sourceRefs, normalization='none', lineIssue=null, lineFlips={}){
  if(sourceRefs === undefined) return undefined;
  const result = {
    schemaVersion:'slide-image-dual-render.emitter-geometry.v1',
    emitterVersion:pptx.version || null, units:'EMU', status:'UNSUPPORTED',
    reason:null, sourceNormalization:normalization, transform:null,
  };
  if(pptx.version !== '4.0.1') result.reason = 'UNVERIFIED_PPTXGENJS_VERSION';
  else if(Object.values(geometry).some(n => !Number.isFinite(n) || n < 0 || n >= 100)
      || geometry.w <= 0 || geometry.h <= 0) result.reason = 'UNSUPPORTED_NUMERIC_GEOMETRY';
  else {
    const [x,y,cx,cy] = ['x','y','w','h'].map(key => Math.round(geometry[key] * 914400));
    if(![x,y,cx,cy].every(Number.isSafeInteger) || cx <= 0 || cy <= 0) result.reason = 'UNSUPPORTED_NUMERIC_GEOMETRY';
    else {
      result.transform = {x,y,cx,cy,flipH:lineFlips.flipH === true,flipV:lineFlips.flipV === true,rotation:0};
      result.reason = lineIssue;
      result.status = lineIssue ? 'UNSUPPORTED' : 'PROJECTED';
    }
  }
  return result;
}

function normalizedRunSize(value, fallback){
  const n = Number(value != null ? value : fallback);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

// content -> pptxgenjs text array
// PptxGenJS does not reliably inherit text-box typography into rich-text runs,
// so every generated run must carry the effective font face and size.
function toRuns(content, baseColor, baseFont, baseSize, sizeScale=1){
  if(Array.isArray(content)){
    return content.map(r=>({ text:r.text, options:{
      color:r.color||baseColor, bold:!!r.bold, italic:!!r.italic, breakLine:!!r.breakLine,
      fontFace:resolveRenderFont(r.fontFace||r.fontFamily||baseFont),
      fontSize:(r.fontSize != null || r.sz != null)
        ? normalizedRunSize(r.fontSize != null ? r.fontSize : r.sz, baseSize) * sizeScale
        : normalizedRunSize(null, baseSize),
    }}));
  }
  const str = String(content);
  if(str.indexOf('\n')>=0){
    const parts = str.split('\n');
    return parts.map((p,i)=>({ text:p, options:{
      color:baseColor,
      fontFace:resolveRenderFont(baseFont),
      fontSize:normalizedRunSize(null, baseSize),
      breakLine:i<parts.length-1,
    } }));
  }
  return str;
}

// Canonical logical text of the OOXML emitted by the supported PptxGenJS text
// path: decoded a:t content, a:br as LF, and LF between a:p paragraphs. Preserve
// whitespace and Unicode; do not hash formatting or raw JSON. Consume toRuns'
// result, not the author input (which is transformed for plain multiline text).
// Embedded multiline rich runs end a paragraph after every split line; final
// breakLine does not add an extra paragraph. XML normalizes remaining CR to LF.
// Qualified only against PptxGenJS 4.0.1 (actual runtime evidence is retained).
// Unknown versions keep authored identity but receive no projected text digest.
// Emitted-package regression tests guard these library-dependent semantics.
function serializePptxText(runs){
  const input = Array.isArray(runs) && runs.length ? runs : [{ text:Array.isArray(runs) ? '' : runs }];
  const pieces = [];
  for(const run of input){
    const text = String(run.text || '').replace(/\r*\n/g, '\n');
    if(text.includes('\n') && !text.endsWith('\n')){
      for(const line of text.split('\n')) pieces.push({ text:line, breakLine:true });
    } else {
      pieces.push({ text, breakLine:!!(run.options && run.options.breakLine) });
    }
  }
  return pieces.map((piece, index) =>
    piece.text.replace(/\r\n?/g, '\n') + (piece.breakLine && index < pieces.length - 1 ? '\n' : '')
  ).join('');
}

function makePptxSurface(pptx, slide, opts={}){
  let textIndex = 0;
  const slideNo = Number(opts.slideNo) || 1;
  const textFit = opts.textFit && typeof opts.textFit === 'object' ? opts.textFit : {};
  const configuredSafety = Number(opts.textFitSafetyFactor);
  const textFitSafetyFactor = Number.isFinite(configuredSafety)
    ? Math.min(Math.max(configuredSafety, 0.8), 1)
    : 1;
  return OM.addSourceReferenceSupport({
    _pptx: pptx,
    bgFill(hex){ slide.background = { color: hex }; },
    img(p, x,y,w,h){
      const geometry = {x:ix(x), y:iy(y), w:ix(w), h:iy(h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      OM.recordImage(p, x,y,w,h, refs, emitterGeometry(pptx, geometry, refs));
      slide.addImage({ path:p, ...geometry });
    },
    rrect(x,y,w,h,o={}){
      const geometry = {x:ix(x), y:iy(y), w:ix(w), h:iy(h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      OM.record({ type:'panel', x,y,w,h, editable:true, source:'surface.rrect',
        ...(refs === undefined ? {} : {emitterGeometry:emitterGeometry(pptx, geometry, refs)}) }, refs);
      slide.addShape(pptx.ShapeType.roundRect, {
        ...geometry,
        fill:{ color:o.fill||'0B1B2D', transparency:o.fillTrans!=null?o.fillTrans:0 },
        line:{ color:o.line||'2A4A6E', width:linePt(o.lineW) },
        rectRadius: rad(o.radius!=null?o.radius:9),
        shadow: o.shadow?shadow():undefined,
      });
    },
    ell(x,y,w,h,o={}){
      const geometry = {x:ix(x), y:iy(y), w:ix(w), h:iy(h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.ell',
        ...(refs === undefined ? {} : {emitterGeometry:emitterGeometry(pptx, geometry, refs)}) }, refs);
      slide.addShape(pptx.ShapeType.ellipse, {
        ...geometry,
        fill:{ color:o.fill||'1F6FB5' }, line:{ color:o.line||o.fill||'1F6FB5', width:linePt(o.lineW) },
      });
    },
    chev(x,y,w,h,o={}){
      const geometry = {x:ix(x), y:iy(y), w:ix(w), h:iy(h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.chev',
        ...(refs === undefined ? {} : {emitterGeometry:emitterGeometry(pptx, geometry, refs)}) }, refs);
      slide.addShape(pptx.ShapeType.chevron, {
        ...geometry,
        fill:{ color:o.fill||'0C1C30', transparency:o.fillTrans!=null?o.fillTrans:0 },
        line:{ color:o.line||'2C547E', width:linePt(o.lineW) },
      });
    },
    ln(x,y,w,h,o={}){
      const g = safeLineGeom(x,y,w,h);
      const geometry = {x:ix(g.x), y:iy(g.y), w:ix(g.w), h:iy(g.h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      // A positive bounding box alone loses diagonal endpoint orientation.
      // Keep existing axis normalization and derive only internal sign flips.
      const sw = Number(w)||0, sh = Number(h)||0;
      const diagonal = sw !== 0 && sh !== 0;
      const direction = { ...(diagonal && sw < 0 ? {flipH:true} : {}),
        ...(diagonal && sh < 0 ? {flipV:true} : {}) };
      // Record the actual flips, but keep this new signed geometry outside the
      // existing qualified consumer profile until that profile is reviewed.
      const lineIssue = refs === undefined ? null : (o.flipH || o.flipV || o.rotate) ? 'UNSUPPORTED_LINE_TRANSFORM'
        : ((w < 0 || h < 0) && Number(w) !== 0 && Number(h) !== 0) ? 'UNSUPPORTED_LINE_DIRECTION' : null;
      OM.record({ type:'rule', x,y,w,h, editable:true, source:'surface.ln',
        ...(refs === undefined ? {} : {emitterGeometry:emitterGeometry(pptx, geometry, refs, 'safe-line-geom-v1', lineIssue, direction)}) }, refs);
      slide.addShape(pptx.ShapeType.line, {
        ...geometry, ...direction,
        line:{ color:o.color||'2A4A6E', width:linePt(o.width), dashType:o.dash||'solid' },
      });
    },
    txt(content, x,y,w,h, o={}){
      const textFitId = `${slideNo}:${++textIndex}`;
      const requestedSize = normalizedRunSize(null, o.sz||12);
      const fitEntry = textFit[textFitId];
      let measuredSize = normalizedRunSize(
        fitEntry && typeof fitEntry === 'object' ? fitEntry.fontSizePt : fitEntry,
        requestedSize
      );
      if(o.shrink && fitEntry && typeof fitEntry === 'object' && fitEntry.shrinkApplied){
        measuredSize *= textFitSafetyFactor;
      }
      const resolvedSize = +(o.shrink ? Math.min(requestedSize, measuredSize) : requestedSize).toFixed(3);
      const sizeScale = requestedSize > 0 ? resolvedSize / requestedSize : 1;
      const originalFont = o.fontFace||o.fontFamily||FONT;
      const resolvedFont = resolveRenderFont(originalFont);
      const mappings = Array.isArray(content)
        ? content.map(r => fontMappingFor(r.fontFace||r.fontFamily||originalFont))
        : [fontMappingFor(originalFont)];
      const runs = toRuns(content, o.color||'F2F7FC', originalFont, resolvedSize, sizeScale);
      const textContent = serializePptxText(runs);
      const textContentEmitterVersion = pptx.version || null;
      const textContentIdentityError = textContentEmitterVersion !== '4.0.1'
        ? 'UNVERIFIED_PPTXGENJS_VERSION'
        : /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(textContent)
          ? 'UNSUPPORTED_XML_TEXT' : null;
      const geometry = {x:ix(x), y:iy(y), w:ix(w), h:iy(h)};
      const refs = OM.sourceRefsFor(this, slideNo);
      OM.recordText(content, x,y,w,h,'surface.txt', {
        originalFont, resolvedFont, fontMappings:mappings,
        textContent, textContentEmitterVersion, textContentIdentityError,
        textContentSerialization:'pptxgenjs-paragraph-text-v1', representation:'native-text',
        ...(refs === undefined ? {} : {emitterGeometry:emitterGeometry(pptx, geometry, refs)}),
      }, refs);
      slide.addText(runs, {
        ...geometry,
        fontFace:resolvedFont, fontSize:resolvedSize, color:o.color||'F2F7FC',
        bold:!!o.bold, italic:!!o.italic, align:o.align||'left', valign:o.valign||'middle',
        lineSpacingMultiple:o.lh!=null?o.lh:1.0, charSpacing:o.cs,
        margin:o.margin!=null?o.margin:0, wrap:o.wrap!=null?o.wrap:true, shrinkText:!!o.shrink,
      });
    },
  }, slideNo);
}

module.exports = { makePptxSurface, ix, iy, safeLineGeom, linePt };
