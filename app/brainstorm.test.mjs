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
for(const name of ['brainstorm','brainstorm-store','brainstorm-backup','brainstorm-board','brainstorm-sheet'])await writeFile(path.join(directory,`${name}.js`),ts.transpileModule(await readFile(new URL(`./${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
let mockApi;
await writeFile(path.join(directory,'client-api.js'),'exports.jsonRequest=data=>({body:JSON.stringify(data)});exports.apiFetch=(...args)=>global.__brainTestApi(...args);');
const require=createRequire(path.join(directory,'package.json'));
const {BrainStore}=require('./brainstorm-store.js'),{axis,cellKey,parseTsv,sheetTsv,mergeDelta}=require('./brainstorm.js');
global.__brainTestApi=(...args)=>mockApi(...args);
const {brainImportBatches,importBrainDocuments}=require('./brainstorm-backup.js');
const {attachLegacyErasers,attachSelectionErasers,dragBox,eraserTransform,objectsAlongEraser,selectionBounds,shapesInBox,translateShape}=require('./brainstorm-board.js');
const {TableTouchGesture,zoomTableView}=require('./brainstorm-sheet.js');
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
test('legacy eraser cuts follow their shape through moves and resize without moving other targets',()=>{
 const shape={type:'line',x:100,y:100,x2:300,y2:100,color:'#254c41',width:4,order:'1'};
 const eraser={type:'eraser',x:200,y:80,points:[[200,80],[200,120]],targets:['shape:line','shape:other'],color:'#254c41',width:24,order:'2'};
 const entities={'shape:line':{value:shape,stamp:'line',revision:1},'shape:cut':{value:eraser,stamp:'cut',revision:1}};
 const changes=attachLegacyErasers(entities,'shape:line',shape);
 assert.equal(changes.length,1);assert.equal(changes[0].expected,'cut');
 const bound=changes[0].value;
 assert.deepEqual(bound.origins['shape:line'],[100,100,200,1]);
 assert.equal(eraser.origins,undefined);assert.deepEqual(bound.targets,eraser.targets);
 const moved={...shape,x:180,y:220,x2:380,y2:220};
 assert.equal(eraserTransform(moved,'shape:line',bound),'translate(180 220) scale(1 1) translate(-100 -100)');
 assert.equal(eraserTransform(moved,'shape:other',bound),undefined);
 const saved={...entities,'shape:line':{...entities['shape:line'],value:moved},'shape:cut':{...entities['shape:cut'],value:bound}};
 assert.deepEqual(attachLegacyErasers(saved,'shape:line',moved),[]);
 assert.equal(eraserTransform({...moved,x2:580},'shape:line',bound),'translate(180 220) scale(2 1) translate(-100 -100)');
 // A shared eraser can be bound to another target later without changing the first cut.
 const other=attachLegacyErasers(saved,'shape:other',{...shape,x:0})[0].value;
 assert.deepEqual(other.origins['shape:line'],bound.origins['shape:line']);
 assert.deepEqual(other.origins['shape:other'],[0,100,300,1]);
});
test('moving a legacy erased shape saves, undoes and redoes the cut and movement together',async()=>{
 const s=server(),store=new BrainStore(initial(),s.transport);
 const shape={type:'pen',x:100,y:100,points:[[100,100],[300,150]],color:'#254c41',width:4,order:'1'};
 const eraser={type:'eraser',x:200,y:100,points:[[200,100],[200,150]],targets:['shape:line'],color:'#254c41',width:24,order:'2'};
 store.edit({'shape:line':shape,'shape:cut':eraser});await settled(store);
 const doc=store.getSnapshot().document,changes=attachLegacyErasers(doc.entities,'shape:line',shape);
 const moved={...shape,x:180,y:220,points:[[180,220],[380,270]]};
 store.edit({...Object.fromEntries(changes.map(c=>[c.key,c.value])),'shape:line':moved},{...Object.fromEntries(changes.map(c=>[c.key,c.expected])),'shape:line':doc.entities['shape:line'].stamp});await settled(store);
 assert.equal(eraserTransform(s.document.entities['shape:line'].value,'shape:line',s.document.entities['shape:cut'].value),'translate(180 220) scale(1 1) translate(-100 -100)');
 await store.undo();assert.deepEqual(s.document.entities['shape:line'].value,shape);assert.deepEqual(s.document.entities['shape:cut'].value,eraser);
 await store.undo(true);assert.deepEqual(s.document.entities['shape:line'].value,moved);assert.deepEqual(s.document.entities['shape:cut'].value.origins['shape:line'],[100,100,200,50]);
});
test('table pinch zoom stays anchored inside the table and resumes one-finger scrolling without a jump',()=>{
 const g=new TableTouchGesture(),view={zoom:1,left:200,top:300};
 g.start(1,{x:100,y:100},view);g.start(2,{x:200,y:100},view);
 const enlarged=g.move(2,{x:300,y:100});assert.deepEqual(enlarged,{zoom:2,left:500,top:700});
 assert.equal((enlarged.left+200)/enlarged.zoom,350);assert.equal((enlarged.top+100)/enlarged.zoom,400);
 g.end(2,enlarged);assert.deepEqual(g.move(1,{x:100,y:100}),enlarged);assert.deepEqual(g.move(1,{x:80,y:120}),{zoom:2,left:520,top:680});
 g.end(1,enlarged);assert.equal(g.move(1,{x:40,y:40}),null);
 assert.equal(zoomTableView(view,20,{x:100,y:100}).zoom,2.5);assert.equal(zoomTableView(view,.1,{x:100,y:100}).zoom,.5);
 assert.deepEqual(view,{zoom:1,left:200,top:300});
});
test('marquee selection works in either direction and group moves preserve shared eraser cuts',()=>{
 const a={type:'pen',x:100,y:100,points:[[100,100],[200,140]],width:4,color:'#254c41',order:'1'},b={...a,x:300,points:[[300,100],[400,140]],order:'2'};
 const eraser={type:'eraser',x:150,y:100,points:[[150,100],[350,140]],targets:['shape:a','shape:b'],width:24,color:'#254c41',order:'3'};
 const items=[['shape:a',a],['shape:b',b],['shape:eraser',eraser]];
 const box=dragBox({x:420,y:170},{x:80,y:80});assert.deepEqual(shapesInBox(items,box),['shape:a','shape:b']);assert.deepEqual(selectionBounds(items),{x:100,y:100,width:300,height:40});
 const entities=Object.fromEntries(items.map(([key,value])=>[key,{value,stamp:'initial',revision:1}]));
 const changes=attachSelectionErasers(entities,{'shape:a':a,'shape:b':b});assert.equal(changes.length,1);assert.deepEqual(Object.keys(changes[0].value.origins).sort(),['shape:a','shape:b']);
 for(const [key,shape]of items.slice(0,2)){const moved=translateShape(shape,40,60);assert.equal(eraserTransform(moved,key,changes[0].value),`translate(${shape.x+40} 160) scale(1 1) translate(${-shape.x} -100)`);assert.equal(moved.points[0][1],160);assert.equal(moved.y2,undefined);}
});
test('object eraser hits complete strokes along fast drags and ignores empty shape interiors',()=>{
 const base={width:4,color:'#254c41',order:'1'},line={...base,type:'line',x:100,y:100,x2:300,y2:100},rect={...base,type:'rect',x:400,y:100,x2:600,y2:300},ellipse={...base,type:'ellipse',x:700,y:100,x2:900,y2:300};
 const items=[['shape:line',line],['shape:rect',rect],['shape:ellipse',ellipse],['shape:eraser',{...line,type:'eraser'}]];
 assert.deepEqual(objectsAlongEraser(items,{x:200,y:0},{x:200,y:200},2),['shape:line']);
 assert.deepEqual(objectsAlongEraser(items,{x:500,y:200},{x:500,y:200},12),[]);
 assert.deepEqual(objectsAlongEraser(items,{x:800,y:200},{x:800,y:200},12),[]);
 assert.deepEqual(objectsAlongEraser(items,{x:600,y:150},{x:600,y:150},1),['shape:rect']);
 assert.deepEqual(objectsAlongEraser(items,{x:900,y:200},{x:900,y:200},1),['shape:ellipse']);
 assert.deepEqual(objectsAlongEraser([['dot',{...base,type:'pen',x:0,y:0,points:[[0,0]]}]],{x:0,y:0},{x:0,y:0},.5),['dot']);
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
