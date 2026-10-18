'use strict';
// Invented inputs, official factories, one tiny pinned in-memory package.
// HTML checks generated text/CSS; no browser, glyph or measured-fit claim.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),cp=require('node:child_process');
const PptxGenJS=require('pptxgenjs'),JSZip=require('jszip');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'text-preservation-'));
Object.assign(process.env,{HOME:temp,DECK_PROJECT_ROOT:temp,DECK_ASSETS:temp,DECK_FONT:'sans-serif',DECK_FONT_INSTALL_DECISION:'unavailable',DECK_PXW:'1672',DECK_PXH:'941'});
const lib=process.env.TEXT_PRESERVATION_LIB||path.join(__dirname,'lib');
const {makePptxSurface}=require(path.join(lib,'atoms_pptx')),{makeHtmlSurface}=require(path.join(lib,'atoms_html'));
const OM=require(path.join(lib,'object_manifest'));
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const cases=[
 {name:'single-space',content:'한글 English',expected:'한글 English'},
 {name:'repeated-spaces',content:'한글  English',expected:'한글  English'},
 {name:'boundary-spaces',content:'  한글  English  ',expected:'  한글  English  '},
 {name:'LF',content:'A\nB',expected:'A\nB'},
 {name:'CRLF',content:'A\r\nB',expected:'A\nB'},
 {name:'leading-LF',content:'\nA',expected:'\nA'},
 {name:'trailing-LF',content:'A\n',expected:'A\n'},
 {name:'consecutive-LF',content:'A\n\nB',expected:'A\n\nB'},
 {name:'empty',content:'',expected:''},
 {name:'empty-lines',content:'\n\n',expected:'\n\n'},
 {name:'rich-embedded-LF',content:[{text:'A\nB'},{text:'C'}],expected:'A\nBC'},
 {name:'rich-trailing-LF',content:[{text:'A\n'},{text:'B'}],expected:'A\nB'},
 {name:'rich-leading-LF',content:[{text:'A'},{text:'\nB'}],expected:'A\nB'},
 {name:'rich-CRLF',content:[{text:'A\r\nB'},{text:'C'}],expected:'A\nBC'},
 {name:'cross-run-CRLF',content:[{text:'A\r',bold:true},{text:'\nB',italic:true}],expected:'A\nB'},
 {name:'cross-empty-run-CRLF',content:[{text:'A\r'},{text:''},{text:'\nB'}],expected:'A\nB'},
 {name:'empty-rich-run',content:[{text:'A'},{text:''},{text:'B'}],expected:'AB'},
 {name:'explicit-break',content:[{text:'A',breakLine:true},{text:'B'}],expected:'A\nB'},
 {name:'explicit-and-embedded',content:[{text:'A\nB',breakLine:true},{text:'C'}],expected:'A\nB\nC'},
 {name:'explicit-and-trailing',content:[{text:'A\n',breakLine:true},{text:'B'}],expected:'A\n\nB'},
 {name:'entities',content:'한글 & <tag> "quoted"',expected:'한글 & <tag> "quoted"'},
 // Existing serializer boundary controls, deliberately not redefined here.
 {name:'standalone-CR',content:'A\rB',expected:'A\nB',htmlExpected:'A\rB'},
 {name:'rich-standalone-CR',content:[{text:'A\rB'},{text:'C'}],expected:'A\nBC',htmlExpected:'A\rBC'},
 {name:'final-explicit-break',content:[{text:'A',breakLine:true}],expected:'A',htmlExpected:'A\n'},
];
function capture(content,options={},fit={}){
 OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const calls=[];
 const surface=makePptxSurface({version:'4.0.1',ShapeType:{}},{addText:(text,opts)=>calls.push({text:clone(text),options:clone(opts)})},{slideNo:1,textFit:fit});
 surface.txt(content,20,30,700,50,{sz:20,...options});
 return {call:calls[0],record:clone(OM.toJSON().slides['1'].objects[0])};
}
function html(content,options={}){const s=makeHtmlSurface({slideNo:1,textOnly:true});s.txt(content,20,30,700,50,{sz:20,...options});return s._html();}
function decoded(fragment){return fragment.replace(/<br\s*\/?\s*>/g,'\n').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
function inputText(content){return Array.isArray(content)?content.map(r=>String(r.text)+(r.breakLine?'\n':'')).join(''):String(content);}

test('HTML keeps exact escaped text with preserving whitespace for every wrap mode',()=>{
 for(const row of cases){
  for(const options of [{},{wrap:false},{shrink:true}]){
   const result=html(row.content,options);
   assert(result.includes(`white-space:${options.wrap===false||options.shrink?'pre':'pre-wrap'};`),row.name+' whitespace');
   assert.equal(decoded(result),row.htmlExpected??row.expected,row.name);
   assert(!result.includes('white-space:nowrap;'));
  }
 }
 assert(html('A & <B>').includes('A &amp; &lt;B&gt;'));
 assert(!html('A & <B>').includes('&amp;amp;'));
 assert.equal(decoded(html('한글  A\nB')),decoded(html([{text:'한글 '},{text:' A\nB'}])));
});

test('rich segments preserve original styles and supplied text-fit size without mutation',()=>{
 const content=[Object.freeze({text:'A\r\nB',bold:true,color:'AA1122',fontSize:18}),Object.freeze({text:'C',italic:true,sz:16})];Object.freeze(content);
 const before=JSON.stringify(content);const result=capture(content,{shrink:true},{'1:1':{fontSizePt:10,shrinkApplied:true}});
 assert.equal(JSON.stringify(content),before);assert.equal(result.call.options.fontSize,10);
 assert.deepEqual(result.call.text.map(r=>[r.text,r.options.breakLine,r.options.fontSize]),[['A',true,9],['B',false,9],['C',false,8]]);
 for(const r of result.call.text.slice(0,2)){assert.equal(r.options.bold,true);assert.equal(r.options.color,'AA1122');}
 assert.equal(result.call.text[2].options.italic,true);assert.equal(result.record.textInputSha256,hash('A\r\nBC'));
 assert.equal(result.record.textContentSha256,hash('A\nBC'));
 assert.equal(result.record.textInputSerialization,'surface-input-text-v1');
});

test('ordinary input, empty runs and final explicit-break controls retain established arguments',()=>{
 assert.equal(capture('Plain  한글').call.text,'Plain  한글');
 assert.deepEqual(capture([{text:'A',bold:true},{text:'B'}]).call.text.map(r=>[r.text,r.options.breakLine]),[['A',false],['B',false]]);
 assert.deepEqual(capture([{text:'A',breakLine:true}]).call.text.map(r=>[r.text,r.options.breakLine]),[['A',true]]);
 assert.equal(capture('A\rB').call.text,'A\rB');
 assert.deepEqual(capture([{text:'A\n',breakLine:true},{text:'B'}]).call.text.map(r=>[r.text,r.options.breakLine]),[['A',true],['',true],['B',false]]);
});

test('cross-run CRLF coalesces only adjacent text without crossing an explicit break',()=>{
 const {prepareTextRuns}=require(path.join(lib,'text_content'));
 assert.deepEqual(prepareTextRuns([{text:'A\r',bold:true},{text:'',italic:true},{text:'\nB'}]).map(r=>[r.text,r.breakLine]),[['A',false],['',false],['',true],['B',false]]);
 assert.deepEqual(prepareTextRuns([{text:'A\r',breakLine:true},{text:'\nB'}]).map(r=>[r.text,r.breakLine]),[['A\r',true],['',true],['B',false]]);
});

test('real pinned package retains intended logical text and separate raw-input audit',async()=>{
 const pptx=new PptxGenJS();assert.equal(pptx.version,'4.0.1');pptx.defineLayout({name:'SOURCE',width:13.333,height:7.5});pptx.layout='SOURCE';
 OM.reset();OM.setCurrentSlide(1);OM.setEnabled(true);
 const s=makePptxSurface(pptx,pptx.addSlide(),{slideNo:1,textFit:{}});cases.forEach((row,i)=>s.txt(row.content,20,10+i*30,700,25,{sz:12}));
 const records=clone(OM.toJSON().slides['1'].objects),buffer=await pptx.write({outputType:'nodebuffer'}),zip=await JSZip.loadAsync(buffer),xml=await zip.file('ppt/slides/slide1.xml').async('string');
 const script=`import json,sys,xml.etree.ElementTree as E
n={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
r=E.fromstring(sys.stdin.read());out=[]
for s in r.findall('p:cSld/p:spTree/p:sp',n):
 p=[''.join(('\\n' if c.tag=='{'+n['a']+'}br' else ''.join(t.text or '' for t in c.findall('a:t',n))) for c in q if c.tag in {'{'+n['a']+'}r','{'+n['a']+'}br'}) for q in s.findall('p:txBody/a:p',n)]
 out.append({'paragraphs':p,'text':'\\n'.join(p)})
print(json.dumps(out,ensure_ascii=False))`;
 const emitted=JSON.parse(cp.execFileSync('python',['-c',script],{input:xml,encoding:'utf8'}));assert.equal(emitted.length,cases.length);
 for(let i=0;i<cases.length;i++){assert.equal(emitted[i].text,cases[i].expected,cases[i].name);assert.equal(records[i].textInputSha256,hash(inputText(cases[i].content)));assert.equal(records[i].textContentSha256,hash(emitted[i].text));}
 if(process.env.TEXT_PRESERVATION_OUTPUT){fs.mkdirSync(process.env.TEXT_PRESERVATION_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.TEXT_PRESERVATION_OUTPUT,'slide.xml'),xml);fs.writeFileSync(path.join(process.env.TEXT_PRESERVATION_OUTPUT,'emitted-text.json'),JSON.stringify({emitter:pptx.version,packageBytes:buffer.length,scope:'Synthetic text/paragraph serialization, not visible font rendering',cases:cases.map((row,i)=>({...row,emitted:emitted[i],record:records[i]}))},null,2)+'\n');}
});

test('actual text-fit fingerprint changes when only shared preparation helper bytes change',()=>{
 const file=path.resolve(lib,'../build.js'),source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('function textFitFingerprint(){'),end=source.indexOf('\nfunction buildTextFitManifest()',start);assert(start>=0&&end>start);
 // Evaluate only this existing pure hash function, never build.js's entrypoint.
 const scripts=path.join(temp,'fingerprint/scripts');fs.mkdirSync(path.join(scripts,'lib'),{recursive:true});
 const helper=path.join(scripts,'lib/text_content.js');fs.copyFileSync(path.join(lib,'text_content.js'),helper);
 const context={process:{env:{}},path,crypto,SCRIPT_ROOT:scripts,SLIDES_PATH:path.join(temp,'slides.js'),order:[1],PXW:1672,PXH:941,FONT_MANIFEST_PATH:'',
  hashFileIfPresent:p=>fs.existsSync(p)?hash(fs.readFileSync(p)):'',stableFontResolutionFingerprint:()=>''};
 const fingerprint=vm.runInNewContext('('+source.slice(start,end).trim()+')',context);
 const before=fingerprint();fs.appendFileSync(helper,'\n// test-only byte mutation\n');assert.notEqual(fingerprint(),before);
});
