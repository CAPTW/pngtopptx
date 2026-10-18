'use strict';
// Invented component fixtures only. Real pinned serializer, supplied textFit
// seam; no browser, font installation, image recognition or visual acceptance.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const dir = process.env.GEOMETRY_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'emitter-geometry-'));
fs.mkdirSync(dir, {recursive:true});
Object.assign(process.env, {DECK_PROJECT_ROOT:dir, DECK_ASSETS:dir, HOME:dir,
  DECK_PXW:'1672', DECK_PXH:'941', DECK_FONT:'sans-serif', DECK_FONT_INSTALL_DECISION:'unavailable'});
const lib = process.env.GEOMETRY_TEST_LIB || path.join(__dirname, 'lib');
const OM = require(path.join(lib, 'object_manifest'));
const {makePptxSurface} = require(path.join(lib, 'atoms_pptx'));
const image = path.join(dir, 'pixel.png');
fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII=', 'base64'));
const metadata = () => ({schemaVersion:'slide-image-dual-render.source-refs.v1', slide:1,
  bindings:{jobContentHash:'a'.repeat(64),sourcePngSha256:'b'.repeat(64),measurementInventorySha256:'c'.repeat(64),reviewArtifactSha256:'d'.repeat(64)},
  claim:{kind:'extra',groupId:'invented',purpose:'unresolved'},
  authority:Object.fromEntries(['semantic_truth','text_removal','native_admission','vector_eligibility','quality_accepted'].map(k=>[k,false]))});
