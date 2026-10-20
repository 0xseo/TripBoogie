import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
let source=await readFile(new URL('./flight-duration.ts',import.meta.url),'utf8');
for(const name of ['@date-fns/tz/date/mini','@date-fns/tz/tzOffset'])source=source.replace(JSON.stringify(name),JSON.stringify(import.meta.resolve(name)));
const moduleUrl='data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const {flightDurationMinutes,flightDurationLabel}=await import(moduleUrl);
const flight=(startDate,startTime,endDate,endTime,departureZone,arrivalZone=departureZone)=>({type:'flight',startDate,startTime,endDate,endTime,departureZone,arrivalZone});
test('domestic flight duration and readable hour/minute labels match the stored schedule',()=>{
 assert.equal(flightDurationMinutes(flight('2026-11-01','10:00','2026-11-01','10:45','Pacific/Auckland')),45);
 assert.equal(flightDurationLabel(45),'비행 45분');assert.equal(flightDurationLabel(660),'비행 11시간');assert.equal(flightDurationLabel(675),'비행 11시간 15분');assert.equal(flightDurationLabel(null),'');
});
test('different local clocks and date-line crossings use elapsed time',()=>{
 assert.equal(flightDurationMinutes(flight('2026-11-01','18:00','2026-11-02','09:00','Asia/Seoul','Pacific/Auckland')),660);
 assert.equal(flightDurationMinutes(flight('2026-11-05','20:00','2026-11-05','12:00','Pacific/Auckland','America/Los_Angeles')),780);
 assert.equal(flightDurationMinutes(flight('2026-11-05','22:00','2026-11-07','07:00','America/Los_Angeles','Pacific/Auckland')),720);
 assert.equal(flightDurationMinutes(flight('2026-11-01','09:00','2026-11-01','11:00','Asia/Seoul','Asia/Kathmandu')),315);
});
test('airport zones override stale legacy zone fields and the viewing device zone never changes duration',()=>{
 const data={...flight('2026-11-01','18:00','2026-11-02','09:00','UTC'),departureAirport:{timezone:'Asia/Seoul'},arrivalAirport:{timezone:'Pacific/Auckland'}};
 assert.equal(flightDurationMinutes(data),660);
 for(const TZ of ['Asia/Seoul','America/Los_Angeles','Pacific/Auckland']){
  const run=spawnSync(process.execPath,['--input-type=module','-e',`import {flightDurationMinutes} from ${JSON.stringify(moduleUrl)};if(flightDurationMinutes(${JSON.stringify(data)})!==660)process.exit(1);`],{env:{...process.env,TZ},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
 }
});
test('DST jumps count elapsed hours; invalid, missing and repeated local times do not invent durations',()=>{
 assert.equal(flightDurationMinutes(flight('2026-03-08','01:30','2026-03-08','03:30','America/New_York')),60);
 assert.equal(flightDurationMinutes(flight('2026-09-27','01:30','2026-09-27','03:30','Pacific/Auckland')),60);
 for(const data of [
  flight('2026-03-08','02:30','2026-03-08','04:00','America/New_York'),
  flight('2026-11-01','01:30','2026-11-01','03:30','America/New_York'),
  flight('2026-02-30','10:00','2026-03-02','10:00','UTC'),
  flight('2026-11-01','','2026-11-01','11:00','Pacific/Auckland'),
  flight('2026-11-01','24:00','2026-11-02','11:00','Pacific/Auckland'),
  flight('2026-11-01','10:00','2026-11-01','11:00',''),
  flight('2026-11-01','10:00','2026-11-01','11:00','Invalid/Zone'),
  flight('2026-11-01','11:00','2026-11-01','10:00','UTC'),
  {...flight('2026-11-01','10:00','2026-11-01','11:00','UTC'),type:'hotel'},
 ])assert.equal(flightDurationMinutes(data),null);
});
