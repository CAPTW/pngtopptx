'use strict';
// Invented primitive fixtures. Existing official factories and pinned in-memory
// serializer only; no browser, authoring, source classification or visual PASS.
const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const PptxGenJS=require('pptxgenjs'),JSZip=require('jszip');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'signed-line-'));
Object.assign(process.env,{HOME:home,DECK_PROJECT_ROOT:home,DECK_ASSETS:home,DECK_PXW:'1920',DECK_PXH:'1080',DECK_FONT:'sans-serif',DECK_FONT_INSTALL_DECISION:'unavailable'});
const lib=process.env.SIGNED_LINE_TEST_LIB||path.join(__dirname,'lib');
const OM=require(path.join(lib,'object_manifest'));
const {makePptxSurface,safeLineGeom,ix,iy}=require(path.join(lib,'atoms_pptx'));
const {makeHtmlSurface,normalizeLineGeom}=require(path.join(lib,'atoms_html'));
const cases=[[60,25],[-60,25],[60,-25],[-60,-25]];
const axes=[[60,0],[-60,0],[0,25],[0,-25],[0,0],[-0,25],[60,-0],[-0,-0]];
const clone=x=>JSON.parse(JSON.stringify(x));
const refs=()=>({schemaVersion:'slide-image-dual-render.source-refs.v1',slide:1,
 bindings:{jobContentHash:'a'.repeat(64),sourcePngSha256:'b'.repeat(64),measurementInventorySha256:'c'.repeat(64),reviewArtifactSha256:'d'.repeat(64)},
 claim:{kind:'extra',groupId:'invented-direction',purpose:'unresolved'},
 authority:Object.fromEntries(['semantic_truth','text_removal','native_admission','vector_eligibility','quality_accepted'].map(k=>[k,false]))});