function setup(version='4.0.1', real=false) {
  OM.reset(); OM.setCurrentSlide(1); OM.setEnabled(true);
  const calls=[];
  const pptx=real ? new PptxGenJS() : {version, ShapeType:{roundRect:'roundRect',ellipse:'ellipse',chevron:'chevron',line:'line'}};
  if(real) {assert.equal(pptx.version,'4.0.1');pptx.defineLayout({name:'SOURCE',width:13.333,height:7.5});pptx.layout='SOURCE';}
  const slide=real ? pptx.addSlide() : Object.fromEntries(['addShape','addText','addImage'].map(name=>[name,(...args)=>calls.push({name,args})]));
  const surface=makePptxSurface(pptx,slide,{slideNo:1,textFit:{'1:1':{fontSizePt:12,shrinkApplied:false}}});
  return {surface,pptx,slide,calls,rows:()=>OM.toJSON().slides['1'].objects};
}
const plain = value => JSON.parse(JSON.stringify(value));
function checkEvidence(e, args, normalization='none') {
  assert.equal(e.schemaVersion,'slide-image-dual-render.emitter-geometry.v1');
  assert.equal(e.emitterVersion,'4.0.1');assert.equal(e.units,'EMU');
  assert.equal(e.status,'PROJECTED');assert.equal(e.reason,null);
  assert.equal(e.sourceNormalization,normalization);
  assert.deepEqual(e.transform,{x:Math.round(args.x*914400),y:Math.round(args.y*914400),
    cx:Math.round(args.w*914400),cy:Math.round(args.h*914400),flipH:false,flipV:false,rotation:0});
  assert.deepEqual(Object.keys(e).sort(),['schemaVersion','emitterVersion','units','status','reason','sourceNormalization','transform'].sort());
}
test('fractional source bbox collision retains different exact emitter geometry',()=>{
  const run=setup(),s=run.surface.withSourceRefs(metadata());
  const edge=0.1595*1672/13.333;
  s.ell(edge-0.00001,10.125,30.25,20.375);s.ell(edge+0.00001,10.125,30.25,20.375);
  const rows=run.rows();assert.equal(rows[0].x,rows[1].x);
  assert.deepEqual(rows.map(r=>r.emitterGeometry.transform.x),[145390,146304]);
  rows.forEach((r,i)=>checkEvidence(r.emitterGeometry,run.calls[i].args[1]));
});
test('all six tagged primitives record only actual numeric emitter geometry',()=>{
  const run=setup(),s=run.surface.withSourceRefs(metadata());
  s.txt('Synthetic text',20.125,20.375,200.25,40.625,{sz:12});
  s.rrect(300.125,100.375,80.25,60.625);s.ell(400.125,100.375,80.25,60.625);
  s.chev(500.125,100.375,80.25,60.625);s.img(image,600.125,100.375,80.25,60.625);
  s.ln(700.125,100.375,80.25,0);
  run.rows().forEach((r,i)=>checkEvidence(r.emitterGeometry,run.calls[i].args.at(-1),i===5?'safe-line-geom-v1':'none'));
  assert(!JSON.stringify(run.calls).includes('emitterGeometry'));
  assert(!JSON.stringify(run.calls).includes('sourceRefs'));
});
test('geometry is immutable and caller options cannot rewrite earlier evidence',()=>{
  const run=setup(),o={fill:'112233'};run.surface.withSourceRefs(metadata()).ell(10.125,20.25,30.375,40.5,o);
  const row=run.rows()[0],old=plain(row.emitterGeometry);
  assert(Object.isFrozen(row.emitterGeometry));assert(Object.isFrozen(row.emitterGeometry.transform));
  assert.throws(()=>{row.emitterGeometry.transform.x=0;},TypeError);
  run.calls[0].args[1].x=99;o.x=99;o.emitterGeometry={transform:{x:99}};
  assert.deepEqual(run.rows()[0].emitterGeometry,old);
});
test('zero-axis and reversed axis-aligned lines describe existing safeLineGeom behavior',()=>{
  const run=setup(),s=run.surface.withSourceRefs(metadata());
  for(const box of [[100.25,80.125,50.375,0],[100.25,80.125,-50.375,0],[100.25,80.125,0,50.375],[100.25,80.125,0,-50.375],[100.25,80.125,50.375,30.25]])s.ln(...box);
  run.rows().forEach((row,i)=>checkEvidence(row.emitterGeometry,run.calls[i].args[1],'safe-line-geom-v1'));
  assert(run.rows()[0].emitterGeometry.transform.cy>0,'Existing zero-axis inflation must be explicit');
  assert(run.rows()[2].emitterGeometry.transform.cx>0);
});
test('signed diagonal and requested missing flip semantics remain unsupported',()=>{
  const run=setup(),s=run.surface.withSourceRefs(metadata());
  s.ln(100.25,80.125,-50.375,30.25);s.ln(100.25,80.125,-50.375,-30.25);
  s.ln(100.25,80.125,50.375,30.25,{flipH:true});
  for(const row of run.rows()) {
    assert.equal(row.emitterGeometry.status,'UNSUPPORTED');
    assert.match(row.emitterGeometry.reason,/LINE_(DIRECTION|TRANSFORM)/);
    assert.equal(row.emitterGeometry.transform.flipH,false);
    assert.equal(row.emitterGeometry.transform.flipV,false);
  }
});
test('unknown serializer and ambiguous/degenerate numeric geometry are unqualified',()=>{
  const run=setup('9.9.9');run.surface.withSourceRefs(metadata()).ell(1,2,3,4);
  assert.equal(run.rows()[0].emitterGeometry.reason,'UNVERIFIED_PPTXGENJS_VERSION');
  assert.equal(run.rows()[0].emitterGeometry.transform,null);
  for(const box of [[NaN,1,2,3],[1,2,0,3],[1,2,-3,4],[1e9,2,3,4],[1,2,0.000000001,4]]) {
    const q=setup();q.surface.withSourceRefs(metadata()).ell(...box);
    assert.equal(q.rows()[0].emitterGeometry.status,'UNSUPPORTED');
    assert.equal(q.rows()[0].emitterGeometry.transform,null);
  }
});
test('untagged records omit the field and exact drawing calls equal tagged calls',()=>{
  function draw(s){s.txt('Q',1.125,2.25,30.375,4.5);s.ell(1.125,2.25,30.375,4.5);s.ln(4,5,-2,0);s.img(image,1.125,2.25,30.375,4.5);}
  let run=setup();draw(run.surface);const calls=plain(run.calls),rows=plain(run.rows());
  assert(rows.every(r=>!Object.hasOwn(r,'emitterGeometry')));
  run=setup();draw(run.surface.withSourceRefs(metadata()));assert.deepEqual(plain(run.calls),calls);
  assert.deepEqual(run.rows().map(({sourceRefs,emitterGeometry,...rest})=>rest),rows);
});
test('untagged lines do not read previously ignored transform options',()=>{
  const run=setup(),options={};
  for(const key of ['flipH','flipV','rotate'])Object.defineProperty(options,key,{get(){throw Error('Ignored option was read');}});
  run.surface.ln(10,20,30,0,options);
  assert.equal(run.rows().length,1);assert(!Object.hasOwn(run.rows()[0],'emitterGeometry'));
});

