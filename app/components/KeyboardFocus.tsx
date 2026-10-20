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
export function revealFocusedInput(container?:HTMLElement){
 const input=document.activeElement;if(!isEditable(input))return;
 const dialog=input.closest('dialog');if(container?dialog!==container:!!dialog)return;
 const viewport=window.visualViewport,viewTop=viewport?.offsetTop||0,viewBottom=viewTop+(viewport?.height||innerHeight);
 const header=(container?.querySelector('header')||document.querySelector('.app-header'))?.getBoundingClientRect();
 let top=Math.max(viewTop+12,header?header.bottom+12:viewTop+12),bottom=viewBottom-16;
 if(container){const box=container.getBoundingClientRect();top=Math.max(top,box.top+12);bottom=Math.min(bottom,box.bottom-12);}
 const obstacles=container?.querySelectorAll<HTMLElement>('footer,form>.primary:last-child,.settings-footer')||document.querySelectorAll<HTMLElement>('.mobile-trip-nav');
 for(const element of obstacles){const box=element.getBoundingClientRect();if(/sticky|fixed/.test(getComputedStyle(element).position)&&box.height&&box.top>top&&box.top<bottom)bottom=box.top-12;}
 if(input instanceof HTMLTextAreaElement)input.style.setProperty('--memo-visible-height',`${Math.max(72,bottom-top-12)}px`);
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
  let frame=0,previous:HTMLElement|null=null;
  const reveal=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const active=isEditable(document.activeElement)?document.activeElement:null;
   if(previous&&previous!==active)previous.style.removeProperty('--memo-visible-height');previous=active;
   const viewport=window.visualViewport,height=viewport?.height||innerHeight;
   document.documentElement.style.setProperty('--visual-viewport-height',`${height}px`);
   // Safari can shrink only the visual viewport. Give the last page input room
   // to scroll in that case; dialogs already use their own resized viewport.
   document.documentElement.style.setProperty('--keyboard-page-gap',`${active&&!active.closest('dialog')?Math.max(0,innerHeight-height):0}px`);
   const dialog=active?.closest('dialog');revealFocusedInput(dialog instanceof HTMLElement?dialog:undefined);
  });};
  const events=['focusin','focusout','input','keyup','selectionchange'];for(const event of events)document.addEventListener(event,reveal);
  window.addEventListener('resize',reveal);window.visualViewport?.addEventListener('resize',reveal);window.visualViewport?.addEventListener('scroll',reveal);reveal();
  return()=>{cancelAnimationFrame(frame);previous?.style.removeProperty('--memo-visible-height');document.documentElement.style.removeProperty('--keyboard-page-gap');document.documentElement.style.removeProperty('--visual-viewport-height');for(const event of events)document.removeEventListener(event,reveal);window.removeEventListener('resize',reveal);window.visualViewport?.removeEventListener('resize',reveal);window.visualViewport?.removeEventListener('scroll',reveal);};
 },[]);return null;
}
