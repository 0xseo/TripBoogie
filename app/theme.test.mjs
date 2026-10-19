import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postcss from 'postcss';
const sheet=postcss.parse(await readFile(new URL('./theme.css',import.meta.url),'utf8'));
const colors=theme=>{const values={};sheet.walkRules(rule=>{if(rule.selector===':root'||(theme==='dark'&&rule.selector===':root[data-theme="dark"]'))for(const d of rule.nodes)if(d.prop?.startsWith('--'))values[d.prop]=d.value;});return values;};
function luminance(hex){const value=hex.slice(1),full=value.length===3?[...value].map(v=>v+v).join(''):value;const rgb=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);};
const pairs=[['--ink','--paper'],['--muted','--paper'],['--muted','--bg'],['--green','--paper'],['--on-primary','--green'],['--ink','--soft'],['--ink','--mint'],['--ink','--range'],['--calendar-red','--paper'],['--calendar-red','--range'],['--calendar-blue','--range'],['--danger','--paper'],['--error-ink','--error-bg']];
for(const theme of ['light','dark'])test(`${theme}: normal text, secondary text, filled buttons, calendar and errors meet WCAG AA contrast`,()=>{const palette=colors(theme);for(const [fg,bg]of pairs)assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${theme} ${fg} / ${bg}: ${contrast(palette[fg],palette[bg]).toFixed(2)}`);assert.ok(contrast('#3a5a40','#e9edc9')>=4.5);});