const extract = buffer => {
  const py=`import io,json,sys,zipfile,xml.etree.ElementTree as E
n={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:r=E.fromstring(z.read('ppt/slides/slide1.xml'))
t=r.find('p:cSld/p:spTree',n);out=[]
for s in t:
 if s.tag not in ['{'+n['p']+'}sp','{'+n['p']+'}pic']:continue
 x=s.find('p:spPr/a:xfrm',n);o=x.find('a:off',n);e=x.find('a:ext',n)
 out.append({'x':int(o.get('x')),'y':int(o.get('y')),'cx':int(e.get('cx')),'cy':int(e.get('cy')),'flipH':x.get('flipH')=='1','flipV':x.get('flipV')=='1','rotation':int(x.get('rot','0'))})
print(json.dumps(out))`;
  const child=spawnSync('python',['-c',py],{input:buffer,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr.toString());return JSON.parse(child.stdout);
};
function verifyGeometry(buffer,rows) {
  const actual=extract(buffer);assert.equal(actual.length,rows.length,'count mismatch');
  rows.forEach((row,i)=>{assert.equal(row.emitterGeometry.status,'PROJECTED','unsupported geometry');assert.deepEqual(actual[i],row.emitterGeometry.transform,`geometry mismatch at ${i}`);});
}
test('one actual pinned package proves fractional and supported line transforms; tampering fails',async()=>{
  const run=setup('4.0.1',true),s=run.surface.withSourceRefs(metadata());const edge=0.1595*1672/13.333;
  s.txt('One invented paragraph',edge-0.00001,20.125,200.25,40.375,{sz:12});
  s.ell(edge+0.00001,80.125,80.25,60.375);s.rrect(300.125,100.25,80.375,60.5);s.chev(400.125,100.25,80.375,60.5);
  s.img(image,500.125,100.25,80.375,60.5);
  for(const box of [[100.25,180.125,50.375,0],[100.25,180.125,-50.375,0],[100.25,180.125,0,50.375],[100.25,180.125,0,-50.375],[100.25,180.125,50.375,30.25]])s.ln(...box);
  const rows=run.rows();assert(rows.every(row=>row.emitterGeometry?.status==='PROJECTED'));
  const buffer=await run.pptx.write({outputType:'nodebuffer'});verifyGeometry(buffer,rows);
  fs.writeFileSync(path.join(dir,'geometry.pptx'),buffer);fs.writeFileSync(path.join(dir,'geometry.manifest.json'),JSON.stringify(rows,null,2)+'\n');
  const zip=await JSZip.loadAsync(buffer),name='ppt/slides/slide1.xml',xml=await zip.file(name).async('string');
  for(const [label,changed] of [['offset',xml.replace(/<a:off x="145390"/, '<a:off x="145391"')],['flip',xml.replace('<a:xfrm><a:off x="145390"','<a:xfrm flipH="1"><a:off x="145390"')]]) {
    assert.notEqual(changed,xml);zip.file(name,changed);const altered=await zip.generateAsync({type:'nodebuffer'});
    assert.throws(()=>verifyGeometry(altered,rows),/geometry mismatch/);
    fs.writeFileSync(path.join(dir,`tampered-${label}.pptx`),altered);
  }
  const changed=plain(rows);changed[0].emitterGeometry.transform.x++;
  assert.throws(()=>verifyGeometry(buffer,changed),/geometry mismatch/);
});
