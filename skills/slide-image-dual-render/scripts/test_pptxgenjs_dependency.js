'use strict';
// Synthetic projects; module selection and mocked build/pipeline only. No browser or package emission.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const scripts=process.env.DEPENDENCY_TEST_SCRIPTS||__dirname;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pptx-dependency-'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const PROFILE='pptxgenjs-4.0.1-paragraph-properties-v1';
const request={schemaVersion:'slide-image-dual-render.pptxgenjs-dependency-request.v1',profile:PROFILE};
const ROOT_CJS='873d182a8e2e1c0b5e522ef146117936b96b9b2024667bd4c1de59e2b031d27a';
const RESULT='9982d975f1e313be401af8472420e5d5af59f9d9b6707952bf9b879c2b3560e2';
let counter=0;
function project(value=request){const p=path.join(temp,'project-'+(++counter));fs.mkdirSync(path.join(p,'analysis'),{recursive:true});if(value!==undefined)fs.writeFileSync(path.join(p,'analysis/pptxgenjs_dependency.json'),JSON.stringify(value));return p;}
function absentProject(){const p=project();fs.unlinkSync(path.join(p,'analysis/pptxgenjs_dependency.json'));return p;}
function api(){return require(path.join(scripts,'lib/pptxgenjs_dependency'));}
function isolatedApi(options={}){
 const dir=path.join(temp,'loader-'+(++counter));fs.mkdirSync(dir,{recursive:true});fs.cpSync(path.join(scripts,'lib'),dir,{recursive:true});
 if(options.patch)fs.appendFileSync(path.join(dir,'patches/pptxgenjs-4.0.1-paragraph-properties.patch'),'\n');
 if(options.license)fs.appendFileSync(path.join(dir,'patches/PptxGenJS-LICENSE'),'\n');
 const file=path.join(dir,'pptxgenjs_dependency.js'),code=fs.readFileSync(file,'utf8');
 const normal=require('node:module').createRequire(file);
 const local=id=>normal(id);local.resolve=id=>id==='pptxgenjs'&&options.base?options.base:normal.resolve(id);
 const mod={exports:{}};vm.compileFunction(code,['exports','require','module','__filename','__dirname'],{filename:file})(mod.exports,local,mod,file,dir);
 return mod.exports;
}
function functionFrom(file,start,end,context){const src=fs.readFileSync(file,'utf8'),a=src.indexOf(start),b=src.indexOf(end,a);assert(a>=0&&b>a);return vm.runInNewContext('('+src.slice(a,b).trim()+')',context);}
function buildFunctions(selection, sourceScripts=scripts){
 const projectRoot=selection?selection.descriptor.projectRoot:absentProject();fs.mkdirSync(path.join(projectRoot,'out'),{recursive:true});
 const context={fs,path,crypto,process:{env:{}},console:{log(){},warn(){}},Date,BUILD_STARTED_MS:1,PROJECT_ROOT:projectRoot,SCRIPT_ROOT:scripts,SKILL_ROOT:path.dirname(scripts),SLIDES_PATH:path.join(projectRoot,'lib/slides.js'),order:['s1'],PXW:1672,PXH:941,FONT_POLICY:{},__filename:path.join(scripts,'build.js'),PPTXGENJS_DEPENDENCY:selection,dependencyDescriptor:api().dependencyDescriptor,hashFileIfPresent:p=>fs.existsSync(p)?hash(fs.readFileSync(p)):'',stableFontResolutionFingerprint:()=>''};
 const file=path.join(sourceScripts,'build.js');return {context,fingerprint:functionFrom(file,'function textFitFingerprint(){','\nfunction buildTextFitManifest()',context),trace:functionFrom(file,'function writeBuildTrace(','\n(async ()=>',context)};
}

test('absent request preserves original selection and adds no manifest metadata',()=>{
 const a=api(),p=absentProject();assert.equal(a.loadPptxgenjsDependency(p),null);assert.equal(a.dependencyProfileRequested(p),false);
 const OM=require(path.join(scripts,'lib/object_manifest'));OM.reset();const file=path.join(p,'manifest.json');const row=OM.writeNativeManifest(file);assert(!Object.hasOwn(row,'pptxgenjsDependency'));assert(!fs.existsSync(path.join(p,'.cache')));
});

