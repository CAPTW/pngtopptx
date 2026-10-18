#!/usr/bin/env node
'use strict';
// Component emission tests: real official surfaces + installed PptxGenJS; no workflow/render-quality claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const PptxGenJS = require('pptxgenjs');
const sharp = require('sharp');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-provenance-'));
process.env.DECK_PROJECT_ROOT = temp;
process.env.DECK_FONT = 'sans-serif';
process.env.DECK_FONT_INSTALL_DECISION = 'unavailable';
const libRoot = process.env.PROVENANCE_LIB_ROOT || path.join(__dirname, 'lib');
const OM = require(path.join(libRoot, 'object_manifest'));
const { makePptxSurface, ix, iy } = require(path.join(libRoot, 'atoms_pptx'));
const hash = input => crypto.createHash('sha256').update(input).digest('hex');
const clone = obj => JSON.parse(JSON.stringify(obj));
let passes = 0;
const results = [];
const cases = [
  {name:'plain-unicode-entities-spaces', content:'  Alpha & <β> 😀\tZ  ', expected:'  Alpha & <β> 😀\tZ  '},
  {name:'same-length-text', content:'North', expected:'North'},
  {name:'plain-newlines', content:'a\nb\n', expected:'a\nb\n'},
  // Corrected emitted preparation: CRLF is one break, not two paragraphs.
  {name:'plain-crlf', content:'a\r\nb', expected:'a\nb'},
  {name:'rich-formatting', content:[{text:'a',bold:true},{text:'b',italic:true}], expected:'ab'},
  {name:'rich-breakLine', content:[{text:'a',breakLine:true},{text:'b'}], expected:'a\nb'},
  {name:'rich-final-breakLine', content:[{text:'a',breakLine:true}], expected:'a'},
  // Embedded LF does not add a break after the original run's final segment.
  {name:'rich-embedded-newline', content:[{text:'a\nb'},{text:'c'}], expected:'a\nbc'},
  {name:'rich-trailing-newline', content:[{text:'a\n'},{text:'b'}], expected:'a\nb'},
  {name:'blank-lines', content:'\n\n', expected:'\n\n'},
  {name:'empty', content:'', expected:''},
  {name:'rich-double-trailing-LF', content:[{text:'a\n\n'},{text:'b'}], expected:'a\n\nb'},
  {name:'plain-lone-CR', content:'a\rb', expected:'a\nb'},
  {name:'rich-lone-CR', content:[{text:'a\rb'},{text:'c'}], expected:'a\nbc'},
  {name:'literal-office-escape', content:'_x000B_', expected:'_x000B_'},
];
async function emit(name, draw, afterDraw) {
  OM.reset(); OM.setCurrentSlide(1); OM.setEnabled(true);
  const pptx = new PptxGenJS(); pptx.defineLayout({name:'SOURCE',width:13.333,height:7.5});pptx.layout='SOURCE';
  const slide = pptx.addSlide(); const surface = makePptxSurface(pptx,slide);
  draw(surface,slide,pptx);
  const manifest = OM.writeNativeManifest(path.join(temp,name+'.native-object-manifest.json')); OM.setEnabled(false);
  if(afterDraw) await afterDraw(slide,pptx);
  const pptxPath = path.join(temp, name+'.pptx');
  await pptx.writeFile({fileName:pptxPath});
  return {pptxPath,manifest,slide};
}
function inspect(pptxPath) {
  return JSON.parse(cp.execFileSync('python',[path.join(__dirname,'test_render_provenance.py'),pptxPath],{encoding:'utf8'}));
}
function verify(result, manifest=result.manifest, canonicalTexts) {
  const manifestPath = path.join(temp,'verify.json'); fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const args=[path.join(__dirname,'test_render_provenance.py'),result.pptxPath,manifestPath];
  if(canonicalTexts){const file=path.join(temp,'canonical-texts.json');fs.writeFileSync(file,JSON.stringify(canonicalTexts));args.push(file);}
  const out = cp.spawnSync('python',args,{encoding:'utf8'});
  return {ok:out.status===0,output:out.stdout+out.stderr};
}
async function test(name, fn) {
  try {await fn();passes++;results.push({name,passed:true});console.log('PASS '+name);}
  catch(error){results.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}
}
(async()=>{
  const red = await sharp({create:{width:12,height:8,channels:3,background:'#ff0020'}}).png().toBuffer();
  const blue = await sharp({create:{width:12,height:8,channels:3,background:'#0020ff'}}).png().toBuffer();
  const photo = path.join(temp,'photo.png'); const other = path.join(temp,'other.png');
  const icon = path.join(temp,'icons','icon.png');fs.mkdirSync(path.dirname(icon));
  fs.writeFileSync(photo,red);fs.writeFileSync(other,blue);fs.writeFileSync(icon,red);
  const positive = await emit('positive',s=>{
    cases.forEach((row,i)=>s.txt(row.content,20,10+i*40,600,35,{sz:10}));
    s.img(photo,700,20,120,80);s.img(other,840,20,120,80);s.img(icon,980,20,120,80);
    s.rrect(700,200,100,100,{fill:'FFFFFF'});
  });
  const emitted=inspect(positive.pptxPath);
  // The literals above are independent expectations derived from OOXML, not the implementation serializer.
  for(let i=0;i<cases.length;i++) await test('emitted text '+cases[i].name,async()=>{
    assert.equal(emitted[i].text,cases[i].expected);
    assert.equal(positive.manifest.slides['1'].objects[i].textContentSha256,hash(emitted[i].text));
  });
  await test('authored logical text remains distinct from projected emitted text',async()=>{
    const objects=positive.manifest.slides['1'].objects;
    assert.equal(objects[3].textInputSerialization,'surface-input-text-v1');
    assert.equal(objects[3].textInputSha256,hash('a\r\nb'));
    assert.notEqual(objects[3].textInputSha256,objects[3].textContentSha256);
    assert.equal(objects[6].textInputSha256,hash('a\n'));
    assert.notEqual(objects[6].textInputSha256,objects[6].textContentSha256);
    assert.equal(objects[0].textInputSha256,hash(cases[0].content));
    assert.notEqual(objects[0].textInputSha256,hash(cases[0].content.trim()));
  });
  await test('independent canonical authored text rejects CRLF-altered emission',async()=>{
    const good=verify(positive,positive.manifest,{'1':'North'});assert(good.ok,good.output);
    const bad=verify(positive,positive.manifest,{'3':'a\r\nb'});
    assert(!bad.ok);assert.match(bad.output,/canonical authored text mismatch/);
    const whitespace=verify(positive,positive.manifest,{'0':cases[0].content.trim()});
    assert(!whitespace.ok);assert.match(whitespace.output,/canonical authored text mismatch/);
  });
  await test('projected text identity names tested emitter version',async()=>{
    assert.equal(positive.manifest.slides['1'].objects[0].textContentEmitterVersion,'4.0.1');
    assert.equal(positive.manifest.slides['1'].objects[0].textContentIdentityError,null);
  });
  await test('unverified emitter version fails closed for projected identity',async()=>{
    const result=await emit('unverified-version',(s,slide,pptx)=>{
      Object.defineProperty(pptx,'version',{value:'unverified-test-version'});
      s.txt('Native',20,20,200,50);
    });
    const obj=result.manifest.slides['1'].objects[0];
    assert.equal(obj.textContentSha256,null);
    assert.equal(obj.textContentIdentityError,'UNVERIFIED_PPTXGENJS_VERSION');
    assert.equal(obj.textInputSha256,hash('Native'));
    const v=verify(result);assert(!v.ok);assert.match(v.output,/text identity mismatch/);
  });
  await test('missing emitter version leaves projected identity unsupported',async()=>{
    const result=await emit('missing-version',(s,slide,pptx)=>{
      Object.defineProperty(pptx,'version',{value:undefined});
      s.txt('Native',20,20,200,50);
    });
    const obj=result.manifest.slides['1'].objects[0];
    assert.equal(obj.textContentEmitterVersion,null);assert.equal(obj.textContentSha256,null);
    assert.equal(obj.textContentIdentityError,'UNVERIFIED_PPTXGENJS_VERSION');
    assert.equal(obj.textInputSha256,hash('Native'));
  });
  await test('XML-forbidden control is explicitly unsupported and package rejected',async()=>{
    const result=await emit('xml-control',s=>s.txt('a\u0001b',20,20,200,50));
    const obj=result.manifest.slides['1'].objects[0];
    assert.equal(obj.textContentSha256,null);assert.equal(obj.textContentIdentityError,'UNSUPPORTED_XML_TEXT');
    const v=verify(result);assert(!v.ok);assert.match(v.output,/ParseError/);
  });
  await test('unpaired surrogate never claims exact authored Unicode identity',async()=>{
    const result=await emit('unpaired-surrogate',s=>s.txt('a\ud800b',20,20,200,50));
    const obj=result.manifest.slides['1'].objects[0];
    assert.equal(obj.textInputSha256,null);assert.equal(obj.textInputIdentityError,'UNSUPPORTED_UNICODE_TEXT');
    assert.equal(obj.textContentSha256,null);assert.equal(obj.textContentIdentityError,'UNSUPPORTED_XML_TEXT');
    assert(!verify(result).ok);
  });
  await test('source-pixel geometry retained unchanged',async()=>{
    assert.deepEqual(['x','y','w','h'].map(k=>positive.manifest.slides['1'].objects[0][k]),[20,10,600,35]);
  });
  await test('real package verifies hashes and geometry',async()=>{const v=verify(positive);assert(v.ok,v.output);});
  await test('same-length wrong text rejected',async()=>{
    const wrong=clone(positive.manifest); const obj=wrong.slides['1'].objects[1];
    assert.equal(obj.textLength,'South'.length); obj.textContentSha256=hash('South');
    const v=verify(positive,wrong);assert(!v.ok);assert.match(v.output,/text identity mismatch/);
  });
  await test('distinct files retain exact identities and paths',async()=>{
    const images=positive.manifest.slides['1'].objects.filter(o=>o.type==='image');
    assert.equal(images[0].imageFileSha256,hash(red));assert.equal(images[1].imageFileSha256,hash(blue));
    assert.equal(images[0].imageSourcePath,photo);assert.equal(images[1].imageSourcePath,other);
    assert.notEqual(images[0].imageFileSha256,images[1].imageFileSha256);
  });
  await test('same filename replacement reread each surface call',async()=>{
    const result=await emit('same-name',s=>{
      fs.writeFileSync(photo,red);s.img(photo,10,10,100,100);
      fs.writeFileSync(photo,blue);s.img(photo,120,10,100,100);
    });
    const [a,b]=result.manifest.slides['1'].objects;
    assert.equal(a.imageFileSha256,hash(red));assert.equal(b.imageFileSha256,hash(blue));
    const v=verify(result);assert(!v.ok);assert.match(v.output,/image identity mismatch/);
  });
  await test('post-call image byte change rejected',async()=>{
    fs.writeFileSync(photo,red);
    const result=await emit('post-call',s=>s.img(photo,10,10,100,100),()=>fs.writeFileSync(photo,blue));
    const v=verify(result);assert(!v.ok);assert.match(v.output,/image identity mismatch/);
  });
  await test('native text dropped after recording rejected',async()=>{
    const result=await emit('dropped',s=>s.txt('Native',20,20,200,50),slide=>{slide._slideObjects.length=0;});
    const v=verify(result);assert(!v.ok);assert.match(v.output,/object count mismatch/);
  });
  await test('native text changed after recording rejected',async()=>{
    const result=await emit('changed',s=>s.txt('North',20,20,200,50),slide=>{slide._slideObjects[0].text[0].text='South';});
    const v=verify(result);assert(!v.ok);assert.match(v.output,/text identity mismatch/);
  });
  await test('screenshot-only replacement rejected as native text',async()=>{
    const result=await emit('screenshot',s=>s.txt('Native',20,20,200,50),slide=>{
      slide._slideObjects.length=0;slide.addImage({path:photo,x:ix(20),y:iy(20),w:ix(200),h:iy(50)});
    });
    const v=verify(result);assert(!v.ok);assert.match(v.output,/native text missing/);
  });
  await test('geometry change rejected',async()=>{
    const wrong=clone(positive.manifest);wrong.slides['1'].objects[0].x+=10;
    const v=verify(positive,wrong);assert(!v.ok);assert.match(v.output,/geometry mismatch/);
  });
  await test('raster icon content never claimed native editable',async()=>{
    const obj=positive.manifest.slides['1'].objects.find(o=>o.type==='icon');
    assert.equal(obj.contentEditable,false);assert.equal(obj.representation,'raster-image');
  });
  await test('enabled unreadable image records unavailable identity without new failure',async()=>{
    OM.reset();OM.setCurrentSlide(1);OM.setEnabled(true);
    OM.recordImage(path.join(temp,'nonexistent.png'),1,2,3,4);
    const obj=OM.toJSON().slides['1'].objects[0];
    assert.equal(obj.imageFileSha256,null);assert.equal(obj.imageIdentityError,'ENOENT');
    assert.equal(obj.contentEditable,false);
  });
  await test('disabled recording does not read image paths',async()=>{
    OM.reset();OM.recordImage(path.join(temp,'nonexistent.png'),1,2,3,4);assert.deepEqual(OM.toJSON().slides,{});
  });
  const summary={scope:'synthetic component emitted OOXML identity, not full workflow or render quality',node:process.version,pptxgenjs:require.resolve('pptxgenjs'),sharp:require.resolve('sharp'),passes,total:results.length,results,emittedText:emitted.filter(o=>o.kind==='text').map(o=>o.text)};
  const report=process.env.PROVENANCE_REPORT;if(report)fs.writeFileSync(report,JSON.stringify(summary,null,2)+'\n');
  if(process.env.PROVENANCE_KEEP==='1')console.log('Artifacts: '+temp);else fs.rmSync(temp,{recursive:true,force:true});
  console.log(`${passes}/${results.length} passed`);if(passes!==results.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
