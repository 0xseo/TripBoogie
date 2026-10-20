"use client";
import {useEffect} from "react";

// Measure the caret, rather than the bottom of a long memo. The textarea keeps
// its own scroll position while the surrounding form moves above the keyboard.
function caretRect(input:HTMLTextAreaElement){
 const rect=input.getBoundingClientRect(),style=getComputedStyle(input),mirror=document.createElement("div"),marker=document.createElement("span");
 for(const key of ["fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","textIndent","textTransform","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","boxSizing","tabSize"] as const)mirror.style[key]=style[key];
 Object.assign(mirror.style,{position:"fixed",left:"-10000px",top:"0",width:`${rect.width}px`,height:"auto",minHeight:"0",maxHeight:"none",visibility:"hidden",whiteSpace:"pre-wrap",overflowWrap:"break-word",borderStyle:"solid"});
 mirror.textContent=input.value.slice(0,input.selectionEnd);marker.textContent=input.value.slice(input.selectionEnd)||"\u200b";mirror.appendChild(marker);document.body.appendChild(mirror);
 const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5,localTop=marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top;mirror.remove();
 const padding=parseFloat(style.paddingBottom)||0,topPadding=parseFloat(style.paddingTop)||0;
 if(localTop-input.scrollTop+lineHeight>input.clientHeight-padding)input.scrollTop=localTop+lineHeight-input.clientHeight+padding;
 else if(localTop-input.scrollTop<topPadding)input.scrollTop=Math.max(0,localTop-topPadding);
 return {top:rect.top+localTop-input.scrollTop,bottom:rect.top+localTop-input.scrollTop+lineHeight};
}
export function revealFocusedInput(container?:HTMLElement){
 const input=document.activeElement;
 if(!(input instanceof HTMLElement)||!input.matches('input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]'))return;
 const dialog=input.closest('dialog');if(container?dialog!==container:!!dialog)return;
 const viewport=window.visualViewport,viewTop=viewport?.offsetTop||0,viewBottom=viewTop+(viewport?.height||innerHeight);
 const header=container?.querySelector('header')?.getBoundingClientRect();
 const top=Math.max(viewTop+12,header?header.bottom+12:viewTop+12);
 let bottom=viewBottom-20;
 for(const element of Array.from(container?.querySelectorAll<HTMLElement>('footer,form>.primary:last-child,.settings-footer')||[])){const footer=element.getBoundingClientRect();if(/sticky|fixed/.test(getComputedStyle(element).position)&&footer.top>top&&footer.top<bottom)bottom=footer.top-12;}
 if(input instanceof HTMLTextAreaElement)input.style.setProperty('--memo-visible-height',`${Math.max(72,bottom-top-40)}px`);
 const rect=input instanceof HTMLTextAreaElement?caretRect(input):input.getBoundingClientRect();
 if(rect.bottom<=bottom&&rect.top>=top)return;
 const delta=rect.bottom>bottom?rect.bottom-bottom:rect.top-top;
 let parent=input.parentElement;
 while(parent&&parent!==document.body){if(/auto|scroll/.test(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){parent.scrollBy({top:delta,behavior:'instant'});return;}parent=parent.parentElement;}
 if(!container)window.scrollBy({top:delta,behavior:'instant'});
}
export default function KeyboardFocus(){useEffect(()=>{let frame=0;const reveal=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const dialog=document.activeElement?.closest('dialog');revealFocusedInput(dialog instanceof HTMLElement?dialog:undefined);});};const events=['focusin','input','keyup','selectionchange'];for(const event of events)document.addEventListener(event,reveal);window.addEventListener('resize',reveal);window.visualViewport?.addEventListener('resize',reveal);window.visualViewport?.addEventListener('scroll',reveal);return()=>{cancelAnimationFrame(frame);for(const event of events)document.removeEventListener(event,reveal);window.removeEventListener('resize',reveal);window.visualViewport?.removeEventListener('resize',reveal);window.visualViewport?.removeEventListener('scroll',reveal);};},[]);return null;}
