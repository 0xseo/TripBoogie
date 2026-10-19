import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('./pull-to-refresh.ts',import.meta.url),'utf8');
const {bindPullRefresh}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
function setup(){
 const target=new EventTarget(),state={enabled:true,top:0,refreshes:0,pulls:[]};
 const dispose=bindPullRefresh(target,{canStart:()=>state.enabled,isAtTop:()=>state.top<=1,onPull:d=>state.pulls.push(d),onRefresh:()=>state.refreshes++});
 const send=(type,x=20,y=0,count=1)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'touches',{value:Array.from({length:count},()=>({clientX:x,clientY:y}))});target.dispatchEvent(event);return event;};
 return {state,send,dispose};
}
test('first downward move is claimed, iOS negative overscroll and later scroll anchoring preserve the gesture',()=>{
 const {state,send}=setup();state.top=-8;send('touchstart',20,10);
 assert.equal(send('touchmove',20,11).defaultPrevented,true);
 state.top=18;send('touchmove',20,115);send('touchend',20,115,0);send('touchend',20,115,0);
 assert.equal(state.refreshes,1);
});
test('scrolled screens and disabled states keep native scrolling without a refresh; a later gesture uses the latest enabled state',()=>{
 const {state,send}=setup();state.top=20;send('touchstart');assert.equal(send('touchmove',20,120).defaultPrevented,false);send('touchend',20,120,0);
 state.top=0;state.enabled=false;send('touchstart');send('touchmove',20,120);send('touchend',20,120,0);assert.equal(state.refreshes,0);
 state.enabled=true;send('touchstart');send('touchmove',20,120);send('touchend',20,120,0);assert.equal(state.refreshes,1);
});
test('short, horizontal, upward, multi-touch and cancelled gestures do not refresh',()=>{
 for(const run of [
  send=>{send('touchmove',20,30);send('touchend',20,30,0);},
  send=>{send('touchmove',70,8);send('touchmove',70,150);send('touchend',70,150,0);},
  send=>{send('touchmove',20,-5);send('touchmove',20,150);send('touchend',20,150,0);},
  send=>{send('touchmove',20,100,2);send('touchend',20,100,0);},
  send=>{send('touchmove',20,120);send('touchcancel');send('touchend',20,120,0);},
 ]){const {state,send}=setup();send('touchstart');run(send);assert.equal(state.refreshes,0);assert.equal(state.pulls.at(-1),0);}
});
test('a new gesture and detached surface cannot reuse a prior completed pull',()=>{
 const {state,send,dispose}=setup();send('touchstart');send('touchmove',20,120);send('touchend',20,120,0);
 send('touchstart');send('touchend',20,0,0);assert.equal(state.refreshes,1);
 dispose();send('touchstart');send('touchmove',20,120);send('touchend',20,120,0);assert.equal(state.refreshes,1);
});