test('exact base plus reviewed patch loads only verified bytes and preserves installed resolver',()=>{
 const original=require.resolve('pptxgenjs'),before=hash(fs.readFileSync(original)),a=api(),p=project();assert.equal(before,ROOT_CJS);
 const selected=a.loadPptxgenjsDependency(p),d=a.dependencyDescriptor(selected);assert.equal(d.profile,PROFILE);assert.equal(d.resultSha256,RESULT);assert.equal(hash(fs.readFileSync(d.cacheEntryPath)),RESULT);assert.equal(new selected.PptxGenJS().version,'4.0.1');
 assert(Object.isFrozen(d));assert.equal(a.inspectPptxgenjsDependency(p).resultSha256,RESULT);assert.equal(require.resolve('pptxgenjs'),original);assert.equal(hash(fs.readFileSync(original)),before);
 const stat=fs.statSync(d.cacheEntryPath),again=a.loadPptxgenjsDependency(p);assert.equal(fs.statSync(d.cacheEntryPath).ino,stat.ino);assert.deepEqual(again.descriptor,d);
 assert.throws(()=>a.dependencyDescriptor({descriptor:d}),/verified selection/);
 const OM=require(path.join(scripts,'lib/object_manifest'));assert.throws(()=>OM.writeNativeManifest(path.join(p,'spoof.json'),{descriptor:d}),/verified selection/);assert(!fs.existsSync(path.join(p,'spoof.json')));
});

test('present invalid or unsafe request fails before compiling or cache creation',()=>{
 const a=api();for(const input of [null,{},[],{...request,profile:'4.0.1'},{...request,path:'/tmp/other.js'},{...request,schemaVersion:1}]){const p=project(input);assert.throws(()=>a.loadPptxgenjsDependency(p));assert(!fs.existsSync(path.join(p,'.cache')));}
 const p=project(),f=path.join(p,'analysis/pptxgenjs_dependency.json');fs.writeFileSync(f,'{');assert.throws(()=>a.loadPptxgenjsDependency(p));fs.unlinkSync(f);fs.symlinkSync(path.join(temp,'outside'),f);assert.throws(()=>a.loadPptxgenjsDependency(p));
 const q=project();fs.renameSync(path.join(q,'analysis'),path.join(q,'outside-analysis'));fs.symlinkSync('outside-analysis',path.join(q,'analysis'));assert.throws(()=>a.loadPptxgenjsDependency(q),/symlink/);
 const fifo=project();fs.unlinkSync(path.join(fifo,'analysis/pptxgenjs_dependency.json'));require('node:child_process').execFileSync('mkfifo',[path.join(fifo,'analysis/pptxgenjs_dependency.json')]);assert.throws(()=>a.loadPptxgenjsDependency(fifo),/regular/);
});

test('wrong original, patch or license bytes fail without cache or fallback',()=>{
 const altered=path.join(temp,'wrong-base.cjs');fs.writeFileSync(altered,'throw Error("must never execute")');
 for(const a of [isolatedApi({base:altered}),isolatedApi({patch:true}),isolatedApi({license:true})]){const p=project();assert.throws(()=>a.loadPptxgenjsDependency(p),/sha256|identity/);assert(!fs.existsSync(path.join(p,'.cache')));}
});

test('existing corrupt or linked cache entries and cache ancestors fail without overwrite',()=>{
 const a=api();for(const mode of ['bytes','symlink','directory']){const p=project(),d=a.loadPptxgenjsDependency(p).descriptor;fs.unlinkSync(d.cacheEntryPath);if(mode==='bytes')fs.writeFileSync(d.cacheEntryPath,'competing');if(mode==='symlink')fs.symlinkSync(require.resolve('pptxgenjs'),d.cacheEntryPath);if(mode==='directory')fs.mkdirSync(d.cacheEntryPath);assert.throws(()=>a.loadPptxgenjsDependency(p));if(mode==='bytes')assert.equal(fs.readFileSync(d.cacheEntryPath,'utf8'),'competing');}
 const p=project(),outside=path.join(temp,'outside-cache');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(p,'.cache'));assert.throws(()=>a.loadPptxgenjsDependency(p),/symlink/);assert.deepEqual(fs.readdirSync(outside),[]);
});

