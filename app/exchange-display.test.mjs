import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const directory=await mkdtemp(path.join(tmpdir(),'tripboogie-rate-display-'));
test.after(()=>rm(directory,{recursive:true,force:true}));
await writeFile(path.join(directory,'exchange-display.mjs'),ts.transpileModule(await readFile(new URL('./exchange-display.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {formatExchangeRate}=await import(pathToFileURL(path.join(directory,'exchange-display.mjs')));

test('both exchange directions use readable units without a long decimal tail',()=>{
 const raw=754.24;
 assert.equal(formatExchangeRate('NZD','KRW',raw),'1 NZD ≈ 754.24 KRW');
 assert.equal(formatExchangeRate('KRW','NZD',1/raw),'1,000 KRW ≈ 1.33 NZD');
 assert.equal(formatExchangeRate('USD','IDR',15678.90123),'1 USD ≈ 15,678.9 IDR');
 assert.equal(formatExchangeRate('IDR','USD',1/15678.90123),'100,000 IDR ≈ 6.38 USD');
 assert.equal(raw,754.24);
});
test('fractional rates, equal currencies and invalid responses stay legible',()=>{
 assert.equal(formatExchangeRate('USD','CHF',0.8),'10 USD ≈ 8 CHF');
 assert.equal(formatExchangeRate('KRW','JPY',0.01),'100 KRW ≈ 1 JPY');
 assert.equal(formatExchangeRate('KRW','KRW',1),'1 KRW ≈ 1 KRW');
 for(const rate of [0,-1,NaN,Infinity])assert.equal(formatExchangeRate('A','B',rate),'—');
});
