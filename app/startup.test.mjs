import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('./startup.ts',import.meta.url),'utf8');
const {startupNavigationScript}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
test('reload is identified before hydration while first navigation and history return keep their startup behavior',()=>{
 for(const type of ['reload','navigate','back_forward',undefined]){
  const attrs={};runInNewContext(startupNavigationScript,{performance:{getEntriesByType:kind=>{assert.equal(kind,'navigation');return type?[{type}]:[];}},document:{documentElement:{setAttribute:(name,value)=>attrs[name]=value}}});
  assert.deepEqual(attrs,type==='reload'?{'data-startup':'reload'}:{});
 }
});
test('unsupported navigation timing is safe and does not interrupt application startup',()=>{
 assert.doesNotThrow(()=>runInNewContext(startupNavigationScript,{}));
 assert.doesNotThrow(()=>runInNewContext(startupNavigationScript,{performance:{getEntriesByType:()=>{throw Error('unsupported');}}}));
});
