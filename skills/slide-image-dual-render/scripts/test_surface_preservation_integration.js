'use strict';
// Invented standard-canvas mixed primitive calls; captured arguments only.
// No serializer, browser, measured typography, or semantic/visual acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'surface-preservation-'));
for(const key of Object.keys(process.env))if(key.startsWith('DECK_'))delete process.env[key];
Object.assign(process.env,{HOME:root,DECK_PROJECT_ROOT:root,DECK_ASSETS:root,DECK_PXW:'1920',DECK_PXH:'1080',DECK_FONT:'sans-serif',DECK_FONT_INSTALL_DECISION:'unavailable'});
const OM=require('./lib/object_manifest'),{makeHtmlSurface}=require('./lib/atoms_html'),{makePptxSurface}=require('./lib/atoms_pptx');
const red=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBguCOn0cCAAzDhk2RgYGBgwidJlAIAbikDTKNG4JYAAAAASUVORK5CYII=','base64');
const blue=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBgELG508CAAzDhk2RgYGBgwidJlAIAc+cDYLBrbG0AAAAASUVORK5CYII=','base64');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const refs=()=>({schemaVersion:'slide-image-dual-render.source-refs.v1',slide:1,bindings:{jobContentHash:'a'.repeat(64),sourcePngSha256:'b'.repeat(64),measurementInventorySha256:'c'.repeat(64),reviewArtifactSha256:'d'.repeat(64)},claim:{kind:'extra',groupId:'invented-unresolved-mixed',purpose:'unresolved'},authority:Object.fromEntries(['semantic_truth','text_removal','native_admission','vector_eligibility','quality_accepted'].map(k=>[k,false]))});
const text='한글  English & <value>\r\nNext  line';
const decode=uri=>Buffer.from(uri.split(',')[1],'base64');
function start(backend,opts={}){
 OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];
 const s=backend==='html'?makeHtmlSurface({slideNo:1,...opts}):makePptxSurface({version:'4.0.1',ShapeType:{line:'line'}},{addImage:o=>calls.push({kind:'image',options:o}),addShape:(kind,o)=>calls.push({kind,options:o}),addText:(runs,o)=>calls.push({kind:'text',runs,options:o})},{slideNo:1,textFit:{},...opts});
 return {s,calls,rows:()=>OM.toJSON().slides['1'].objects};
}
function draw(f,p,tag=true){const s=tag?f.s.withSourceRefs(refs()):f.s;s.img(p,20,50,160,80);s.ln(300,200,-120,75);s.txt(text,40,300,600,100,{sz:14});return s;}
test.after(()=>{OM.setEnabled(false);fs.rmSync(root,{recursive:true,force:true});});

test('omitted and false remain identical across mixed tagged text, image and signed line calls',()=>{
 const p=path.join(root,'default.png');fs.writeFileSync(p,red);
 for(const backend of ['html','pptx']){
  const variants=[];
  for(const opts of [{},{snapshotImages:false}]){const f=start(backend,opts);draw(f,p);variants.push({rows:f.rows(),calls:f.calls,html:backend==='html'?f.s._html():null});}
  assert.deepEqual(variants[0],variants[1]);
  if(backend==='pptx'){assert.equal(variants[0].calls[0].options.path,p);assert(!('data' in variants[0].calls[0].options));}
 }
});

test('snapshot calls coexist with exact signed provenance, unchanged text input and unresolved source references',()=>{
 const p=path.join(root,'invented & <한글>.png');
 for(const backend of ['html','pptx']){
  fs.writeFileSync(p,red);const f=start(backend,{snapshotImages:true});const tagged=draw(f,p);
  fs.writeFileSync(p,blue);tagged.img(p,200,50,160,80);fs.unlinkSync(p);
  const rows=f.rows();assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>r.source),['surface.img','surface.ln','surface.txt','surface.img']);
  assert.deepEqual([rows[0].imageFileSha256,rows[3].imageFileSha256],[sha(red),sha(blue)]);assert.equal(rows[2].textInputSha256,sha(text));
  for(const row of rows){assert.deepEqual(row.sourceRefs,refs());assert(Object.values(row.sourceRefs.authority).every(v=>v===false));}
  if(backend==='pptx'){
   const images=f.calls.filter(c=>c.kind==='image');assert.deepEqual(images.map(c=>decode(c.options.data)),[red,blue]);
   for(const c of images){assert(!('path' in c.options));assert.equal(c.options.altText,p);assert(!('objectName' in c.options));}
   const line=rows[1].emitterGeometry;assert.equal(line.schemaVersion,'slide-image-dual-render.emitter-geometry.v2');assert.equal(line.status,'PROJECTED');assert.equal(line.sourceLine.w,'-120');assert.equal(line.sourceLine.h,'75');assert.equal(line.transform.flipH,true);assert.equal(line.transform.flipV,false);
   assert.equal(f.calls.find(c=>c.kind==='line').options.flipH,true);assert.equal(rows[2].textContentSha256,sha(text.replace(/\r\n/g,'\n')));
  }else{const uris=[...f.s._html().matchAll(/src="([^"]+)"/g)].map(m=>decode(m[1]));assert.deepEqual(uris,[red,blue]);assert(f.s._html().includes('white-space:pre-wrap'));assert(f.s._html().includes('&amp; &lt;value&gt;'));}
 }
});

test('retained tagged snapshot surface never changes an ordinary surface or forwards provenance as drawing options',()=>{
 const p=path.join(root,'isolated.png');fs.writeFileSync(p,red);const f=start('pptx',{snapshotImages:true});const tagged=f.s.withSourceRefs(refs());
 tagged.ln(300,200,-120,75);f.s.ln(300,200,-120,75);tagged.img(p,20,50,160,80);f.s.img(p,200,50,160,80);
 const rows=f.rows();assert(rows[0].sourceRefs);assert(!rows[1].sourceRefs);assert(rows[2].sourceRefs);assert(!rows[3].sourceRefs);
 for(const c of f.calls)for(const key of ['sourceRefs','sourceLine','emitterGeometry','authority','snapshotImages'])assert(!Object.hasOwn(c.options,key));
 const ordinary=[];makePptxSurface({version:'4.0.1'},{addImage:o=>ordinary.push(o)}).img(p,20,50,160,80);assert.equal(ordinary[0].path,p);assert(!('data' in ordinary[0]));
});
