"use client";
import {useEffect} from "react";

const editable='textarea,input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=button]):not([type=submit]),[contenteditable=true]';
function isEditable(element:Element|null):element is HTMLElement{
 return element instanceof HTMLElement&&element.matches(editable)&&!element.matches(':disabled,[readonly]');
}
// Textareas scroll internally; measure the current line instead of the end of the memo.
function caretRect(input:HTMLTextAreaElement){
 const rect=input.getBoundingClientRect(),style=getComputedStyle(input),mirror=document.createElement("div"),marker=document.createElement("span");
 for(const key of ["fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","wordSpacing","textIndent","textTransform","textAlign","direction","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","tabSize"] as const)mirror.style[key]=style[key];
 const borders=(parseFloat(style.borderLeftWidth)||0)+(parseFloat(style.borderRightWidth)||0);
 Object.assign(mirror.style,{position:"fixed",left:"-10000px",top:"0",width:`${input.clientWidth+borders}px`,boxSizing:"border-box",height:"auto",minHeight:"0",maxHeight:"none",visibility:"hidden",whiteSpace:"pre-wrap",overflowWrap:"break-word",borderStyle:"solid"});
 mirror.textContent=input.value.slice(0,input.selectionEnd);marker.textContent="\u200b";mirror.appendChild(marker);mirror.appendChild(document.createTextNode(input.value.slice(input.selectionEnd)));document.body.appendChild(mirror);
 const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5,localTop=marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top;mirror.remove();
 const padding=parseFloat(style.paddingBottom)||0,topPadding=parseFloat(style.paddingTop)||0;
 if(localTop-input.scrollTop+lineHeight>input.clientHeight-padding)input.scrollTop=localTop+lineHeight-input.clientHeight+padding;
 else if(localTop-input.scrollTop<topPadding)input.scrollTop=Math.max(0,localTop-topPadding);
 return {top:rect.top+localTop-input.scrollTop,bottom:rect.top+localTop-input.scrollTop+lineHeight};
}
export function revealFocusedInput(container?:HTMLElement,scroll=true){
 const input=document.activeElement;if(!isEditable(input))return;
 const dialog=input.closest('dialog');if(container?dialog!==container:!!dialog)return;
 const viewport=window.visualViewport,viewTop=viewport?.offsetTop||0,viewBottom=viewTop+(viewport?.height||innerHeight);
 const header=(container?.querySelector('header')||document.querySelector('.app-header'))?.getBoundingClientRect();
 let top=Math.max(viewTop+12,header?header.bottom+12:viewTop+12),bottom=viewBottom-16;
 if(container){const box=container.getBoundingClientRect();top=Math.max(top,box.top+12);bottom=Math.min(bottom,box.bottom-12);}
 const obstacles=container?.querySelectorAll<HTMLElement>('footer,form>.primary:last-child,.settings-footer')||document.querySelectorAll<HTMLElement>('.mobile-trip-nav');
 let footerHeight=0;
 for(const element of obstacles){const box=element.getBoundingClientRect();if(/sticky|fixed/.test(getComputedStyle(element).position))footerHeight=Math.max(footerHeight,box.height);}
 // Reserve action height, not its current scroll-dependent position. Otherwise
 // scrolling a sticky footer changes the textarea cap and causes another scroll.
 if(footerHeight)bottom-=footerHeight+12;
 if(input instanceof HTMLTextAreaElement&&!input.closest('.memo-composer')){const height=`${Math.max(72,Math.floor(bottom-top-12))}px`;if(input.style.getPropertyValue('--memo-visible-height')!==height)input.style.setProperty('--memo-visible-height',height);}
 if(!scroll)return;
 const target=()=>{const box=input.getBoundingClientRect();return input instanceof HTMLTextAreaElement&&box.height>bottom-top?caretRect(input):box;};
 // A nested scroller may hit its limit. Continue through its ancestors instead
 // of stopping before the input has actually cleared the keyboard/footer.
 for(let parent=input.parentElement;parent;parent=parent.parentElement){
  const box=target(),delta=box.bottom>bottom?box.bottom-bottom:box.top<top?box.top-top:0;
  if(Math.abs(delta)<1)break;
  if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight)parent.scrollTop+=delta;
  if(parent===document.body&&!container)window.scrollBy({top:delta,behavior:'instant'});
 }
 if(input instanceof HTMLTextAreaElement)caretRect(input);
}
export default function KeyboardFocus(){
 useEffect(()=>{
  let frame=0,timer=0,changing=false,nativeAnimating=false,nativeOpen:boolean|null=null,pendingScroll=false,previous:HTMLElement|null=null,lastHeight=Math.round(window.visualViewport?.height||innerHeight),fullHeight=lastHeight,lastSelection="";
  const set=(name:string,value:string)=>{if(document.documentElement.style.getPropertyValue(name)!==value)document.documentElement.style.setProperty(name,value);};
  const syncViewport=()=>{
   const active=isEditable(document.activeElement)?document.activeElement:null,height=Math.round(window.visualViewport?.height||innerHeight);
   set('--visual-viewport-height',`${height}px`);
   set('--keyboard-page-gap',`${active&&!active.closest('dialog')?Math.max(0,innerHeight-height):0}px`);
  };
  const flush=()=>{
   const active=isEditable(document.activeElement)?document.activeElement:null;
   if(previous&&previous!==active)previous.style.removeProperty('--memo-visible-height');previous=active;
   syncViewport();const dialog=active?.closest('dialog');
   revealFocusedInput(dialog instanceof HTMLElement?dialog:undefined,pendingScroll);pendingScroll=false;
  };
  const schedule=(scroll:boolean,delay=0)=>{
   pendingScroll||=scroll;clearTimeout(timer);cancelAnimationFrame(frame);
   if(nativeAnimating)return;
   timer=window.setTimeout(()=>{changing=false;frame=requestAnimationFrame(flush);},delay);
  };
  const focus=()=>{const active=document.activeElement;lastSelection=active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement?`${active.selectionStart}:${active.selectionEnd}`:"";changing=true;schedule(true,160);};
  const blur=()=>{pendingScroll=false;schedule(false,160);};
  const input=()=>schedule(true,changing?300:0);
  const selection=()=>{
   const active=document.activeElement;if(!(active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement))return;
   const key=`${active.selectionStart}:${active.selectionEnd}`;if(key===lastSelection)return;lastSelection=key;
   schedule(true,changing?300:0);
  };
  const resize=()=>{
   const height=Math.round(window.visualViewport?.height||innerHeight),shrinking=height<lastHeight;
   // On keyboard dismissal, let the form grow without dragging the focused
   // field back into view. Keep resize/scroll handling from feeding itself.
   // Keyboard suggestion bars can shrink while the IME stays open. Preserve
   // the pending reveal until the viewport returns to its full height.
   fullHeight=Math.max(fullHeight,height);
   const dismissing=height>lastHeight&&height>=fullHeight-80;
   if(dismissing&&!nativeAnimating&&nativeOpen!==true)pendingScroll=false;lastHeight=height;changing=true;
   syncViewport();schedule(shrinking,300);
  };
  const motion=(event:Event)=>{const detail=(event as CustomEvent<{running:boolean;visible:boolean}>).detail;nativeAnimating=detail.running;if(!nativeAnimating){nativeOpen=detail.visible;if(!nativeOpen)pendingScroll=false;}changing=true;schedule(false,nativeAnimating?0:100);};
  const scrolling=()=>{if(changing&&!nativeAnimating)schedule(false,140);};
  window.addEventListener('tripboogie:keyboard-motion',motion);document.addEventListener('scroll',scrolling,true);
  document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);document.addEventListener('input',input);document.addEventListener('selectionchange',selection);
  window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',syncViewport);syncViewport();
  return()=>{window.removeEventListener('tripboogie:keyboard-motion',motion);document.removeEventListener('scroll',scrolling,true);clearTimeout(timer);cancelAnimationFrame(frame);previous?.style.removeProperty('--memo-visible-height');document.documentElement.style.removeProperty('--keyboard-page-gap');document.documentElement.style.removeProperty('--visual-viewport-height');document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);document.removeEventListener('input',input);document.removeEventListener('selectionchange',selection);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',syncViewport);};
 },[]);return null;
}
