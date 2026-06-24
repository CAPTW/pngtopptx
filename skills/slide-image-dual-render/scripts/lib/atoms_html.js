// atoms_html.js — HTML surface implementing unified atoms (PX coords).
// Produces a <div class="slide"> with absolutely-positioned children.
const fs = require('fs');
const OM = require('./object_manifest');
const { PXW, PXH, FONT_POLICY } = require('./kit');

const SW = 13.333;
const PT2PX = PXW / SW / 72;
const FONT_STACK = FONT_POLICY.htmlCssFamily || `${FONT_POLICY.resolved}, sans-serif`;
const EPS = 0.0001;
const imgCache = new Map();
function dataURI(p){
  if(imgCache.has(p)) return imgCache.get(p);
  const b = fs.readFileSync(p);
  const ext = p.toLowerCase().endsWith('.jpg')||p.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  const uri = `data:image/${ext};base64,${b.toString('base64')}`;
  imgCache.set(p, uri);
  return uri;
}
const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function chevClip(w,h){
  const d = Math.min(h*0.5, w*0.4);
  // right point + left notch
  return `polygon(0 0, ${(w-d).toFixed(1)}px 0, ${w.toFixed(1)}px ${(h/2).toFixed(1)}px, ${(w-d).toFixed(1)}px ${h}px, 0 ${h}px, ${d.toFixed(1)}px ${(h/2).toFixed(1)}px)`;
}

