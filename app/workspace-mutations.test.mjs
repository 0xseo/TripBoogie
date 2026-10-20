import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function load(name){
 const source=await readFile(new URL(`./${name}.ts`,import.meta.url),'utf8');
 return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
}
const {WorkspaceMutations}=await load('workspace-mutations');
const {airportCode,bookingTitle,compareBookings}=await load('booking-display');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const initial=()=>({trip:{id:'trip'},records:[{id:'a',data:{done:false,title:'original'},version:1},{id:'b',data:{done:false},version:1}],revision:1});
const edit=(id,data)=>w=>({...w,records:w.records.map(r=>r.id===id?{...r,data:{...r.data,...data}}:r)});

test('rapid edits appear immediately and survive earlier server responses',async()=>{
 let visible;const first=deferred(),second=deferred(),counts=[];const calls=[];
 const queue=new WorkspaceMutations(initial(),w=>visible=w,n=>counts.push(n));
 const a=queue.enqueue(edit('a',{done:true}),async w=>{calls.push(w.revision);return first.promise});
 const b=queue.enqueue(edit('b',{done:true}),async w=>{calls.push(w.revision);return second.promise});
 assert.deepEqual(visible.records.map(r=>r.data.done),[true,true]);assert.equal(calls.length,1);
 first.resolve({...edit('a',{done:true})(initial()),revision:2});await a;
 assert.deepEqual(visible.records.map(r=>r.data.done),[true,true]);assert.deepEqual(calls,[1,2]);
 second.resolve({...edit('b',{done:true})(visible),revision:3});await b;
 assert.equal(queue.size,0);assert.equal(counts.at(-1),0);assert.equal(visible.revision,3);
});
test('failed deletion restores only that item while a newer edit stays visible',async()=>{
 let visible;const first=deferred(),second=deferred();
 const queue=new WorkspaceMutations(initial(),w=>visible=w,()=>{});
 const a=queue.enqueue(w=>({...w,records:w.records.filter(r=>r.id!=='a')}),()=>first.promise);
 const rejected=assert.rejects(a,/offline/);
 const b=queue.enqueue(edit('b',{done:true}),()=>second.promise);
 assert.deepEqual(visible.records.map(r=>r.id),['b']);
 first.reject(new Error('offline'));await rejected;
 assert.deepEqual(visible.records.map(r=>r.id),['a','b']);assert.equal(visible.records[1].data.done,true);
 second.resolve({...edit('b',{done:true})(initial()),revision:2});await b;
});
test('same-item toggles replay on the confirmed version and finish with the last input',async()=>{
 let visible;const first=deferred();let version;
 const queue=new WorkspaceMutations(initial(),w=>visible=w,()=>{});
 const a=queue.enqueue(edit('a',{done:true}),()=>first.promise);
 const b=queue.enqueue(edit('a',{done:false}),async w=>{version=w.records[0].version;return edit('a',{done:false})(w)});
 assert.equal(visible.records[0].data.done,false);
 const server=edit('a',{done:true})(initial());server.records[0].version=2;first.resolve(server);
 await Promise.all([a,b]);assert.equal(version,2);assert.equal(visible.records[0].data.done,false);
});
test('airport abbreviations preserve IATA, ICAO and legacy typed airports',()=>{
 assert.equal(airportCode({iata:'ICN',icao:'RKSI'},'인천국제공항'),'ICN');
 assert.equal(airportCode({iata:'',icao:'RKSI'}),'RKSI');
 assert.equal(airportCode(null,'인천국제공항 (ICN)'),'ICN');
 assert.equal(airportCode(undefined,'직접 입력한 공항'),'직접 입력한 공항');
 assert.equal(bookingTitle({type:'flight',title:'old',departure:'인천 (ICN)',arrivalAirport:{iata:'NRT'},flightNumber:'KE703'}),'ICN → NRT · KE703');
});
test('bookings sort by date then time, with unknown times last',()=>{
 const rows=[['late','2026-11-02','08:00'],['unknown','2026-11-01',''],['afternoon','2026-11-01','15:00'],['midnight','2026-11-01','00:00']].map(([id,startDate,startTime])=>({id,data:{startDate,startTime}}));
 assert.deepEqual(rows.sort(compareBookings).map(r=>r.id),['midnight','afternoon','unknown','late']);
});
