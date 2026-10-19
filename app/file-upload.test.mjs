import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('./file-upload.ts',import.meta.url),'utf8');
const {uploadFileSelection,fileUploadMetadata,isFileDrag}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const pdf=(name='ticket.pdf')=>new File(['file'],name,{type:'application/pdf'});
test('dropped files with missing MIME use an accepted extension and sizes/types fail before creating server records',async()=>{
 assert.equal(fileUploadMetadata(new File(['PDF'],'TICKET.PDF')).mime,'application/pdf');
 assert.equal(fileUploadMetadata(new File(['PDF'],'hotel.pdf',{type:'application/octet-stream'})).mime,'application/pdf');
 for(const file of [new File([],'empty.pdf'),{name:'big.pdf',size:6291457,type:'application/pdf'},new File(['exe'],'bad.exe')]){
  let writes=0;
  await assert.rejects(uploadFileSelection([pdf(),file],{prepare:async()=>{writes++;},isCurrent:()=>true,onProgress:()=>{}}));
  assert.equal(writes,0);
 }
});
test('multi-file upload serializes prepare, private storage upload and finish; progress follows files',async()=>{
 const events=[],progress=[];
 await uploadFileSelection([pdf('a.pdf'),pdf('b.pdf')],{isCurrent:()=>true,onProgress:(i,n,name)=>progress.push([i,n,name]),prepare:async m=>{events.push('prepare:'+m.name);return{id:m.name,path:'private/'+m.name};},store:async(f,p,mime)=>{assert.equal(p.path,'private/'+f.name);assert.equal(mime,'application/pdf');events.push('store:'+f.name);},finish:async id=>events.push('finish:'+id)});
 assert.deepEqual(events,['prepare:a.pdf','store:a.pdf','finish:a.pdf','prepare:b.pdf','store:b.pdf','finish:b.pdf']);assert.deepEqual(progress,[[1,2,'a.pdf'],[2,2,'b.pdf']]);
});
test('a storage failure leaves its pending record recoverable, reports completed files and stops the remainder',async()=>{
 const events=[];
 await assert.rejects(uploadFileSelection([pdf('a.pdf'),pdf('b.pdf'),pdf('c.pdf')],{isCurrent:()=>true,onProgress:()=>{},prepare:async m=>{events.push(m.name);return{id:m.name,path:m.name};},store:async f=>{if(f.name==='b.pdf')throw Error('network unavailable');},finish:async id=>events.push('ready:'+id)}),/1개 업로드 완료 · b.pdf: network unavailable/);
 assert.deepEqual(events,['a.pdf','ready:a.pdf','b.pdf']);
});
test('leaving a travel scope finishes the current file and never starts another file in the next trip',async()=>{
 let current=true;const events=[];
 await uploadFileSelection([pdf('a.pdf'),pdf('b.pdf')],{isCurrent:()=>current,onProgress:()=>{},prepare:async m=>{events.push(m.name);return{id:m.name,path:m.name};},store:async()=>{current=false;},finish:async id=>events.push('ready:'+id)});
 assert.deepEqual(events,['a.pdf','ready:a.pdf']);
});
test('file drags are recognized in protected drag mode while text/URL drags are ignored',()=>{
 assert.equal(isFileDrag({types:['Files']}),true);assert.equal(isFileDrag({types:['text/plain','Files']}),true);assert.equal(isFileDrag({types:['text/uri-list','text/plain']}),false);
});