function capture(w,h,tagged=false,options={}){
 OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];
 const surface=makePptxSurface({version:'4.0.1',ShapeType:{line:'line'}},{addShape:(type,options)=>calls.push({type,options:clone(options)})},{slideNo:1,textFit:{}});
 (tagged?surface.withSourceRefs(refs()):surface).ln(100,80,w,h,options);
 const rows=clone(OM.toJSON().slides['1'].objects),html=makeHtmlSurface({slideNo:1});html.ln(100,80,w,h,options);
 return {call:calls[0],rows,html:html._html()};
}
function corners(x,y,w,h,flipH,flipV){return[[x+(flipH?w:0),y+(flipV?h:0)],[x+(flipH?0:w),y+(flipV?0:h)]];}
function htmlEnds(html){
 const left=Number(html.match(/left:([^p]+)px/)[1]),top=Number(html.match(/top:([^p]+)px/)[1]);
 const width=Number(html.match(/width:([^p]+)px/)[1]),angle=Number(html.match(/rotate\(([^r]+)rad\)/)[1]);
 return [[left,top],[left+Math.cos(angle)*width,top+Math.sin(angle)*width]];
}
function close(a,b){a.flat().forEach((v,i)=>assert(Math.abs(v-b.flat()[i])<1e-9,`${a} differs from ${b}`));}
for(const [w,h] of cases)test(`both factories preserve ordered diagonal endpoints ${w},${h}`,()=>{
 const {call,html}=capture(w,h),o=call.options,g=safeLineGeom(100,80,w,h);
 assert.equal(!!o.flipH,w<0);assert.equal(!!o.flipV,h<0);
 assert.deepEqual([o.x,o.y,o.w,o.h],[ix(g.x),iy(g.y),ix(g.w),iy(g.h)]);
 const ends=corners(o.x,o.y,o.w,o.h,!!o.flipH,!!o.flipV);assert.equal(Math.sign(ends[1][0]-ends[0][0]),Math.sign(w));assert.equal(Math.sign(ends[1][1]-ends[0][1]),Math.sign(h));
 close(htmlEnds(html),[[100,80],[100+w,80+h]]);
});
test('positive-line drawing bytes/defaults and all axis/negative-zero branches stay unchanged',()=>{
 const c=capture(60,25);assert.deepEqual(c.call,{type:'line',options:{x:0.694,y:0.556,w:0.417,h:0.174,line:{color:'2A4A6E',width:0.5,dashType:'solid'}}});
 assert.equal(c.html,'<div style="position:absolute;left:100px;top:80px;width:65px;height:0;border-top:1px solid #2A4A6E;transform-origin:0 0;transform:rotate(0.39479111969976155rad);"></div>');
 for(const [w,h] of axes){const q=capture(w,h),g=safeLineGeom(100,80,w,h),a=normalizeLineGeom(100,80,w,h);assert(!Object.hasOwn(q.call.options,'flipH'));assert(!Object.hasOwn(q.call.options,'flipV'));assert.deepEqual([q.call.options.x,q.call.options.y,q.call.options.w,q.call.options.h],[ix(g.x),iy(g.y),ix(g.w),iy(g.h)]);
 const vertical=a.orientation==='vertical',expected=`<div style="position:absolute;left:${a.x}px;top:${a.y}px;${vertical?`height:${a.h}px;width:0;border-left`:`width:${a.w}px;height:0;border-top`}:1px solid #2A4A6E;"></div>`;assert.equal(q.html,expected);}
});
test('existing HTML minimum-size normalization is retained for all diagonal signs',()=>{
 for(const [w,h] of [[.0002,.0003],[-.0002,.0003],[.0002,-.0003],[-.0002,-.0003]]){const g=normalizeLineGeom(100,80,w,h);assert.equal(g.w,.25);assert.equal(g.h,.25);close(htmlEnds(capture(w,h).html),corners(g.x,g.y,g.w,g.h,w<0,h<0));}
});
test('tagged finite signed diagonals carry exact versioned internal-sign evidence',()=>{
 for(const [w,h] of cases){const q=capture(w,h,true),e=q.rows[0].emitterGeometry;assert.deepEqual(q.rows[0].sourceRefs,refs());assert.equal(e.transform.flipH,w<0);assert.equal(e.transform.flipV,h<0);assert.equal(e.status,'PROJECTED');assert.equal(e.reason,null);assert.equal(e.schemaVersion,w<0||h<0?'slide-image-dual-render.emitter-geometry.v2':'slide-image-dual-render.emitter-geometry.v1');if(w<0||h<0)assert.deepEqual(e.sourceLine,{units:'source-px',numberEncoding:'ecmascript-binary64-shortest-v1',qualifier:'internal-sign-diagonal-v1',x:'100',y:'80',w:String(w),h:String(h)});else assert(!Object.hasOwn(e,'sourceLine'));assert.equal(e.sourceNormalization,'safe-line-geom-v1');assert.equal(e.transform.rotation,0);assert.deepEqual([e.transform.x,e.transform.y,e.transform.cx,e.transform.cy],['x','y','w','h'].map(k=>Math.round(q.call.options[k]*914400)));assert(!JSON.stringify(q.call).includes('sourceRefs'));assert(!JSON.stringify(q.call).includes('emitterGeometry'));}
 for(const [w,h] of axes){const e=capture(w,h,true).rows[0].emitterGeometry;assert.equal(e.status,'PROJECTED');assert.equal(e.transform.flipH,false);assert.equal(e.transform.flipV,false);}
});
test('caller transforms remain ignored and untagged calls do not read them',()=>{
 const options={};for(const key of ['flipH','flipV','rotate'])Object.defineProperty(options,key,{get(){throw Error('Ignored option read');}});
 assert.deepEqual(capture(-60,25,false,options).call,capture(-60,25).call);
 const tagged=capture(60,25,true,{flipH:true,flipV:true,rotate:90});assert(!Object.hasOwn(tagged.call.options,'flipH'));assert(!Object.hasOwn(tagged.call.options,'flipV'));assert(!Object.hasOwn(tagged.call.options,'rotate'));assert.equal(tagged.rows[0].emitterGeometry.reason,'UNSUPPORTED_LINE_TRANSFORM');
});

