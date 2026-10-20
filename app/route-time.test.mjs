import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';
const source=await readFile(new URL('./route-time.ts',import.meta.url),'utf8');const {travelEstimateKey,connectionEstimateKey,savedTravelMinutes}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const from={id:'a',data:{}},to={id:'b',data:{travelFromId:'a',transportMode:'walk',travelMinutes:25,travelTimeSource:'estimate'}};const connection={from,to,leg:{from:{lat:35,lng:139},to:{lat:35.1,lng:139.2}}};to.data.travelEstimateKey=connectionEstimateKey(connection,'walk');
test('saved estimates survive reopening and become invalid only for changed mode or endpoints',()=>{
 assert.equal(savedTravelMinutes(connection,'walk'),'25');assert.equal(savedTravelMinutes(structuredClone(connection),'walk'),'25');assert.equal(savedTravelMinutes(connection,'drive'),'');
 const changed=structuredClone(connection);changed.leg.to.lat=36;assert.equal(savedTravelMinutes(changed,'walk'),'');changed.leg.to.lat=35.1;changed.from.id='c';assert.equal(savedTravelMinutes(changed,'walk'),'');
 assert.equal(travelEstimateKey('walk','a','b',connection.leg.from,connection.leg.to),to.data.travelEstimateKey);
});
test('manual and legacy saved times are never replaced by an automatic estimate, including zero minutes',()=>{
 const manual=structuredClone(connection);manual.to.data.travelTimeSource='manual';manual.to.data.travelMinutes=0;manual.leg.to.lat=36;assert.equal(savedTravelMinutes(manual,'walk'),'0');delete manual.to.data.travelTimeSource;assert.equal(savedTravelMinutes(manual,'walk'),'0');manual.to.data.travelFromId='different';assert.equal(savedTravelMinutes(manual,'walk'),'');
});