test('exclusive cache race never replaces or removes a competing entry',()=>{
 const a=api(),p=project(),link=fs.linkSync;let fired=false;
 fs.linkSync=function(from,to){if(!fired&&to.endsWith('pptxgen.cjs.js')){fired=true;fs.writeFileSync(to,'competing writer');const e=new Error('race');e.code='EEXIST';throw e;}return link.apply(this,arguments);};
 try{assert.throws(()=>a.loadPptxgenjsDependency(p),/sha256|identity/);}finally{fs.linkSync=link;}
 const entry=path.join(p,'.cache/pptxgenjs',RESULT,'pptxgen.cjs.js');assert.equal(fs.readFileSync(entry,'utf8'),'competing writer');
});

test('selected descriptor binds fingerprint, build trace and root manifest',()=>{
 const p=project(),a=api(),selected=a.loadPptxgenjsDependency(p),b=buildFunctions(selected),out=path.join(p,'out');fs.writeFileSync(path.join(out,'render_trace.json'),'{}');
 b.trace('pptx',path.join(out,'deck.pptx'),null,null);const trace=JSON.parse(fs.readFileSync(path.join(out,'build_trace.json')));assert.deepEqual(trace.pptxgenjsDependency,selected.descriptor);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'render_trace.json'))).build.pptxgenjsDependency,selected.descriptor);
 const OM=require(path.join(scripts,'lib/object_manifest'));OM.reset();assert.deepEqual(OM.writeNativeManifest(path.join(out,'native_object_manifest.json'),selected).pptxgenjsDependency,selected.descriptor);
 const tagged=b.fingerprint();b.context.PPTXGENJS_DEPENDENCY=null;assert.notEqual(b.fingerprint(),tagged);assert.throws(()=>{b.context.PPTXGENJS_DEPENDENCY={descriptor:selected.descriptor};b.fingerprint();},/verified selection/);
});

function pipeline(projectRoot,mutation,sourceScripts=scripts){
 const file=path.join(sourceScripts,'slide_pipeline.js'),src=fs.readFileSync(file,'utf8');const cut=src.lastIndexOf('\ntry {\n  main();');assert(cut>0);
 const local=require('node:module').createRequire(file),context={require:local,__dirname:scripts,process:{argv:[],env:{},execPath:process.execPath},console:{log(){},warn(){},error(){}},Buffer,Date};vm.createContext(context);vm.runInContext(src.slice(0,cut),context);
 const layout={projectRoot,outDir:path.join(projectRoot,'out'),assetsDir:path.join(projectRoot,'assets'),tracePath:path.join(projectRoot,'out/render_trace.json'),nativeObjectManifestPath:path.join(projectRoot,'out/native_object_manifest.json')};fs.mkdirSync(layout.outDir,{recursive:true});
 const calls=[];Object.assign(context,{parseArgs:()=>({target:'pptx',skipAssets:true,skipCrops:true}),resolveLayout:()=>layout,parsePipelineSlides:()=>[1],applyPipelineQualityDefaults(){},validatePaths(){},resolveNodeDependencies:()=>({ok:true}),baseEnv:()=>({}),traceSkeleton:()=>({target:'pptx',validation:{passed:false}}),refreshTraceArtifacts(){},fontPreflightArgs:()=>[],validationArgs:()=>[],evidenceArgs:()=>[],runNode(label){calls.push(label);if(label==='approved build pipeline'){const selected=api().loadPptxgenjsDependency(projectRoot);if(selected){const b=buildFunctions(selected);b.trace('pptx',path.join(layout.outDir,'deck.pptx'),null,null);const OM=require(path.join(scripts,'lib/object_manifest'));OM.reset();OM.writeNativeManifest(layout.nativeObjectManifestPath,selected);}if(mutation)mutation(layout);}},runPython(){throw Error('not allowed');}});
 let error;try{context.main();}catch(e){error=e;}return {error,calls,trace:JSON.parse(fs.readFileSync(layout.tracePath))};
}