function inputCapture(box,options={}) {
 OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];
 const s=makePptxSurface({version:'4.0.1',ShapeType:{line:'line'}},{addShape:(type,o)=>calls.push({type,options:o})},{slideNo:1}).withSourceRefs(refs());
 s.ln(...box,options);return {call:calls[0],row:OM.toJSON().slides['1'].objects[0]};
}
test('signed inputs retain binary64 round-trip values including negative zero',()=>{
 const values=[-0,0,1e-7,1e-6,80.12345678901235,80.00049,80.00041];
 for(const y of values){const box=[100,y,-50.125,30.375],{row}=inputCapture(box),e=row.emitterGeometry;assert.equal(e.schemaVersion,'slide-image-dual-render.emitter-geometry.v2');
  const saved=JSON.parse(JSON.stringify(e));for(const [i,k] of ['x','y','w','h'].entries()){assert.equal(saved.sourceLine[k],Object.is(box[i],-0)?'-0':String(box[i]));assert(Object.is(Number(saved.sourceLine[k]),box[i]));}
 }
 const a=inputCapture([100,80.00041,-50,30]).row,b=inputCapture([100,80.00049,-50,30]).row;
 assert.equal(a.y,b.y);assert.notEqual(a.emitterGeometry.sourceLine.y,b.emitterGeometry.sourceLine.y);
});
test('signed evidence is immutable, detached and absent from drawing args',()=>{
 const f=inputCapture([100,80,-50,30]);const old=clone(f.row.emitterGeometry);assert(Object.isFrozen(f.row.emitterGeometry));assert(Object.isFrozen(f.row.emitterGeometry.sourceLine));
 assert.throws(()=>{f.row.emitterGeometry.sourceLine.w='50';},TypeError);f.call.options.x=999;f.call.options.flipH=false;
 assert.deepEqual(OM.toJSON().slides['1'].objects[0].emitterGeometry,old);assert(!JSON.stringify(f.call).includes('sourceLine'));
});
test('coercions and caller transforms retain old unsupported records',()=>{
 const boxes=[['100',80,-50,30],[100,'80',-50,30],[100,80,'-50',30],[100,80,-50,'30'],[100,true,-50,30],[100,false,-50,30],[100,80,-50,true],[NaN,80,-50,30],[100,Infinity,-50,30],[100,80,-Infinity,30]];
 for(const box of boxes){const e=inputCapture(box).row.emitterGeometry;assert.equal(e.schemaVersion,'slide-image-dual-render.emitter-geometry.v1');assert.equal(e.status,'UNSUPPORTED');assert(!Object.hasOwn(e,'sourceLine'));}
 for(const name of ['flipH','flipV','rotate'])for(const value of [undefined,null,false,0,true,90]){const e=inputCapture([100,80,-50,30],{[name]:value}).row.emitterGeometry;assert.equal(e.status,'UNSUPPORTED');assert.equal(e.schemaVersion,'slide-image-dual-render.emitter-geometry.v1');assert(!Object.hasOwn(e,'sourceLine'));}
});
test('signed source evidence follows actual existing rounding at the boundary',()=>{
 const edge=0.1595*1920/13.333;
 for(const x of [100+edge-0.00001,100+edge+0.00001]){const f=inputCapture([x,80,-100,30]),e=f.row.emitterGeometry;assert.equal(e.sourceLine.x,String(x));assert.equal(e.transform.x,Math.round(f.call.options.x*914400));assert.deepEqual(e.transform,{x:Math.round(f.call.options.x*914400),y:Math.round(f.call.options.y*914400),cx:Math.round(f.call.options.w*914400),cy:Math.round(f.call.options.h*914400),flipH:true,flipV:false,rotation:0});}
 const a=inputCapture([100+edge-0.00001,80,-100,30]).row,b=inputCapture([100+edge+0.00001,80,-100,30]).row;assert.equal(a.x,b.x);assert.notEqual(a.emitterGeometry.transform.x,b.emitterGeometry.transform.x);
});

test('actual pinned OOXML preserves four diagonal flips and unchanged zero-axis transforms',{skip:process.env.SIGNED_LINE_EMIT_UNIT!=='1'},async()=>{
 const pptx=new PptxGenJS();assert.equal(pptx.version,'4.0.1');pptx.defineLayout({name:'SOURCE',width:13.333,height:7.5});pptx.layout='SOURCE';const slide=pptx.addSlide(),surface=makePptxSurface(pptx,slide,{slideNo:1,textFit:{}});
 const rows=[...cases,...axes.slice(0,4)];for(const [w,h] of rows)surface.ln(100,80,w,h);
 const buffer=await pptx.write({outputType:'nodebuffer'}),zip=await JSZip.loadAsync(buffer),xml=await zip.file('ppt/slides/slide1.xml').async('string');
 const shapes=[...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(m=>m[0]);assert.equal(shapes.length,rows.length);
 const transforms=shapes.map((s,i)=>{const m=s.match(/<a:xfrm([^>]*)><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm>/);assert(m);assert(s.includes('prst="line"'));const [w,h]=rows[i],diagonal=w!==0&&h!==0,g=safeLineGeom(100,80,w,h),actual={x:+m[2],y:+m[3],cx:+m[4],cy:+m[5],flipH:m[1].includes('flipH="1"'),flipV:m[1].includes('flipV="1"')};assert.deepEqual(actual,{x:Math.round(ix(g.x)*914400),y:Math.round(iy(g.y)*914400),cx:Math.round(ix(g.w)*914400),cy:Math.round(iy(g.h)*914400),flipH:diagonal&&w<0,flipV:diagonal&&h<0});return actual;});
 if(process.env.SIGNED_LINE_TEST_OUTPUT){fs.mkdirSync(process.env.SIGNED_LINE_TEST_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.SIGNED_LINE_TEST_OUTPUT,'serialized-transforms.json'),JSON.stringify({emitterVersion:pptx.version,syntheticOnly:true,packageBytes:buffer.length,transforms},null,2)+'\n');fs.writeFileSync(path.join(process.env.SIGNED_LINE_TEST_OUTPUT,'slide.xml'),xml);}
});
