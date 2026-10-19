import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('./checklist.ts',import.meta.url),'utf8');
const {checklistState}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
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