test('normal pipeline control flow retains descriptor and fails before success on missing/mismatched receipts',()=>{
 const good=pipeline(project());assert.ifError(good.error);assert.equal(good.trace.validation.passed,true);assert.equal(good.trace.pptxgenjsDependency.resultSha256,RESULT);
 const absent=pipeline(absentProject());assert.ifError(absent.error);assert(!Object.hasOwn(absent.trace,'pptxgenjsDependency'));
 for(const mutate of [l=>fs.unlinkSync(path.join(l.outDir,'build_trace.json')),l=>{const f=l.nativeObjectManifestPath,v=JSON.parse(fs.readFileSync(f));v.pptxgenjsDependency.resultSha256='0'.repeat(64);fs.writeFileSync(f,JSON.stringify(v));},l=>fs.unlinkSync(path.join(l.projectRoot,'analysis/pptxgenjs_dependency.json'))]){const r=pipeline(project(),mutate);assert(r.error);assert.equal(r.trace.validation.passed,false);assert(!r.calls.includes('final contract validation'));}
});


test('dependency resolution stays anchored to original package, and compile receives verified buffer',()=>{
 const p=project(),shadow=path.join(p,'node_modules/jszip');fs.mkdirSync(shadow,{recursive:true});fs.writeFileSync(path.join(shadow,'index.js'),'throw Error("project shadow must not run")');
 const original=vm.compileFunction;let observed;
 vm.compileFunction=function(code,args,options){assert.equal(hash(Buffer.from(code)),RESULT);const run=original.apply(this,arguments);return function(...values){observed=values[1].resolve('jszip');return run.apply(this,values);};};
 try{api().loadPptxgenjsDependency(p);}finally{vm.compileFunction=original;}
 assert.equal(observed,require('node:module').createRequire(require.resolve('pptxgenjs')).resolve('jszip'));assert(!observed.startsWith(p));
});

test('replacement after cache publication is rejected and competing bytes survive',()=>{
 const p=project(),original=fs.linkSync;let fired=false;
 fs.linkSync=function(from,to){const result=original.apply(this,arguments);if(!fired&&to.endsWith('pptxgen.cjs.js')){fired=true;const replacement=to+'.replacement';fs.writeFileSync(replacement,'replacement');fs.renameSync(replacement,to);}return result;};
 try{assert.throws(()=>api().loadPptxgenjsDependency(p),/sha256|identity/);}finally{fs.linkSync=original;}
 assert.equal(fs.readFileSync(path.join(p,'.cache/pptxgenjs',RESULT,'pptxgen.cjs.js'),'utf8'),'replacement');
});

test('receipt FIFO and late request/cache changes fail the final pipeline check',()=>{
 const fifo=pipeline(project(),l=>{const file=path.join(l.outDir,'build_trace.json');fs.unlinkSync(file);require('node:child_process').execFileSync('mkfifo',[file]);});assert(fifo.error);assert.match(fifo.error.message,/regular/);assert.equal(fifo.trace.validation.passed,false);
 const p=project(),selected=api().loadPptxgenjsDependency(p),b=buildFunctions(selected);b.trace('pptx',path.join(p,'out/deck.pptx'),null,null);const OM=require(path.join(scripts,'lib/object_manifest'));OM.reset();OM.writeNativeManifest(path.join(p,'out/native_object_manifest.json'),selected);
 const check=()=>api().verifyPptxgenjsDependencyReceipts(p,path.join(p,'out/build_trace.json'),path.join(p,'out/native_object_manifest.json'));
 assert.equal(check().resultSha256,RESULT);fs.appendFileSync(path.join(p,'analysis/pptxgenjs_dependency.json'),'\n');assert.throws(check,/mismatch/);
 fs.writeFileSync(path.join(p,'analysis/pptxgenjs_dependency.json'),JSON.stringify(request));fs.writeFileSync(selected.descriptor.cacheEntryPath,'changed');assert.throws(check,/sha256/);
});

