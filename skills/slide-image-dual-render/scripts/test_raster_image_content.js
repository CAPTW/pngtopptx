#!/usr/bin/env node
'use strict';
// Invented 8x4 PNG/JPEG fixtures. Surface bytes only: no browser or PPTX emission.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-content-'));
for(const key of Object.keys(process.env)) if(key.startsWith('DECK_')) delete process.env[key];
process.env.HOME = path.join(root, 'empty-home'); fs.mkdirSync(process.env.HOME);
process.env.DECK_PROJECT_ROOT = root; process.env.DECK_ASSETS = root;
process.env.DECK_PXW = '1920'; process.env.DECK_PXH = '1080';
process.env.DECK_FONT = 'sans-serif'; process.env.DECK_FONT_INSTALL_DECISION = 'unavailable';
const lib = process.env.RASTER_CACHE_LIB_ROOT || path.join(__dirname, 'lib');
const OM = require(path.join(lib, 'object_manifest'));
const {makeHtmlSurface} = require(path.join(lib, 'atoms_html'));
const fixtures = {
  "red": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBguCOn0cCAAzDhk2RgYGBgwidJlAIAbikDTKNG4JYAAAAASUVORK5CYII=",
  "blue": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAIElEQVR4nGNkYGBgELG508CAAzDhk2RgYGBgwidJlAIAc+cDYLBrbG0AAAAASUVORK5CYII=",
  "jpeg": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor0jgP/9k="
};
const red=Buffer.from(fixtures.red,'base64'), blue=Buffer.from(fixtures.blue,'base64'), jpeg=Buffer.from(fixtures.jpeg,'base64');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const embedded=surface=>[...surface._html().matchAll(/src="data:image\/([^;]+);base64,([^"]+)"/g)].map(m=>({mime:m[1],bytes:Buffer.from(m[2],'base64')}));
function start(name,bytes=red){OM.reset();OM.setEnabled(true);OM.setCurrentSlide(1);const p=path.join(root,name);fs.writeFileSync(p,bytes);return {p,s:makeHtmlSurface({slideNo:1})};}
function rows(){return OM.toJSON().slides['1'].objects;}
test.after(()=>{OM.setEnabled(false);fs.rmSync(root,{recursive:true,force:true});});

test('stable PNG calls preserve exact HTML and recorded bytes',()=>{
 const {p,s}=start('stable.png');s.img(p,20,30,160,120);s.img(p,200,30,160,120);
 const expected=(x)=>`<img src="data:image/png;base64,${fixtures.red}" style="position:absolute;left:${x}px;top:30px;width:160px;height:120px;object-fit:fill;">`;
 assert.equal(s._html(),expected(20)+'\n'+expected(200));
 assert.deepEqual(rows().map(o=>o.imageFileSha256),[sha(red),sha(red)]);
});
test('same path replacement is observed on each image call',()=>{
 const {p,s}=start('replace.png');s.img(p,20,30,160,120);fs.writeFileSync(p,blue);s.img(p,200,30,160,120);
 assert.deepEqual(embedded(s).map(o=>o.bytes),[red,blue]);
 assert.deepEqual(rows().map(o=>o.imageFileSha256),embedded(s).map(o=>sha(o.bytes)));
});
test('new surface observes replacement while prior HTML remains unchanged',()=>{
 const {p,s}=start('new-surface.png');s.img(p,20,30,160,120);const old=s._html();fs.writeFileSync(p,blue);
 const next=makeHtmlSurface({slideNo:1});next.img(p,20,30,160,120);
 assert.deepEqual(embedded(next)[0].bytes,blue);assert.equal(s._html(),old);
 assert.equal(rows().at(-1).imageFileSha256,sha(embedded(next)[0].bytes));
});
test('equal file size and timestamp do not hide replacement',()=>{
 assert.equal(red.length,blue.length);const {p,s}=start('same-stat.png');const before=fs.statSync(p);s.img(p,0,0,80,40);
 fs.writeFileSync(p,blue);fs.utimesSync(p,before.atime,before.mtime);s.img(p,100,0,80,40);
 assert.deepEqual(embedded(s).map(o=>o.bytes),[red,blue]);
});
test('RGBA bytes including transparency are embedded verbatim',()=>{
 // PNG IHDR colour type 6 is RGBA; the invented fixture has alpha 0 and 128.
 assert.equal(red[25],6);const {p,s}=start('alpha.png');s.img(p,10,20,80,40);
 assert.deepEqual(embedded(s)[0].bytes,red);assert.equal(rows()[0].imageFileSha256,sha(red));
});
test('JPEG extension and stable bytes retain the existing MIME/output contract',()=>{
 const {p,s}=start('photo.JPEG',jpeg);s.img(p,10,20,80,40);
 assert.equal(s._html(),`<img src="data:image/jpeg;base64,${fixtures.jpeg}" style="position:absolute;left:10px;top:20px;width:80px;height:40px;object-fit:fill;">`);
 assert.deepEqual(embedded(s)[0],{mime:'jpeg',bytes:jpeg});assert.equal(rows()[0].imageFileSha256,sha(jpeg));
});
test('removed image fails rather than silently replaying cached pixels',()=>{
 const {p,s}=start('removed.png');s.img(p,10,20,80,40);const before=s._html();fs.unlinkSync(p);
 assert.throws(()=>s.img(p,100,20,80,40),{code:'ENOENT'});assert.equal(s._html(),before);
});
test('text-only mode keeps its existing no-image-read behavior',()=>{
 OM.reset();OM.setEnabled(false);const s=makeHtmlSurface({textOnly:true});s.img(path.join(root,'never-created.png'),0,0,80,40);assert.equal(s._html(),'');
});
