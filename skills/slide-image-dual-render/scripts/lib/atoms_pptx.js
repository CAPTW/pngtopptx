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

function makePptxSurface(pptx, slide, opts={}){
  let textIndex = 0;
  const slideNo = Number(opts.slideNo) || 1;
  const textFit = opts.textFit && typeof opts.textFit === 'object' ? opts.textFit : {};
  const configuredSafety = Number(opts.textFitSafetyFactor);
  const textFitSafetyFactor = Number.isFinite(configuredSafety)
    ? Math.min(Math.max(configuredSafety, 0.8), 1)
    : 1;
  return {
    _pptx: pptx,
    bgFill(hex){ slide.background = { color: hex }; },
    img(p, x,y,w,h){ OM.recordImage(p, x,y,w,h); slide.addImage({ path:p, x:ix(x), y:iy(y), w:ix(w), h:iy(h) }); },
    rrect(x,y,w,h,o={}){
      OM.record({ type:'panel', x,y,w,h, editable:true, source:'surface.rrect' });
      slide.addShape(pptx.ShapeType.roundRect, {
        x:ix(x), y:iy(y), w:ix(w), h:iy(h),
        fill:{ color:o.fill||'0B1B2D', transparency:o.fillTrans!=null?o.fillTrans:0 },
        line:{ color:o.line||'2A4A6E', width:linePt(o.lineW) },
        rectRadius: rad(o.radius!=null?o.radius:9),
        shadow: o.shadow?shadow():undefined,
      });
    },
    ell(x,y,w,h,o={}){
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.ell' });
      slide.addShape(pptx.ShapeType.ellipse, {
        x:ix(x), y:iy(y), w:ix(w), h:iy(h),
        fill:{ color:o.fill||'1F6FB5' }, line:{ color:o.line||o.fill||'1F6FB5', width:linePt(o.lineW) },
      });
    },
    chev(x,y,w,h,o={}){
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.chev' });
      slide.addShape(pptx.ShapeType.chevron, {
        x:ix(x), y:iy(y), w:ix(w), h:iy(h),
        fill:{ color:o.fill||'0C1C30', transparency:o.fillTrans!=null?o.fillTrans:0 },
        line:{ color:o.line||'2C547E', width:linePt(o.lineW) },
      });
    },
    ln(x,y,w,h,o={}){
      OM.record({ type:'rule', x,y,w,h, editable:true, source:'surface.ln' });
      const g = safeLineGeom(x,y,w,h);
      slide.addShape(pptx.ShapeType.line, {
        x:ix(g.x), y:iy(g.y), w:ix(g.w), h:iy(g.h),
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
      OM.recordText(content, x,y,w,h,'surface.txt', { originalFont, resolvedFont, fontMappings:mappings });
      slide.addText(toRuns(content, o.color||'F2F7FC', originalFont, resolvedSize, sizeScale), {
        x:ix(x), y:iy(y), w:ix(w), h:iy(h),
        fontFace:resolvedFont, fontSize:resolvedSize, color:o.color||'F2F7FC',
        bold:!!o.bold, italic:!!o.italic, align:o.align||'left', valign:o.valign||'middle',
        lineSpacingMultiple:o.lh!=null?o.lh:1.0, charSpacing:o.cs,
        margin:o.margin!=null?o.margin:0, wrap:o.wrap!=null?o.wrap:true, shrinkText:!!o.shrink,
      });
    },
  };
}

module.exports = { makePptxSurface, ix, iy, safeLineGeom, linePt };
