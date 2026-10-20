import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('./map-height.ts',import.meta.url),'utf8');
const {mapHeightBounds,mapHeightScale}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
test('mobile and web resize ranges preserve current minima and enforce both maximum limits',()=>{
 assert.deepEqual(mapHeightBounds(844,true),{base:230,min:230,max:345});
 assert.deepEqual(mapHeightBounds(600,true),{base:230,min:230,max:300});
 assert.deepEqual(mapHeightBounds(1000,false),{base:390,min:390,max:585});
 assert.deepEqual(mapHeightBounds(800,false),{base:390,min:390,max:533});
 assert.deepEqual(mapHeightBounds(400,true),{base:230,min:200,max:200});
});
test('unknown and out-of-range account preferences cannot exceed resize limits',()=>{
 for(const value of [null,undefined,'1.2',NaN,Infinity])assert.equal(mapHeightScale(value),1);
 assert.equal(mapHeightScale(.5),1);assert.equal(mapHeightScale(2),1.5);assert.equal(mapHeightScale(1.25),1.25);
});
