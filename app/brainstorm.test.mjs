import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const directory=await mkdtemp(path.join(tmpdir(),'tripboogie-brain-'));
test.after(()=>rm(directory,{recursive:true,force:true}));
await writeFile(path.join(directory,'package.json'),'{"type":"commonjs"}');
for(const name of ['brainstorm','brainstorm-store','brainstorm-backup'])await writeFile(path.join(directory,`${name}.js`),ts.transpileModule(await readFile(new URL(`./${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let mockApi;
await writeFile(path.join(directory,'client-api.js'),'exports.jsonRequest=data=>({body:JSON.stringify(data)});exports.apiFetch=(...args)=>global.__brainTestApi(...args);');
const require=createRequire(path.join(directory,'package.json'));
const {BrainStore}=require('./brainstorm-store.js'),{axis,cellKey,parseTsv,sheetTsv,mergeDelta}=require('./brainstorm.js');
global.__brainTestApi=(...args)=>mockApi(...args);
const {brainImportBatches,importBrainDocuments}=require('./brainstorm-backup.js');
const copy=value=>structuredClone(value);
const initial=()=>({id:'doc',tripId:'trip',kind:'sheet',title:'표',revision:1,metaVersion:1,deletedAt:null,updatedAt:'',entities:{},preview:{}});
function server(){
 let document=initial(),failAfterWrite=false,offline=false,denied=false;const seen=new Map();
 return {
  get document(){return copy(document);},
  loseResponse(){failAfterWrite=true;},setOffline(value){offline=value;},setDenied(value){denied=value;},
  transport:{read:async()=>{if(denied)throw Object.assign(new Error('권한이 제거됐어요.'),{status:404});return {...copy(document),reset:true};},write:async(mutation)=>{
   if(offline)throw new Error('연결 끊김');
   if(seen.has(mutation.mutationId))return {...copy(document),reset:true};
   for(const change of mutation.changes)if((document.entities[change.key]?.stamp??null)!==change.expected)throw Object.assign(new Error('충돌'),{status:409});
   document.revision++;
   for(const change of mutation.changes)document.entities[change.key]={value:copy(change.value),stamp:mutation.mutationId,revision:document.revision};
   seen.set(mutation.mutationId,true);
   if(failAfterWrite){failAfterWrite=false;throw new Error('응답 유실');}
   return {...copy(document),reset:true};
  }}
 };
}
async function settled(store){for(let i=0;i<100;i++){await new Promise(resolve=>setImmediate(resolve));const s=store.getSnapshot();if(!s.pending||s.error)return s;}throw new Error('Store did not settle');}
test('queued edits preserve newer typing and response-loss retry commits only once',async()=>{
 const s=server(),store=new BrainStore(initial(),s.transport);s.loseResponse();store.edit({'cell:r0:c0':{text:'첫 입력'}});await settled(store);
 assert.equal(store.getSnapshot().pending,1);assert.equal(s.document.revision,2);
 store.edit({'cell:r0:c0':{text:'이어 입력'}});assert.equal(store.getSnapshot().document.entities['cell:r0:c0'].value.text,'이어 입력');
 store.retry();await settled(store);assert.equal(store.getSnapshot().pending,0);assert.equal(s.document.revision,3);assert.equal(s.document.entities['cell:r0:c0'].value.text,'이어 입력');
});
test('concurrent independent cells merge while stale same-cell drafts remain recoverable',async()=>{
 const s=server(),a=new BrainStore(initial(),s.transport),b=new BrainStore(initial(),s.transport);
 a.edit({'cell:r0:c0':{text:'가'}});await settled(a);b.edit({'cell:r0:c1':{text:'나'}});await settled(b);await a.refresh();
 assert.equal(a.getSnapshot().document.entities['cell:r0:c1'].value.text,'나');
 b.edit({'cell:r0:c0':{text:'동행'}});await settled(b);a.edit({'cell:r0:c0':{text:'내 입력'}});await settled(a);
 assert.equal(a.getSnapshot().conflict,true);assert.equal(a.getSnapshot().document.entities['cell:r0:c0'].value.text,'내 입력');assert.equal(s.document.entities['cell:r0:c0'].value.text,'동행');assert.match(a.recovery(),/내 입력/);
 a.discard();assert.equal(a.getSnapshot().document.entities['cell:r0:c0'].value.text,'동행');
});
test('personal undo does not remove another person edits and can redo multiple local actions',async()=>{
 const s=server(),a=new BrainStore(initial(),s.transport),b=new BrainStore(initial(),s.transport);
 a.edit({'cell:r0:c0':{text:'하나'}});await settled(a);a.edit({'cell:r0:c0':{text:'둘'}});await settled(a);
 await a.undo();assert.equal(s.document.entities['cell:r0:c0'].value.text,'하나');await a.undo();assert.equal(s.document.entities['cell:r0:c0'].value,null);
 await a.undo(true);await a.undo(true);assert.equal(s.document.entities['cell:r0:c0'].value.text,'둘');
 await b.refresh();b.edit({'cell:r0:c1':{text:'친구'}});await settled(b);await a.undo();assert.equal(s.document.entities['cell:r0:c1'].value.text,'친구');
 await b.refresh();b.edit({'cell:r0:c0':{text:'친구의 최신'}});await settled(b);await a.undo();assert.equal(s.document.entities['cell:r0:c0'].value.text,'친구의 최신');assert.match(a.getSnapshot().error,/동행/);assert.equal(a.getSnapshot().pending,0);
});
test('undo retains its original mutation id across a lost server response',async()=>{
 const s=server(),store=new BrainStore(initial(),s.transport);store.edit({'cell:r0:c0':{text:'내용'}});await settled(store);s.loseResponse();await store.undo();assert.equal(store.getSnapshot().pending,1);assert.equal(s.document.entities['cell:r0:c0'].value,null);
 store.retry();await settled(store);assert.equal(s.document.revision,3);assert.equal(store.getSnapshot().canRedo,true);await store.undo(true);assert.equal(s.document.entities['cell:r0:c0'].value.text,'내용');
});
test('offline queue recovers and revoked access stops editing without discarding drafts',async()=>{
 const s=server();let saved=[];s.setOffline(true);const store=new BrainStore(initial(),s.transport,p=>{saved=copy(p);});store.edit({'cell:r0:c0':{text:'미저장'}});await settled(store);assert.equal(saved.length,1);
 s.setOffline(false);const recovered=new BrainStore(initial(),s.transport,undefined,saved);await recovered.flush();assert.equal(s.document.entities['cell:r0:c0'].value.text,'미저장');
 s.setDenied(true);await assert.rejects(recovered.refresh());assert.equal(recovered.getSnapshot().unavailable,true);recovered.edit({'cell:r0:c1':{text:'금지'}});assert.equal(recovered.getSnapshot().pending,0);
});
test('inserting rows preserves stable cell addresses, and TSV round trips Unicode and line breaks',()=>{
 const entities={'sheet:rows':{value:['new','r0']},'cell:r0:c0':{value:{text:'한글\n두 줄\t"인용"'}}};assert.equal(cellKey(axis(entities,'rows')[1],'c0'),'cell:r0:c0');
 const tsv=sheetTsv(entities,['r0'],['c0']);assert.deepEqual(parseTsv(tsv),[['한글\n두 줄\t"인용"']]);assert.deepEqual(parseTsv('가\t나\r\n다\t라\r\n'),[['가','나'],['다','라']]);
});
test('an older response cannot roll back a newer document snapshot',()=>{
 const current={...initial(),revision:8,entities:{a:{value:{text:'최신'}}}};assert.equal(mergeDelta(current,{...initial(),revision:7,entities:{},reset:true}),current);
});
test('large backup restoration stays within hosted payload limits and resumes without duplicate documents',async()=>{
 const source=initial();source.entities=Object.fromEntries(Array.from({length:1200},(_,i)=>[`cell:r${i}:c0`,{value:{text:'한글'.repeat(350)},stamp:'old',revision:1}]));
 const batches=brainImportBatches(source);assert.ok(batches.length>2);assert.ok(batches.every(batch=>new TextEncoder().encode(JSON.stringify(batch)).length<710000));
 let document,failOnce=true;const seen=new Set(),ids=new Set();let writes=0;
 mockApi=async(path,init)=>{
  if(!init)return {...copy(document),reset:true};
  assert.ok(new TextEncoder().encode(init.body).length<1048576);
  const payload=JSON.parse(init.body);
  if(payload.documentId){ids.add(payload.documentId);document??={...initial(),id:payload.documentId};return {...copy(document),reset:true};}
  if(seen.has(payload.mutationId))return {...copy(document),reset:true};
  for(const change of payload.changes)assert.equal(document.entities[change.key]?.stamp??null,change.expected);
  document.revision++;writes++;
  for(const change of payload.changes)document.entities[change.key]={value:change.value,stamp:payload.mutationId,revision:document.revision};
  if(payload.preview)document.preview=payload.preview;
  seen.add(payload.mutationId);
  if(failOnce&&writes===2){failOnce=false;throw new Error('응답 유실');}
  return {...copy(document),reset:true};
 };
 await assert.rejects(importBrainDocuments('new-trip',[source],'stable-import-key'));
 await importBrainDocuments('new-trip',[source],'stable-import-key');
 assert.equal(ids.size,1);assert.equal(Object.keys(document.entities).length,1200);assert.equal(writes,batches.length+1);assert.equal(document.entities['cell:r1199:c0'].value.text,'한글'.repeat(350));
 await importBrainDocuments('new-trip',[source],'stable-import-key');assert.equal(writes,batches.length+1);
});
