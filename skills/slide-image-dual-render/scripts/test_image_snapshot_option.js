#!/usr/bin/env node
'use strict';
// Invented raster fixtures. One optional image-only serializer test; no browser.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'image-snapshot-'));
const pureTest=(name,fn)=>test(name,{skip:process.env.IMAGE_SNAPSHOT_ONLY_SERIALIZATION==='1'},fn);
for(const key of Object.keys(process.env))if(key.startsWith('DECK_'))delete process.env[key];
process.env.HOME=path.join(root,'home');fs.mkdirSync(process.env.HOME);process.env.DECK_PROJECT_ROOT=root;process.env.DECK_ASSETS=root;process.env.DECK_PXW='1920';process.env.DECK_PXH='1080';process.env.DECK_FONT='sans-serif';process.env.DECK_FONT_INSTALL_DECISION='unavailable';
const lib=process.env.IMAGE_SNAPSHOT_LIB_ROOT||path.join(__dirname,'lib');
const OM=require(path.join(lib,'object_manifest')),{makeHtmlSurface}=require(path.join(lib,'atoms_html')),{makePptxSurface}=require(path.join(lib,'atoms_pptx'));
const fixtures={"red": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBguCOn0cCAAzDhk2RgYGBgwidJlAIAbikDTKNG4JYAAAAASUVORK5CYII=", "blue": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBgELG508CAAzDhk2RgYGBgwidJlAIAc+cDYLBrbG0AAAAASUVORK5CYII=", "jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor0jgP/9k="},red=Buffer.from(fixtures.red,'base64'),blue=Buffer.from(fixtures.blue,'base64'),jpeg=Buffer.from(fixtures.jpeg,'base64');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const decode=s=>Buffer.from(s.split(',')[1],'base64');
function setup(name,kind='html'){const p=path.join(root,name);fs.writeFileSync(p,red);OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];return {p,calls,s:kind==='html'?makeHtmlSurface({slideNo:1,snapshotImages:true}):makePptxSurface({version:'4.0.1'},{addImage:o=>calls.push(o)},{slideNo:1,snapshotImages:true}),rows:()=>OM.toJSON().slides['1'].objects};}
function stableManifest(){const iso=Date.prototype.toISOString;Date.prototype.toISOString=()=> '2000-01-01T00:00:00.000Z';try{return OM.toJSON();}finally{Date.prototype.toISOString=iso;}}
function embedded(s){return [...s._html().matchAll(/src="([^"]+)"/g)].map(m=>decode(m[1]));}
function intercept(p,fn,run){const original=fs.readFileSync;let reads=0;fs.readFileSync=function(file,...args){if(String(file)===p){reads++;return fn(original.bind(fs),file,args,reads);}return original.call(fs,file,...args);};try{run();return reads;}finally{fs.readFileSync=original;}}
test.after(()=>{OM.setEnabled(false);fs.rmSync(root,{recursive:true,force:true});});

pureTest('HTML uses one captured read for manifest and embedded bytes',()=>{
 const f=setup('single-html.png');const reads=intercept(f.p,(read,p,args,n)=>n===1?red:blue,()=>f.s.img(f.p,10,20,160,80));
 assert.equal(reads,1);assert.deepEqual(embedded(f.s),[red]);assert.equal(f.rows()[0].imageFileSha256,sha(red));
});
pureTest('PPTX passes data only from the single recorded read',()=>{
 const f=setup('single-pptx.png','pptx');const reads=intercept(f.p,()=>red,()=>f.s.img(f.p,10,20,160,80));
 assert.equal(reads,1);assert(!Object.hasOwn(f.calls[0],'path'));assert.equal(f.calls[0].altText,f.p);assert(!Object.hasOwn(f.calls[0],'objectName'));assert.deepEqual(decode(f.calls[0].data),red);assert.equal(f.rows()[0].imageSourcePath,f.p);assert.equal(f.rows()[0].imageFileSha256,sha(red));
});
pureTest('successive snapshots retain different bytes at one filename',()=>{
 const f=setup('replace.png','pptx');f.s.img(f.p,10,20,160,80);fs.writeFileSync(f.p,blue);f.s.img(f.p,200,20,160,80);fs.unlinkSync(f.p);
 assert.deepEqual(f.calls.map(c=>decode(c.data)),[red,blue]);assert.deepEqual(f.rows().map(r=>r.imageFileSha256),[sha(red),sha(blue)]);
});
pureTest('snapshot handles cannot be mutated, forged or rebound to another path',()=>{
 const f=setup('handle.png');const handle=OM.captureImageSnapshot(f.p);assert(Object.isFrozen(handle));assert.deepEqual(Object.keys(handle),[]);
 assert.throws(()=>{handle.data='changed';},TypeError);fs.writeFileSync(f.p,blue);assert.deepEqual(decode(OM.imageSnapshotData(handle,'html')),red);
 assert.throws(()=>OM.imageSnapshotData({},'html'),/snapshot/);assert.throws(()=>OM.imageSnapshotData(handle,'unknown'),/backend/);
 assert.throws(()=>OM.recordImage(f.p+'.other',1,2,3,4,undefined,undefined,handle),/path/);
});
pureTest('failed supported reads record the attempted call and throw without rereading',()=>{
 for(const kind of ['html','pptx']){const f=setup('missing-'+kind+'.png',kind);fs.unlinkSync(f.p);let error;
  const reads=intercept(f.p,(read,p,args)=>read(p,...args),()=>{try{f.s.img(f.p,10,20,160,80);}catch(e){error=e;}});
  assert.equal(reads,1);assert.equal(error.code,'ENOENT');assert.equal(f.rows()[0].imageIdentityError,'ENOENT');assert.equal(f.rows()[0].imageFileSha256,null);if(kind==='pptx')assert.equal(f.calls.length,0);else assert.equal(f.s._html(),'');
 }
});
pureTest('text-only reads only for enabled provenance as before',()=>{
 const f=setup('text-only.png');const s=makeHtmlSurface({slideNo:1,textOnly:true,snapshotImages:true});let reads=intercept(f.p,()=>red,()=>s.img(f.p,0,0,80,40));assert.equal(reads,1);assert.equal(s._html(),'');
 OM.setEnabled(false);reads=intercept(f.p,()=>red,()=>s.img(f.p,0,0,80,40));assert.equal(reads,0);
});
pureTest('unsupported formats keep their existing path behavior without qualification',()=>{
 const f=setup('opaque.svg','pptx');assert.equal(OM.captureImageSnapshot(f.p),undefined);f.s.img(f.p,1,2,30,40);assert.equal(f.calls[0].path,f.p);assert(!Object.hasOwn(f.calls[0],'data'));
});
pureTest('PNG alpha and both JPEG suffixes keep exact bytes and MIME conventions',()=>{
 assert.equal(red[25],6);
 for(const [suffix,bytes,mime] of [['png',red,'png'],['jpg',jpeg,'jpg'],['JPEG',jpeg,'jpeg']]){
  const f=setup('type.'+suffix,'pptx');fs.writeFileSync(f.p,bytes);f.s.img(f.p,1,2,30,40);assert.equal(f.calls[0].data.split(';')[0],'data:image/'+mime);assert.deepEqual(decode(f.calls[0].data),bytes);
  const h=makeHtmlSurface({slideNo:1,snapshotImages:true});h.img(f.p,1,2,30,40);assert(h._html().includes('data:image/'+(suffix==='png'?'png':'jpeg')+';'));assert.deepEqual(embedded(h)[0],bytes);
 }
});


pureTest('snapshotImages rejects present non-booleans before image IO',()=>{
 for(const value of [null,undefined,0,1,'true','false',{},[],()=>true]){
  let reads=0;const original=fs.readFileSync;fs.readFileSync=function(...args){reads++;return original.apply(fs,args);};
  try{for(const factory of [()=>makeHtmlSurface({snapshotImages:value}),()=>makePptxSurface({}, {}, {snapshotImages:value})])assert.throws(factory,/snapshotImages.*boolean/);assert.equal(reads,0);}finally{fs.readFileSync=original;}
 }
});
pureTest('omitted and false preserve default path args, read counts and manifest bytes',()=>{
 const p=path.join(root,'default.png');fs.writeFileSync(p,red);let expected;
 for(const extra of [{},{snapshotImages:false}]){
  OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];const s=makePptxSurface({version:'4.0.1'},{addImage:o=>calls.push(o)},extra);
  const reads=intercept(p,()=>red,()=>s.img(p,10,20,160,80));assert.equal(reads,1);assert.deepEqual(calls,[{path:p,x:0.069,y:0.139,w:1.111,h:0.556}]);
  const result=JSON.stringify({calls,manifest:stableManifest()});if(expected)assert.equal(result,expected);expected=result;
  OM.reset();OM.setEnabled(false);assert.equal(intercept(p,()=>red,()=>s.img(p,10,20,160,80)),0);
 }
 let html;
 for(const extra of [{},{snapshotImages:false}]){
  OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const s=makeHtmlSurface(extra);assert.equal(intercept(p,()=>red,()=>s.img(p,10,20,160,80)),2);
  const result=JSON.stringify({html:s._html(),manifest:stableManifest()});if(html)assert.equal(result,html);html=result;assert.deepEqual(embedded(s),[red]);
 }
});
pureTest('factory option is captured and never promotes another surface',()=>{
 const p=path.join(root,'factory.png');fs.writeFileSync(p,red);OM.setEnabled(false);const a=[],b=[];const opts={snapshotImages:true};
 const one=makePptxSurface({}, {addImage:o=>a.push(o)},opts),two=makePptxSurface({}, {addImage:o=>b.push(o)});opts.snapshotImages=false;
 one.img(p,1,2,30,40);two.img(p,1,2,30,40);assert.equal(a[0].altText,p);assert(a[0].data);assert(!Object.hasOwn(a[0],'path'));assert.equal(b[0].path,p);assert(!Object.hasOwn(b[0],'data'));assert(!Object.hasOwn(b[0],'altText'));
});
pureTest('default path mode preserves PptxGenJS dedup and description state without serialization',()=>{
 const PptxGenJS=require('pptxgenjs');const p=path.join(root,'dedup.png');fs.writeFileSync(p,red);const pptx=new PptxGenJS();const slide=pptx.addSlide();OM.setEnabled(false);
 const s=makePptxSurface(pptx,slide);s.img(p,10,20,160,80);s.img(p,200,20,160,80);
 const media=slide._relsMedia.filter(r=>r.type==='image/png');assert.equal(media.length,2);assert.equal(media[0].Target,media[1].Target);assert.equal(media[0].path,p);assert.equal(media[1].isDuplicate,true);
 for(const item of slide._slideObjects){assert.equal(item.image,p);assert.equal(item.options.altText,'');}
});