function alpha(trans){ return trans!=null ? (1 - trans/100) : 1; }
function rgba(hex, a){
  const h = hex.replace('#','');
  const r=parseInt(h.substr(0,2),16), g=parseInt(h.substr(2,2),16), b=parseInt(h.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
}

function lineWidthPx(value){
  const n = Number(value == null ? 1 : value);
  if(!Number.isFinite(n)) return 1;
  return Math.max(Math.abs(n), 0.1);
}

function normalizeLineGeom(x,y,w,h){
  let nx=Number(x)||0, ny=Number(y)||0, nw=Number(w)||0, nh=Number(h)||0;
  const horizontal = Math.abs(nh) < EPS;
  const vertical = Math.abs(nw) < EPS;
  if(nw < 0){ nx += nw; nw = -nw; }
  if(nh < 0){ ny += nh; nh = -nh; }
  if(horizontal) return { x:nx, y:ny, w:Math.max(nw, 0.25), h:0, orientation:'horizontal' };
  if(vertical) return { x:nx, y:ny, w:0, h:Math.max(nh, 0.25), orientation:'vertical' };
  return { x:nx, y:ny, w:Math.max(nw, 0.25), h:Math.max(nh, 0.25), orientation:'diagonal' };
}

function runHTML(content, baseColor){
  if(Array.isArray(content)){
    return content.map(r=>{
      const st = `color:#${(r.color||baseColor)};${r.bold?'font-weight:700;':''}${r.italic?'font-style:italic;':''}`;
      return `<span style="${st}">${esc(r.text)}</span>${r.breakLine?'<br>':''}`;
    }).join('');
  }
  return esc(String(content)).replace(/\n/g,'<br>');
}

function makeHtmlSurface(){
  const parts = [];
  let bgColor = '020812';
  const S = {
    _html(){ return parts.join('\n'); },
    _bg(){ return bgColor; },
    bgFill(hex){ bgColor = hex; },
    img(p, x,y,w,h){
      OM.recordImage(p, x,y,w,h);
      parts.push(`<img src="${dataURI(p)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:fill;">`);
    },
    rrect(x,y,w,h,o={}){
      OM.record({ type:'panel', x,y,w,h, editable:true, source:'surface.rrect' });
      const a = alpha(o.fillTrans);
      const bg = o.fill ? rgba(o.fill, a) : 'transparent';
      const sh = o.shadow ? 'box-shadow:2px 2px 6px rgba(0,0,0,.45);' : '';
      parts.push(`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};border:${lineWidthPx(o.lineW)}px solid #${o.line||'2A4A6E'};border-radius:${o.radius!=null?o.radius:9}px;box-sizing:border-box;${sh}"></div>`);
    },
    ell(x,y,w,h,o={}){
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.ell' });
      parts.push(`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#${o.fill||'1F6FB5'};border:${lineWidthPx(o.lineW)}px solid #${o.line||o.fill||'1F6FB5'};border-radius:50%;box-sizing:border-box;"></div>`);
    },
    chev(x,y,w,h,o={}){
      OM.record({ type:'shape', x,y,w,h, editable:true, source:'surface.chev' });
      const a = alpha(o.fillTrans);
      const bg = o.fill ? rgba(o.fill, a) : 'transparent';
      // border emulated via stacked clip: draw line-colored chev behind, fill chev slightly inset
      parts.push(`<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#${o.line||'2C547E'};clip-path:${chevClip(w,h)};"></div>`);
      const bw = lineWidthPx(o.lineW);
      const iw = Math.max(w - bw*2, 0), ih = Math.max(h - bw*2, 0);
      parts.push(`<div style="position:absolute;left:${x+bw}px;top:${y+bw}px;width:${iw}px;height:${ih}px;background:${bg};clip-path:${chevClip(iw,ih)};"></div>`);
    },
    ln(x,y,w,h,o={}){
      OM.record({ type:'rule', x,y,w,h, editable:true, source:'surface.ln' });
      const g = normalizeLineGeom(x,y,w,h);
      const col = `#${o.color||'2A4A6E'}`;
      const style = o.dash==='dash' ? 'dashed' : 'solid';
      const bw = lineWidthPx(o.width);
      if(g.orientation==='horizontal'){ parts.push(`<div style="position:absolute;left:${g.x}px;top:${g.y}px;width:${g.w}px;height:0;border-top:${bw}px ${style} ${col};"></div>`); }
      else if(g.orientation==='vertical'){ parts.push(`<div style="position:absolute;left:${g.x}px;top:${g.y}px;height:${g.h}px;width:0;border-left:${bw}px ${style} ${col};"></div>`); }
      else { // diagonal fallback: thin rotated bar (rare)
        parts.push(`<div style="position:absolute;left:${g.x}px;top:${g.y}px;width:${Math.hypot(g.w,g.h)}px;height:0;border-top:${bw}px ${style} ${col};transform-origin:0 0;transform:rotate(${Math.atan2(g.h,g.w)}rad);"></div>`);
      }
    },
    txt(content, x,y,w,h, o={}){
      OM.recordText(content, x,y,w,h,'surface.txt');
      const fpx = (o.sz||12) * PT2PX;
      const ai = o.valign==='top'?'flex-start':o.valign==='bottom'?'flex-end':'center';
      const jc = o.align==='center'?'center':o.align==='right'?'flex-end':'flex-start';
      const ta = o.align||'left';
      const ws = (o.wrap===false || o.shrink) ? 'white-space:nowrap;' : '';
      const ls = o.cs!=null ? `letter-spacing:${o.cs}px;` : '';
      const innerWs = o.shrink ? 'white-space:nowrap;' : '';
      const inner = `<div style="width:100%;text-align:${ta};line-height:${o.lh!=null?o.lh:1.0};${ls}${innerWs}">${runHTML(content, o.color||'F2F7FC')}</div>`;
      const sa = o.shrink ? ' data-shrink="1"' : '';
      parts.push(`<div${sa} style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;align-items:${ai};justify-content:${jc};overflow:hidden;font-family:${FONT_STACK};font-size:${fpx.toFixed(1)}px;color:#${o.color||'F2F7FC'};${o.bold?'font-weight:700;':''}${o.italic?'font-style:italic;':''}${ws}box-sizing:border-box;">${inner}</div>`);
    },
  };
  return S;
}

module.exports = { makeHtmlSurface, PXW, PXH, normalizeLineGeom, lineWidthPx, FONT_STACK };

