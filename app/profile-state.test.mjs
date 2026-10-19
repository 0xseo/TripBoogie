import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
const directory=await mkdtemp(path.join(tmpdir(),'tripboogie-profile-'));
test.after(()=>rm(directory,{recursive:true,force:true}));
for(const name of ['profile-update','profile-state'])await writeFile(path.join(directory,name+'.mjs'),ts.transpileModule((await readFile(new URL('./'+name+'.ts',import.meta.url),'utf8')).replace('"./profile-update"','"./profile-update.mjs"'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {ProfileState}=await import(pathToFileURL(path.join(directory,'profile-state.mjs')));
const profile={id:'one',name:'부기',email:'one@example.test',baseCurrency:'KRW',theme:'light',version:3};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('name updates before server completion, ignores stale reads, and confirms the server version',async()=>{
 const state=new ProfileState(profile),request=deferred();let payload;
 const saved=state.save({name:'새 부기',avatar:'bad',id:'bad'},data=>{payload=data;return request.promise;});
 assert.equal(state.getSnapshot().name,'새 부기');assert.deepEqual(payload,{version:3,name:'새 부기'});
 state.receive({...profile});assert.equal(state.getSnapshot().name,'새 부기');
 await assert.rejects(state.save({name:'중복'},async()=>profile),/앞선 변경/);
 request.resolve({...profile,name:'새 부기',version:4});await saved;
 state.receive(profile);assert.equal(state.getSnapshot().name,'새 부기');assert.equal(state.getSnapshot().version,4);
});
test('failed save restores the latest confirmed profile without losing newer remote preferences',async()=>{
 const state=new ProfileState(profile),request=deferred();const saved=state.save({name:'실패'},()=>request.promise);
 state.receive({...profile,theme:'dark',version:4});assert.equal(state.getSnapshot().name,'실패');
 request.reject(new Error('저장 실패'));await assert.rejects(saved,/저장 실패/);
 assert.equal(state.getSnapshot().name,'부기');assert.equal(state.getSnapshot().theme,'dark');assert.equal(state.getSnapshot().version,4);
});
test('a late success or rejection cannot restore another account after logout and sign-in',async()=>{
 for(const fail of [false,true]){
  const state=new ProfileState(profile),request=deferred();const saved=state.save({name:'이전 계정'},()=>request.promise);
  state.receive(null);state.receive({...profile,id:'two',name:'다른 부기',version:1});
  if(fail){request.reject(new Error('실패'));await assert.rejects(saved);}else{request.resolve({...profile,name:'이전 계정',version:4});await saved;}
  assert.equal(state.getSnapshot().id,'two');assert.equal(state.getSnapshot().name,'다른 부기');
 }
});

test('a newer confirmed revision wins over a late successful mutation response',async()=>{
 const state=new ProfileState(profile),request=deferred(),saved=state.save({name:'편집'},()=>request.promise);
 state.receive({...profile,name:'더 최신 이름',version:5});
 request.resolve({...profile,name:'편집',version:4});await saved;
 assert.equal(state.getSnapshot().name,'더 최신 이름');assert.equal(state.getSnapshot().version,5);
});
