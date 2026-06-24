// atoms_pptx.js — pptxgenjs surface implementing unified atoms (PX coords).
const { PXW, PXH, FONT } = require('./kit');
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

// content -> pptxgenjs text array
function toRuns(content, baseColor){
  if(Array.isArray(content)){
    return content.map(r=>({ text:r.text, options:{
      color:r.color||baseColor, bold:!!r.bold, italic:!!r.italic, breakLine:!!r.breakLine,
    }}));
  }
  const str = String(content);
  if(str.indexOf('\n')>=0){
    const parts = str.split('\n');
    return parts.map((p,i)=>({ text:p, options:{ breakLine:i<parts.length-1 } }));
  }
  return str;
}

function makePptxSurface(pptx, slide){
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
      OM.recordText(content, x,y,w,h,'surface.txt');
      slide.addText(toRuns(content, o.color||'F2F7FC'), {
        x:ix(x), y:iy(y), w:ix(w), h:iy(h),
        fontFace:FONT, fontSize:o.sz||12, color:o.color||'F2F7FC',
        bold:!!o.bold, italic:!!o.italic, align:o.align||'left', valign:o.valign||'middle',
        lineSpacingMultiple:o.lh!=null?o.lh:1.0, charSpacing:o.cs,
        margin:o.margin!=null?o.margin:0, wrap:o.wrap!=null?o.wrap:true, shrinkText:!!o.shrink,
      });
    },
  };
}

module.exports = { makePptxSurface, ix, iy, safeLineGeom, linePt };


