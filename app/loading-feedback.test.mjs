import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';

const entry=await readFile(new URL('./styles.css',import.meta.url),'utf8');
const sheets=await Promise.all([...entry.matchAll(/@import "(.+?)"/g)].map(async ([,file])=>postcss.parse(await readFile(new URL(file,import.meta.url),'utf8'))));

test('every shared spinner animation resolves to an actual loaded keyframe',()=>{
 const frames=new Set();for(const sheet of sheets)sheet.walkAtRules('keyframes',rule=>frames.add(rule.params));
 let checked=0;
 for(const sheet of sheets)sheet.walkRules(rule=>{
  if(!rule.selector.includes('.spinner'))return;
  rule.walkDecls(/^(animation|animation-name)$/,declaration=>{
   const name=declaration.value.split(/\s+/)[0];
   assert.ok(frames.has(name),`Unresolved spinner animation: ${name}`);checked++;
  });
 });
 assert.ok(checked>0);
});
test('SVG spinner size and shape are independent of the CSS border spinner',()=>{
 let baseBorder=false,svgReset=false,reduceMotion=false;
 for(const sheet of sheets)sheet.walkRules(rule=>{
  if(rule.selector==='.spinner')rule.walkDecls(/^border/,()=>{baseBorder=true;});
  if(rule.selector==='svg.spinner')rule.walkDecls('border',d=>{svgReset=d.value==='0';});
  if(rule.selector==='.spinner'&&rule.parent.type==='atrule'&&rule.parent.params.includes('prefers-reduced-motion'))rule.walkDecls('animation',d=>{reduceMotion=d.important&&d.value.includes('spin');});
 });
 assert.equal(baseBorder,false);assert.equal(svgReset,true);assert.equal(reduceMotion,true);
});