test('default outputs preserve legacy shape, with optional exact baseline byte comparison',()=>{
 const baseline=process.env.DEPENDENCY_TEST_BASELINE;
 if(!baseline){
  const b=buildFunctions(null),c=b.context;
  const payload={contract:'slide-image-dual-render.text-fit.v1',slidesJs:c.hashFileIfPresent(c.SLIDES_PATH),atomsHtml:c.hashFileIfPresent(path.join(scripts,'lib/atoms_html.js')),textContent:c.hashFileIfPresent(path.join(scripts,'lib/text_content.js')),selectedSlides:['s1'],sourcePixelCanvas:{width:1672,height:941},profile:'',fontResolution:'',fontUsage:''};
  assert.equal(b.fingerprint(),hash(JSON.stringify(payload)));
  const OM=require(path.join(scripts,'lib/object_manifest'));OM.reset();assert.deepEqual(Object.keys(OM.toJSON()),['generatedAt','source','slides']);
  const result=pipeline(absentProject());assert.ifError(result.error);assert.equal(result.trace.validation.passed,true);assert(!Object.hasOwn(result.trace,'pptxgenjsDependency'));
  return;
 }
 const p=absentProject(),candidate=buildFunctions(null),old=buildFunctions(null,baseline);Object.assign(old.context,candidate.context);assert.equal(old.fingerprint(),candidate.fingerprint());
 const FixedDate=class extends Date{constructor(){super('2026-01-01T00:00:00.000Z');}static now(){return 1;}};
 function manifest(lib){const file=path.join(lib,'object_manifest.js'),mod={exports:{}};vm.compileFunction(fs.readFileSync(file,'utf8'),['exports','require','module','__filename','__dirname','Date'],{filename:file})(mod.exports,require('node:module').createRequire(file),mod,file,lib,FixedDate);mod.exports.reset();return mod.exports.writeNativeManifest(path.join(p,'manifest-'+(++counter)+'.json'));}
 assert.deepEqual(manifest(path.join(scripts,'lib')),manifest(path.join(baseline,'lib')));
 const a=pipeline(p),b=pipeline(p,null,baseline);assert.ifError(a.error);assert.ifError(b.error);
 const strip=x=>JSON.stringify(x,(key,value)=>['timestamp','completedAt','completedTimeMs'].includes(key)?undefined:value);assert.equal(strip(a.trace),strip(b.trace));
 // Identical context makes even build's absolute script/project paths controlled.
 candidate.context.Date=old.context.Date=FixedDate;candidate.trace('pptx',path.join(p,'out/deck.pptx'),null,null);const first=fs.readFileSync(path.join(p,'out/build_trace.json'),'utf8');old.trace('pptx',path.join(p,'out/deck.pptx'),null,null);assert.equal(fs.readFileSync(path.join(p,'out/build_trace.json'),'utf8'),first);
});


test('build entry selects verified dependency before loading any drawing surfaces',()=>{
 const file=path.join(scripts,'build.js'),source=fs.readFileSync(file,'utf8'),end=source.indexOf('\nconst SW =');assert(end>0);
 function prefix(p){const calls=[];const normal=require('node:module').createRequire(file);const local=id=>{calls.push(id);if(id==='child_process')return{spawnSync(){throw Error('subprocess prohibited in unit seam');}};if(id==='./lib/kit')return{};if(id==='./lib/profile')return{loadProfile:()=>null};if(['./lib/atoms_pptx','./lib/atoms_html'].includes(id))return{};return normal(id);};let error;try{vm.runInNewContext(source.slice(0,end),{require:local,__dirname:scripts,__filename:file,process:{env:{DECK_PROJECT_ROOT:p},cwd:()=>p,execPath:process.execPath},console:{warn(){},error(){}},Buffer,Date});}catch(e){error=e;}return{calls,error};}
 const bad=prefix(project(null));assert(bad.error);assert(!bad.calls.some(x=>x.includes('atoms_')));assert(!bad.calls.includes('pptxgenjs'));
 const plain=prefix(absentProject());assert.ifError(plain.error);assert(plain.calls.includes('pptxgenjs'));
 const selected=prefix(project());assert.ifError(selected.error);assert(!selected.calls.includes('pptxgenjs'));assert(selected.calls.includes('./lib/atoms_pptx'));
});
