import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('./checklist.ts',import.meta.url),'utf8');
const {checklistState,checklistEntries,mergeChecklistOrder}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
test('shared tasks use their stored completion and ignore individual check records',()=>{
 assert.equal(checklistState({scope:'once',done:true,checks:{}},'me').done,true);
 assert.equal(checklistState({scope:'once',done:false,checks:{me:'date'}},'me').done,false);
 assert.equal(checklistState({done:1},'me').done,false);
});
test('personal tasks count the current member and agree with the visible checkmark',()=>{
 const tasks=[{scope:'all',checks:{me:'date'}},{scope:'all',checks:{friend:'date'}},{scope:'once',done:true}];
 assert.deepEqual(tasks.map(task=>checklistState(task,'me').done),[true,false,true]);
 assert.equal(tasks.filter(task=>checklistState(task,'me').done).length,2);
 assert.equal(checklistState(tasks[0],'friend').done,false);
});
test('legacy malformed check records cannot create a completed personal task',()=>{
 for(const checks of [null,undefined,'me',['date'],false])assert.deepEqual(checklistState({scope:'all',checks},'me'),{checks:{},done:false});
});
const row=(id,position,extra={})=>({id,data:{position,...extra}});
test('completed tasks move below pending tasks without losing the manual order',()=>{
 const rows=[row('a',0),row('b',1),row('c',2,{done:true})];
 assert.deepEqual(checklistEntries(rows,'me').map(e=>e.record.id),['a','b','c']);
 rows[0].data.done=true;
 assert.deepEqual(checklistEntries(rows,'me').map(e=>e.record.id),['b','a','c']);
 assert.deepEqual(checklistEntries(rows,'me',true).map(e=>e.record.id),['b']);
 rows[0].data.done=false;
 assert.deepEqual(checklistEntries(rows,'me').map(e=>e.record.id),['a','b','c']);
});
test('visible reorder preserves hidden completed slots and personal completion',()=>{
 const rows=[row('a',0),row('done',1,{done:true}),row('b',2),row('personal',3,{scope:'all',checks:{friend:'date'}})];
 assert.deepEqual(mergeChecklistOrder(rows,['personal','b','a']),['personal','done','b','a']);
 assert.deepEqual(checklistEntries(rows,'me',true).map(e=>e.record.id),['a','b','personal']);
 assert.deepEqual(checklistEntries(rows,'friend',true).map(e=>e.record.id),['a','b']);
});