test('real package keeps repeated media, replacement snapshots and removed files',{skip:process.env.IMAGE_SNAPSHOT_EMIT_UNIT!=='1'},async()=>{
 const PptxGenJS=require('pptxgenjs'),JSZip=require('jszip');const pptx=new PptxGenJS();assert.equal(pptx.version,'4.0.1');pptx.defineLayout({name:'UNIT',width:13.333,height:7.5});pptx.layout='UNIT';const slide=pptx.addSlide();
 OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const s=makePptxSurface(pptx,slide,{slideNo:1,snapshotImages:true});const expected=[];
 const png=path.join(root,'repeat.png'),jpg=path.join(root,"sample & <photo> \"한글\".jpg"),mutable=path.join(root,"sample & <blue> \"한글\".png"),removed=path.join(root,'removed.png');fs.writeFileSync(png,red);fs.writeFileSync(jpg,jpeg);fs.writeFileSync(mutable,red);fs.writeFileSync(removed,red);
 const draw=(p,b)=>{const i=expected.length;s.img(p,20+i*180,50,160,80);expected.push({sha256:sha(b),x:20+i*180,y:50,w:160,h:80,path:p});};
 for(let i=0;i<4;i++)draw(png,red);for(let i=0;i<2;i++)draw(jpg,jpeg);draw(mutable,red);fs.writeFileSync(mutable,blue);draw(mutable,blue);draw(removed,red);fs.unlinkSync(removed);fs.unlinkSync(mutable);
 const manifest=OM.toJSON();OM.setEnabled(false);const start=process.hrtime.bigint();const bytes=await pptx.write({outputType:'nodebuffer'});const elapsed=Number(process.hrtime.bigint()-start)/1e6;const zip=await JSZip.loadAsync(bytes);
 const xml=await zip.file('ppt/slides/slide1.xml').async('string'),rels=await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string');const relation=Object.fromEntries([...rels.matchAll(/<Relationship\b([^>]+)\/>/g)].map(m=>{const a=Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));return[a.Id,a.Target];}));const pictures=[...xml.matchAll(/<p:pic>.*?<\/p:pic>/g)].map(m=>m[0]);assert.equal(pictures.length,expected.length);
 const decodeXml=s=>s.replace(/&quot;/g,'\"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 const observed=[];for(let i=0;i<pictures.length;i++){const pic=pictures[i],id=/r:embed="([^"]+)"/.exec(pic)[1],member=path.posix.normalize('ppt/slides/'+relation[id]);const data=await zip.file(member).async('nodebuffer');const off=/<a:off x="(-?\d+)" y="(-?\d+)"/.exec(pic),ext=/<a:ext cx="(\d+)" cy="(\d+)"/.exec(pic);const emu=(v,extent,pixels)=>Math.round(+(v*extent/pixels).toFixed(3)*914400);const geometry=[+off[1],+off[2],+ext[1],+ext[2]];const description=decodeXml(/\bdescr="([^"]*)"/.exec(pic)[1]),objectName=decodeXml(/\bname="([^"]*)"/.exec(pic)[1]);assert.equal(description,expected[i].path);assert.equal(objectName,'Image '+i);
  assert.equal(sha(data),expected[i].sha256);assert.equal(manifest.slides['1'].objects[i].imageFileSha256,sha(data));assert.equal(manifest.slides['1'].objects[i].imageSourcePath,expected[i].path);assert.deepEqual(geometry,[emu(expected[i].x,13.333,1920),emu(50,7.5,1080),emu(160,13.333,1920),emu(80,7.5,1080)]);observed.push({sha256:sha(data),member,geometry_emu:geometry,description,objectName});}
 const media=Object.keys(zip.files).filter(n=>/^ppt\/media\/[^/]+$/.test(n));let mediaBytes=0;for(const n of media)mediaBytes+=(await zip.file(n).async('nodebuffer')).length;
 const result={scope:'Invented image-only unit serialization through original installed PptxGenJS, no browser or full workflow',emissions:1,pptxgenjs:require.resolve('pptxgenjs'),version:pptx.version,package_sha256:sha(bytes),package_bytes:bytes.length,serialization_ms:elapsed,media_entries:media.length,media_bytes:mediaBytes,objects:observed,repeat_png_calls:4,repeat_jpeg_calls:2,source_rows:manifest.slides['1'].objects};
 if(process.env.IMAGE_SNAPSHOT_ARTIFACTS){const out=path.resolve(process.env.IMAGE_SNAPSHOT_ARTIFACTS);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'unit-images.pptx'),bytes);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');}
});
