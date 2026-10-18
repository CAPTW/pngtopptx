'use strict';
// Real PptxGenJS package serialization through reviewed official surfaces.
// This fixture makes no browser, font installation, or workflow/quality claim.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const PptxGenJS = require('pptxgenjs');
const sharp = require('sharp');
if (!process.argv[2]) throw new Error('Usage: node test_source_ref_emission.js <new-output-directory>');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, {recursive:false});
process.env.DECK_PROJECT_ROOT=out;process.env.DECK_ASSETS=out;process.env.HOME=out;
process.env.DECK_PXW='1672';process.env.DECK_PXH='941';
process.env.DECK_FONT='sans-serif';process.env.DECK_FONT_INSTALL_DECISION='unavailable';
const lib=path.join(__dirname,'lib');
const OM=require(path.join(lib,'object_manifest'));
const {makePptxSurface}=require(path.join(lib,'atoms_pptx'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sorted=value=>Array.isArray(value)?value.map(sorted):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
const contentSha=value=>sha(Buffer.from(JSON.stringify(sorted(value))));
const save=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
const authority=Object.fromEntries(['semantic_truth','text_removal','native_admission','vector_eligibility','quality_accepted'].map(k=>[k,false]));
const refs=[{collection:'text_blocks',observation_id:'T1'},
 {collection:'region_candidate_evidence.candidates',observation_id:'U01'},
 {collection:'region_candidate_evidence.candidates',observation_id:'U02'}];
const canonicalText='Nacre & cobalt';
(async()=>{
 const original=await sharp({create:{width:12,height:8,channels:3,background:'#c63148'}}).png().toBuffer();
 const replacement=await sharp({create:{width:12,height:8,channels:3,background:'#284eac'}}).png().toBuffer();
 const source=await sharp({create:{width:1672,height:941,channels:3,background:'#eeeeee'}}).png().toBuffer();
 fs.writeFileSync(path.join(out,'source.png'),source);
 fs.writeFileSync(path.join(out,'asset-original.png'),original);
 fs.writeFileSync(path.join(out,'asset-replacement.png'),replacement);
 const image=path.join(out,'asset-working.png');
 const inventory={fixtureOnly:true,canvas_px:{w:1672,h:941},observations:[
  {source:refs[0],text:canonicalText,bbox_px:{x:20,y:20,w:200,h:40}},
  {source:refs[1],kind:'shape',bbox_px:{x:300,y:100,w:80,h:60}},
  {source:refs[2],kind:'image',bbox_px:{x:500,y:100,w:120,h:80},image_sha256:sha(original)}]};
 save('inventory.json',inventory);
 const review={fixtureOnly:true,provenance:'invented unauthenticated declarations',
  source_png_sha256:sha(source),measurement_inventory_sha256:sha(fs.readFileSync(path.join(out,'inventory.json'))),
  decisions:refs.map((source,i)=>({source,role:i?'graphic':'text'})),authority};
 save('review.json',review);
 const job={fixtureOnly:true,slide_number:1,source_png_sha256:sha(source),
  inventory_sha256:sha(fs.readFileSync(path.join(out,'inventory.json'))),review_sha256:sha(fs.readFileSync(path.join(out,'review.json'))),
  explicitObjectSequence:refs,authority};
 job.content_hash=contentSha(job);save('job.json',job);
 const bindings={jobContentHash:job.content_hash,sourcePngSha256:job.source_png_sha256,
  measurementInventorySha256:job.inventory_sha256,reviewArtifactSha256:job.review_sha256};
 const modes=['positive','drop-text','same-length-text','drop-shape','changed-image-after-call','extra-object','reordered-objects'];
 const results=[];let control;
 for(const mode of modes){
  fs.writeFileSync(image,original);
  OM.reset();OM.setCurrentSlide(1);OM.setEnabled(true);
  const pptx=new PptxGenJS();assert.equal(pptx.version,'4.0.1');
  pptx.defineLayout({name:'SOURCE',width:13.333,height:7.5});pptx.layout='SOURCE';
  const slide=pptx.addSlide();
  const surface=makePptxSurface(pptx,slide,{slideNo:1,textFit:{'1:1':{fontSizePt:12,shrinkApplied:false}}});
  const tagged=refs.map((source,i)=>surface.withSourceRefs({schemaVersion:'slide-image-dual-render.source-refs.v1',slide:1,bindings,
   claim:{kind:'observation',groupId:`object-${i}`,source,glyphMembers:[],disposition:'linked'},authority}));
  tagged[0].txt(canonicalText,20,20,200,40,{sz:12});
  tagged[1].ell(300,100,80,60,{fill:'669988'});
  tagged[2].img(image,500,100,120,80);
  const manifest=OM.toJSON();OM.setEnabled(false);
  const rows=manifest.slides['1'].objects;assert.equal(rows.length,3);
  if(control)assert.deepEqual(rows,control);else control=rows;
  if(mode==='drop-text')slide._slideObjects.splice(0,1);
  if(mode==='same-length-text'){
   assert.equal(canonicalText.length,'Mural & cobalt'.length);slide._slideObjects[0].text[0].text='Mural & cobalt';
  }
  if(mode==='drop-shape')slide._slideObjects.splice(1,1);
  if(mode==='changed-image-after-call')fs.writeFileSync(image,replacement);
  if(mode==='extra-object')slide.addShape(pptx.ShapeType.rect,{x:1,y:1,w:1,h:1});
  if(mode==='reordered-objects')[slide._slideObjects[0],slide._slideObjects[1]]=[slide._slideObjects[1],slide._slideObjects[0]];
  const tick=process.hrtime.bigint();
  const buffer=await pptx.write({outputType:'nodebuffer'});assert(Buffer.isBuffer(buffer));
  fs.writeFileSync(path.join(out,`${mode}.pptx`),buffer);
  save(`${mode}.manifest.json`,manifest);
  results.push({case:mode,package_sha256:sha(buffer),package_bytes:buffer.length,
   manifest_sha256:sha(fs.readFileSync(path.join(out,`${mode}.manifest.json`))),surface_rows_unchanged:true,
   emitter:'PptxGenJS 4.0.1',serialization_seconds:Number(process.hrtime.bigint()-tick)/1e9});
 }
 save('emission-results.json',{scope:'invented component package emission only',browser:false,visual_quality:false,authority,results});
 console.log(JSON.stringify({emitted:modes.length,realPptxGenJS:'4.0.1',sameSurfaceRows:true}));
 const checked=require('node:child_process').spawnSync('python',[path.join(__dirname,'test_source_ref_emission.py'),out],{stdio:'inherit',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(checked.status!==0) throw new Error(`Package correspondence checks failed: ${checked.status}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
